from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.message import Message
from app.models.room import Room, RoomMember, MemberRole
from app.models.user import User
from app.websocket.manager import manager
from app.services import room as room_service
import redis.asyncio as aioredis
from app.config import settings
import json
import time

redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)

PLAYER_STATE_TTL = 86400  # 24 часа

ALLOWED_EMOJIS = {"❤️", "😂", "😮", "👏", "🔥", "😢"}


# ── Ключи Redis ─────────────────────────────────────────────────────────────

def player_key(room_id: int) -> str:
    return f"room:{room_id}:player"

def queue_key(room_id: int) -> str:
    return f"room:{room_id}:queue"

def timeline_key(room_id: int, video_id: str) -> str:
    return f"room:{room_id}:video:{video_id}:timeline"

def waiting_key(room_id: int) -> str:
    return f"room:{room_id}:waiting"

def ready_key(room_id: int) -> str:
    return f"room:{room_id}:ready_users"

def muted_key(room_id: int) -> str:
    return f"room:{room_id}:muted_users"


async def get_muted_ids(room_id: int) -> list[int]:
    raw = await redis_client.get(muted_key(room_id))
    return json.loads(raw) if raw else []

async def save_muted_ids(room_id: int, ids: list[int]):
    await redis_client.set(muted_key(room_id), json.dumps(ids), ex=PLAYER_STATE_TTL)


async def get_ready_users(room_id: int) -> list:
    raw = await redis_client.get(ready_key(room_id))
    return json.loads(raw) if raw else []

async def save_ready_users(room_id: int, users: list):
    await redis_client.set(ready_key(room_id), json.dumps(users), ex=PLAYER_STATE_TTL)

async def set_waiting(room_id: int, value: bool):
    if value:
        await redis_client.set(waiting_key(room_id), "1", ex=PLAYER_STATE_TTL)
    else:
        await redis_client.delete(waiting_key(room_id))

async def is_waiting(room_id: int) -> bool:
    return await redis_client.get(waiting_key(room_id)) == "1"


# ── Плеер ────────────────────────────────────────────────────────────────────

async def save_player_state(room_id: int, state: dict):
    await redis_client.set(player_key(room_id), json.dumps(state), ex=PLAYER_STATE_TTL)

async def get_player_state(room_id: int) -> dict | None:
    raw = await redis_client.get(player_key(room_id))
    return json.loads(raw) if raw else None


# ── Очередь ──────────────────────────────────────────────────────────────────

async def get_queue(room_id: int) -> list:
    raw = await redis_client.get(queue_key(room_id))
    return json.loads(raw) if raw else []

async def save_queue(room_id: int, queue: list):
    await redis_client.set(queue_key(room_id), json.dumps(queue), ex=PLAYER_STATE_TTL)


# ── Таймлайн эмоций ──────────────────────────────────────────────────────────

async def get_timeline(room_id: int, video_id: str) -> list:
    if not video_id:
        return []
    raw = await redis_client.get(timeline_key(room_id, video_id))
    return json.loads(raw) if raw else []

async def save_timeline(room_id: int, video_id: str, data: list):
    await redis_client.set(timeline_key(room_id, video_id), json.dumps(data), ex=PLAYER_STATE_TTL)


# ── Обработчики WS-событий ───────────────────────────────────────────────────

async def handle_message(event: dict, room_id: int, user: User, db: AsyncSession):
    """Сохраняем сообщение в БД и рассылаем всем."""
    text = event.get("text", "").strip()
    if not text:
        return
    if len(text) > 1000:
        return
    muted = await get_muted_ids(room_id)
    if user.id in muted:
        return

    msg = Message(room_id=room_id, user_id=user.id, text=text)
    db.add(msg)
    await db.commit()
    await db.refresh(msg)

    await manager.broadcast(room_id, {
        "type": "chat",
        "id": msg.id,
        "user_id": user.id,
        "username": user.username,
        "avatar": user.avatar,
        "text": msg.text,
        "created_at": msg.created_at.isoformat(),
    })


