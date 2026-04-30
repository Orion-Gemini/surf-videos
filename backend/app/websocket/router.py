from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.services.auth import decode_token
from app.services import room as room_service
from app.models.user import User
from app.models.room import RoomType
from sqlalchemy import select
from app.websocket.manager import manager
from app.websocket.handlers import (
    handle_message,
    handle_player_event,
    handle_reaction,
    handle_queue_event,
    handle_ready_event,
    handle_countdown_event,
    handle_moderation_event,
    send_initial_state,
)

router = APIRouter()


async def get_user_from_token(token: str, db: AsyncSession) -> User | None:
    payload = decode_token(token)
    if not payload:
        return None
    try:
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        return None
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


@router.websocket("/ws/rooms/{room_id}")
async def room_websocket(
    room_id: int,
    ws: WebSocket,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    # Аутентификация
    user = await get_user_from_token(token, db)
    room = await room_service.get_room_by_id(db, room_id) if user else None

    # Проверяем права до accept
    deny_code = None
    if not user:
        deny_code = 4001
    elif not room:
        deny_code = 4004
    elif room.type == RoomType.private:
        member = await room_service.get_member(db, room_id, user.id)
        if not member:
            deny_code = 4003

    await ws.accept()

    if deny_code:
        await ws.close(code=deny_code)
        return

    # Для публичной — добавляем в БД если не был
    if room.type == RoomType.public:
        existing = await room_service.get_member(db, room_id, user.id)
        if not existing:
            await room_service.join_room(db, room, user)
    manager.connect(room_id, user.id, ws)

    try:
        # Уведомляем остальных о подключении
        await manager.broadcast(room_id, {
            "type": "user_joined",
            "user_id": user.id,
            "username": user.username,
            "avatar": user.avatar,
        }, exclude_user_id=user.id)

        # Отправляем начальное состояние новому участнику
        await send_initial_state(room_id, user, db)

        while True:
            try:
                event = await ws.receive_json()
            except WebSocketDisconnect:
                raise
            except Exception:
                # Невалидный JSON — пропускаем без разрыва соединения
                continue
            event_type = event.get("type")

            if event_type == "chat":
                await handle_message(event, room_id, user, db)
            elif event_type == "player":
                await handle_player_event(event, room_id, user, db)
            elif event_type == "reaction":
                await handle_reaction(event, room_id, user, db)
            elif event_type == "queue":
                await handle_queue_event(event, room_id, user, db)
            elif event_type == "ready":
                await handle_ready_event(event, room_id, user, db)
            elif event_type == "countdown":
                await handle_countdown_event(event, room_id, user, db)
            elif event_type == "moderation":
                await handle_moderation_event(event, room_id, user, db)

    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(room_id, user.id)
        await manager.broadcast(room_id, {
            "type": "user_left",
            "user_id": user.id,
            "username": user.username,
        })
