from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete as sql_delete
from sqlalchemy.orm import selectinload
from app.database import get_db
from app.models.user import User
from app.models.room import Room, RoomMember
from app.models.message import Message
from app.models.deletion_request import DeletionRequest
from app.services.deps import get_superuser
from app.services.auth import hash_password
from app.config import settings
from app.websocket.manager import manager
from pydantic import BaseModel, EmailStr


async def delete_user_cascade(user_id: int, db: AsyncSession) -> None:
    """Удаляет пользователя с ручным каскадом, т.к. FK без ON DELETE CASCADE."""
    owned_ids_result = await db.execute(select(Room.id).where(Room.owner_id == user_id))
    owned_ids = list(owned_ids_result.scalars())

    if owned_ids:
        await db.execute(sql_delete(Message).where(Message.room_id.in_(owned_ids)))
        await db.execute(sql_delete(RoomMember).where(RoomMember.room_id.in_(owned_ids)))
        await db.execute(sql_delete(Room).where(Room.id.in_(owned_ids)))

    await db.execute(sql_delete(Message).where(Message.user_id == user_id))
    await db.execute(sql_delete(RoomMember).where(RoomMember.user_id == user_id))
    await db.execute(sql_delete(User).where(User.id == user_id))

router = APIRouter(prefix="/admin", tags=["admin"])


class UserAdminOut(BaseModel):
    id: int
    username: str
    email: str
    is_active: bool
    is_superuser: bool

    model_config = {"from_attributes": True}


class RoomAdminOut(BaseModel):
    id: int
    name: str
    type: str
    owner_id: int
    owner_username: str
    online_count: int = 0

    model_config = {"from_attributes": True}


class CreateAdminIn(BaseModel):
    username: str
    email: EmailStr
    password: str


class PromoteIn(BaseModel):
    is_superuser: bool


class BanIn(BaseModel):
    is_active: bool


@router.get("/users", response_model=list[UserAdminOut])
async def list_users(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_superuser),
):
    result = await db.execute(select(User).order_by(User.id))
    return result.scalars().all()


@router.patch("/users/{user_id}/promote", response_model=UserAdminOut)
async def promote_user(
    user_id: int,
    data: PromoteIn,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_superuser),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if user.id == current.id:
        raise HTTPException(status_code=400, detail="Нельзя изменить собственный статус")
    if user.username == settings.SUPERUSER_USERNAME:
        raise HTTPException(status_code=403, detail="Нельзя изменить статус истинного суперадмина")
    user.is_superuser = data.is_superuser
    await db.commit()
    await db.refresh(user)
    return user


@router.patch("/users/{user_id}/ban", response_model=UserAdminOut)
async def ban_user(
    user_id: int,
    data: BanIn,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_superuser),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if user.id == current.id:
        raise HTTPException(status_code=400, detail="Нельзя заблокировать самого себя")
    if user.username == settings.SUPERUSER_USERNAME:
        raise HTTPException(status_code=403, detail="Нельзя заблокировать суперадмина")
    user.is_active = data.is_active
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_superuser),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if user.id == current.id:
        raise HTTPException(status_code=400, detail="Нельзя удалить самого себя")
    if user.username == settings.SUPERUSER_USERNAME:
        raise HTTPException(status_code=403, detail="Нельзя удалить суперадмина")
    await delete_user_cascade(user_id, db)
    await db.commit()


@router.post("/users", response_model=UserAdminOut, status_code=status.HTTP_201_CREATED)
async def create_admin(
    data: CreateAdminIn,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_superuser),
):
    # Проверяем уникальность
    exists = await db.execute(
        select(User).where((User.username == data.username) | (User.email == data.email))
    )
    if exists.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Имя пользователя или email уже заняты")

    user = User(
        username=data.username,
        email=data.email,
        hashed_password=await hash_password(data.password),
        is_active=True,
        is_superuser=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.get("/rooms", response_model=list[RoomAdminOut])
async def list_all_rooms(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_superuser),
):
    result = await db.execute(
        select(Room).options(selectinload(Room.owner)).order_by(Room.id)
    )
    rooms = result.scalars().all()
    return [
        RoomAdminOut(
            id=r.id,
            name=r.name,
            type=r.type.value,
            owner_id=r.owner_id,
            owner_username=r.owner.username,
            online_count=len(manager.rooms.get(r.id, {})),
        )
        for r in rooms
    ]


@router.delete("/rooms/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_room(
    room_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_superuser),
):
    result = await db.execute(select(Room).where(Room.id == room_id))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Комната не найдена")
    await manager.kick_room(room_id)
    await db.delete(room)
    await db.commit()


class DeletionRequestAdminOut(BaseModel):
    id: int
    user_id: int
    username: str
    email: str
    reason: str | None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("/deletion-requests", response_model=list[DeletionRequestAdminOut])
async def list_deletion_requests(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_superuser),
):
    result = await db.execute(
        select(DeletionRequest)
        .options(selectinload(DeletionRequest.user))
        .order_by(DeletionRequest.status, DeletionRequest.created_at.desc())
    )
    rows = result.scalars().all()
    return [
        DeletionRequestAdminOut(
            id=r.id,
            user_id=r.user_id,
            username=r.user.username,
            email=r.user.email,
            reason=r.reason,
            status=r.status,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.post("/deletion-requests/{request_id}/approve", status_code=status.HTTP_204_NO_CONTENT)
async def approve_deletion_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_superuser),
):
    result = await db.execute(
        select(DeletionRequest)
        .options(selectinload(DeletionRequest.user))
        .where(DeletionRequest.id == request_id)
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    if req.status != "pending":
        raise HTTPException(status_code=400, detail="Заявка уже обработана")
    if req.user.username == settings.SUPERUSER_USERNAME:
        raise HTTPException(status_code=403, detail="Нельзя удалить суперадмина")
    if req.user_id == current.id:
        raise HTTPException(status_code=400, detail="Нельзя удалить самого себя")
    await delete_user_cascade(req.user_id, db)
    await db.commit()


@router.post("/deletion-requests/{request_id}/reject", status_code=status.HTTP_204_NO_CONTENT)
async def reject_deletion_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_superuser),
):
    result = await db.execute(
        select(DeletionRequest).where(DeletionRequest.id == request_id)
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    if req.status != "pending":
        raise HTTPException(status_code=400, detail="Заявка уже обработана")
    req.status = "rejected"
    req.resolved_at = datetime.now(timezone.utc)
    await db.commit()