async def handle_player_event(event: dict, room_id: int, user: User, db: AsyncSession):
    """Только admin комнаты или суперадмин может управлять плеером."""
    member = await room_service.get_member(db, room_id, user.id)
    is_room_admin = member and member.role == MemberRole.admin
    if not is_room_admin and not user.is_superuser:
        return

    action = event.get("action")  # play | pause | seek | change_video | sync
    allowed = {"play", "pause", "seek", "change_video", "sync"}
    if action not in allowed:
        return

    # sync — тихое обновление позиции без смены статуса воспроизведения
    if action == "sync":
        current_state = await get_player_state(room_id)
        if not current_state or not current_state.get("is_playing"):
            return
        updated = {
            **current_state,
            "position": event.get("position", current_state.get("position", 0)),
            "played_at": time.time(),
            "action": "play",
        }
        await save_player_state(room_id, updated)
        await manager.broadcast(room_id, {
            "type": "player",
            "action": "sync",
            "position": updated["position"],
            "played_at": updated["played_at"],
            "video_id": updated["video_id"],
            "is_playing": True,
        }, exclude_user_id=user.id)
        return

    current_state = await get_player_state(room_id)
    # Для seek сохраняем текущий is_playing — видео могло играть во время перемотки
    if action == "seek":
        was_playing = current_state.get("is_playing", False) if current_state else False
    else:
        was_playing = action == "play"

    state = {
        "action": action,
        "position": event.get("position", 0),
        "video_id": event.get("video_id") or (current_state.get("video_id") if current_state else None),
        "is_playing": was_playing,
        "played_at": time.time() if action == "play" else (current_state.get("played_at") if current_state and action == "seek" and was_playing else None),
    }

    if action == "change_video" and state["video_id"]:
        result = await db.execute(select(Room).where(Room.id == room_id))
        room = result.scalar_one_or_none()
        if room:
            # Очищаем таймлайн старого видео в Redis
            if room.current_video_id:
                await redis_client.delete(timeline_key(room_id, room.current_video_id))
            room.current_video_id = state["video_id"]
            await db.commit()
        # Включаем режим ожидания (зал ожидания)
        await set_waiting(room_id, True)
        await save_ready_users(room_id, [])

    await save_player_state(room_id, state)

    await manager.broadcast(room_id, {
        "type": "player",
        **state,
        "by": user.username,
    }, exclude_user_id=user.id)

    if action == "change_video":
        await manager.broadcast(room_id, {
            "type": "ready_update",
            "ready_users": [],
            "online_count": len(manager.get_connected_user_ids(room_id)),
        })


async def handle_reaction(event: dict, room_id: int, user: User, db: AsyncSession):
    """Реакция — летящий эмодзи поверх видео + запись в таймлайн."""
    emoji = event.get("emoji", "")
    if emoji not in ALLOWED_EMOJIS:
        return

    # Записываем в таймлайн эмоций если есть позиция
    time_pos = event.get("time")
    player_state = await get_player_state(room_id)
    video_id = player_state.get("video_id") if player_state else None

    if time_pos is not None and video_id and isinstance(time_pos, (int, float)) and time_pos >= 0:
        timeline = await get_timeline(room_id, video_id)
        timeline.append({
            "emoji": emoji,
            "time": float(time_pos),
            "username": user.username,
            "user_id": user.id,
        })
        await save_timeline(room_id, video_id, timeline)
        await manager.broadcast(room_id, {
            "type": "timeline_update",
            "timeline": timeline,
        })

    # Летящий эмодзи — рассылаем всем включая отправителя
    await manager.broadcast(room_id, {
        "type": "reaction",
        "emoji": emoji,
        "user_id": user.id,
        "username": user.username,
    })


async def handle_queue_event(event: dict, room_id: int, user: User, db: AsyncSession):
    """Управление очередью видео — только admin комнаты или суперадмин."""
    member = await room_service.get_member(db, room_id, user.id)
    is_room_admin = member and member.role == MemberRole.admin
    if not is_room_admin and not user.is_superuser:
        return

    action = event.get("action")  # add | remove | skip
    queue = await get_queue(room_id)

    if action == "add":
        video_id = str(event.get("video_id", "")).strip()
        if not video_id:
            return
        queue.append(video_id)
        await save_queue(room_id, queue)
        await manager.broadcast(room_id, {"type": "queue_update", "queue": queue})

    elif action == "remove":
        index = event.get("index", -1)
        if 0 <= index < len(queue):
            queue.pop(index)
            await save_queue(room_id, queue)
            await manager.broadcast(room_id, {"type": "queue_update", "queue": queue})

    elif action == "skip":
        if not queue:
            return
        next_video = queue.pop(0)
        await save_queue(room_id, queue)

        # Переключаем видео как change_video
        state = {
            "action": "change_video",
            "position": 0,
            "video_id": next_video,
            "is_playing": False,
            "played_at": None,
        }
        await save_player_state(room_id, state)

        result = await db.execute(select(Room).where(Room.id == room_id))
        room = result.scalar_one_or_none()
        if room:
            room.current_video_id = next_video
            await db.commit()

        await manager.broadcast(room_id, {
            "type": "player",
            "action": "change_video",
            "video_id": next_video,
            "position": 0,
            "is_playing": False,
            "played_at": None,
            "by": user.username,
        })
        await manager.broadcast(room_id, {"type": "queue_update", "queue": queue})


