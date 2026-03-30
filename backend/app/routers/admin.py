from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.database import get_db
from app.models.user import User
from app.models.room import Room, RoomMember
from app.services.deps import get_superuser
from app.services.auth import hash_password
from app.config import settings
from app.websocket.manager import manager
from pydantic import BaseModel, EmailStr

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

    model_config = {"from_attributes": True}


class CreateAdminIn(BaseModel):
    username: str
    email: EmailStr
    password: str


class PromoteIn(BaseModel):
    is_superuser: bool


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
