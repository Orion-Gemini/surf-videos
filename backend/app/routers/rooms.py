from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
import httpx
from app.database import get_db
from app.models.user import User
from app.models.room import RoomType
from app.schemas.room import RoomCreate, RoomOut, RoomDetail, RoomMemberOut, JoinByCode
from app.schemas.user import UserOut
from app.services.deps import get_current_user
from app.services import room as room_service
from app.websocket.manager import manager

router = APIRouter(prefix="/rooms", tags=["rooms"])


@router.post("", response_model=RoomDetail, status_code=status.HTTP_201_CREATED)
async def create_room(
    data: RoomCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    room = await room_service.create_room(db, data.name, data.type, current_user)
    return RoomDetail(
        id=room.id,
        name=room.name,
        type=room.type,
        invite_code=room.invite_code,
        owner=UserOut.model_validate(room.owner),
        member_count=1,
        current_video_id=room.current_video_id,
    )


@router.get("", response_model=list[RoomOut])
async def list_public_rooms(db: AsyncSession = Depends(get_db)):
    rows = await room_service.get_public_rooms(db)
    result = []
    for room, _ in rows:
        online_count = len(manager.rooms.get(room.id, {}))
        result.append(RoomOut(
            id=room.id,
            name=room.name,
            type=room.type,
            invite_code=None,  # не раскрываем код в публичном списке
            owner=UserOut.model_validate(room.owner),
            member_count=online_count,
        ))
    return result


@router.get("/my", response_model=list[RoomOut])
async def my_rooms(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rooms = await room_service.get_user_rooms(db, current_user.id)
    result = []
    for room in rooms:
        online_count = len(manager.rooms.get(room.id, {}))
        result.append(RoomOut(
            id=room.id,
            name=room.name,
            type=room.type,
            invite_code=room.invite_code if room.type == RoomType.private else None,
            owner=UserOut.model_validate(room.owner),
            member_count=online_count,
        ))
    return result


@router.get("/{room_id}", response_model=RoomDetail)
async def get_room(
    room_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    room = await room_service.get_room_by_id(db, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    # #17: приватную комнату видит только участник или суперадмин
    if room.type == RoomType.private and not current_user.is_superuser:
        member = await room_service.get_member(db, room.id, current_user.id)
        if not member:
            raise HTTPException(status_code=403, detail="Access denied")

    member_count = len(room.members)
    return RoomDetail(
        id=room.id,
        name=room.name,
        type=room.type,
        invite_code=room.invite_code,
        owner=UserOut.model_validate(room.owner),
        member_count=member_count,
        current_video_id=room.current_video_id,
    )


@router.post("/join", response_model=RoomDetail)
async def join_by_code(
    data: JoinByCode,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    room = await room_service.get_room_by_code(db, data.invite_code)
    if not room:
        raise HTTPException(status_code=404, detail="Invalid invite code")

    # Уже в комнате?
    existing = await room_service.get_member(db, room.id, current_user.id)
    if not existing:
        await room_service.join_room(db, room, current_user)

    # Перезагружаем комнату с актуальным member_count
    room = await room_service.get_room_by_id(db, room.id)
    return RoomDetail(
        id=room.id,
        name=room.name,
        type=room.type,
        invite_code=room.invite_code,
        owner=UserOut.model_validate(room.owner),
        member_count=len(room.members),
        current_video_id=room.current_video_id,
    )


@router.get("/video-info/{video_id}")
async def get_video_info(video_id: str):
    """Проксируем запрос к Rutube API — обходим CORS."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"https://rutube.ru/api/video/{video_id}/",
                headers={"User-Agent": "Mozilla/5.0"},
            )
            if resp.status_code == 200:
                data = resp.json()
                return {
                    "title": data.get("title"),
                    "thumbnail": data.get("thumbnail_url"),
                }
    except Exception:
        pass
    return {"title": None, "thumbnail": None}


@router.delete("/{room_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
async def leave_room(
    room_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    room = await room_service.get_room_by_id(db, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Комната не найдена")
    if room.owner_id == current_user.id:
        raise HTTPException(status_code=400, detail="Владелец не может покинуть комнату — только удалить её")
    member = await room_service.get_member(db, room_id, current_user.id)
    if not member:
        raise HTTPException(status_code=404, detail="Вы не состоите в этой комнате")
    await db.delete(member)
    await db.commit()


@router.delete("/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_room(
    room_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    room = await room_service.get_room_by_id(db, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    # Только хост комнаты или суперадмин
    if room.owner_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Only room host or superuser can delete")

    await manager.kick_room(room_id)
    await db.delete(room)
    await db.commit()


@router.get("/{room_id}/members", response_model=list[RoomMemberOut])
async def get_members(
    room_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    room = await room_service.get_room_by_id(db, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    member = await room_service.get_member(db, room_id, current_user.id)
    if not member:
        raise HTTPException(status_code=403, detail="Access denied")

    return [
        RoomMemberOut(user=UserOut.model_validate(m.user), role=m.role)
        for m in room.members
    ]