async def send_initial_state(room_id: int, user: User, db: AsyncSession):
    """Отправляем новому участнику текущее состояние комнаты."""
    # Последние 50 сообщений чата
    result = await db.execute(
        select(Message, User)
        .join(User, Message.user_id == User.id)
        .where(Message.room_id == room_id)
        .order_by(Message.created_at.desc())
        .limit(50)
    )
    rows = result.all()
    history = [
        {
            "id": msg.id,
            "user_id": u.id,
            "username": u.username,
            "avatar": u.avatar,
            "text": msg.text,
            "created_at": msg.created_at.isoformat(),
        }
        for msg, u in reversed(rows)
    ]

    player_state = await get_player_state(room_id)
    online_ids = manager.get_connected_user_ids(room_id)
    queue = await get_queue(room_id)

    video_id = player_state.get("video_id") if player_state else None
    timeline = await get_timeline(room_id, video_id) if video_id else []
    waiting = await is_waiting(room_id)
    ready_users = await get_ready_users(room_id) if waiting else []
    muted_ids = await get_muted_ids(room_id)

    # Получаем имена и аватары онлайн-пользователей
    online_users_result = await db.execute(
        select(User).where(User.id.in_(online_ids))
    )
    online_users = [
        {"id": u.id, "username": u.username, "avatar": u.avatar}
        for u in online_users_result.scalars().all()
    ]

    await manager.send_to(room_id, user.id, {
        "type": "init",
        "chat_history": history,
        "player_state": player_state,
        "online_user_ids": online_ids,
        "online_users": online_users,
        "queue": queue,
        "timeline": timeline,
        "is_waiting": waiting,
        "ready_users": ready_users,
        "muted_user_ids": muted_ids,
    })


async def handle_ready_event(event: dict, room_id: int, user: User, db: AsyncSession):
    """Пользователь нажал 'Готов' — досмотрел рекламу."""
    ready = await get_ready_users(room_id)
    if not any(u["id"] == user.id for u in ready):
        ready.append({"id": user.id, "username": user.username, "avatar": user.avatar})
        await save_ready_users(room_id, ready)

    online_count = len(manager.get_connected_user_ids(room_id))
    await manager.broadcast(room_id, {
        "type": "ready_update",
        "ready_users": ready,
        "online_count": online_count,
    })


async def handle_countdown_event(event: dict, room_id: int, user: User, db: AsyncSession):
    """Только admin комнаты или суперадмин запускает обратный отсчёт."""
    member = await room_service.get_member(db, room_id, user.id)
    is_room_admin = member and member.role == MemberRole.admin
    if not is_room_admin and not user.is_superuser:
        return

    await set_waiting(room_id, False)
    await redis_client.delete(ready_key(room_id))

    await manager.broadcast(room_id, {"type": "countdown"})


async def handle_moderation_event(event: dict, room_id: int, user: User, db: AsyncSession):
    """Мут/кик участника — только хост комнаты или суперадмин."""
    member = await room_service.get_member(db, room_id, user.id)
    is_room_admin = member and member.role == MemberRole.admin
    if not is_room_admin and not user.is_superuser:
        return

    action = event.get("action")          # mute | unmute | kick
    target_id = event.get("user_id")
    if not target_id or target_id == user.id:
        return

    target_result = await db.execute(select(User).where(User.id == target_id))
    target = target_result.scalar_one_or_none()
    if not target:
        return
    # Суперадмин может модерировать всех. Обычный хост не может трогать суперадминов
    if not user.is_superuser and target.is_superuser:
        return

    if action == "mute":
        muted = await get_muted_ids(room_id)
        if target_id not in muted:
            muted.append(target_id)
            await save_muted_ids(room_id, muted)
        await manager.send_to(room_id, target_id, {
            "type": "moderated", "action": "mute",
            "user_id": target_id, "by": user.username,
        })
        await manager.broadcast(room_id, {
            "type": "moderated", "action": "mute",
            "user_id": target_id, "username": target.username, "by": user.username,
        }, exclude_user_id=target_id)

    elif action == "unmute":
        muted = await get_muted_ids(room_id)
        muted = [uid for uid in muted if uid != target_id]
        await save_muted_ids(room_id, muted)
        await manager.send_to(room_id, target_id, {
            "type": "moderated", "action": "unmute",
            "user_id": target_id,
        })
        await manager.broadcast(room_id, {
            "type": "moderated", "action": "unmute",
            "user_id": target_id, "username": target.username, "by": user.username,
        }, exclude_user_id=target_id)

    elif action == "kick":
        await manager.broadcast(room_id, {
            "type": "moderated", "action": "kick",
            "user_id": target_id, "username": target.username, "by": user.username,
        }, exclude_user_id=target_id)
        await manager.send_to(room_id, target_id, {
            "type": "moderated", "action": "kick",
            "user_id": target_id,
        })
        await manager.kick_user(room_id, target_id)
