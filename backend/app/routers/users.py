from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.database import get_db
from app.services.deps import get_current_user
from app.services.auth import verify_password, hash_password
from app.models.user import User
from app.models.room import Room, RoomMember
from app.schemas.user import UserProfile, PasswordChange, AvatarUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserProfile)
async def get_my_profile(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rooms_created = (await db.execute(
        select(func.count()).select_from(Room).where(Room.owner_id == current_user.id)
    )).scalar()

    rooms_joined = (await db.execute(
        select(func.count()).select_from(RoomMember).where(RoomMember.user_id == current_user.id)
    )).scalar()

    return UserProfile(
        id=current_user.id,
        username=current_user.username,
        email=current_user.email,
        is_superuser=current_user.is_superuser,
        created_at=current_user.created_at,
        rooms_created=rooms_created or 0,
        rooms_joined=rooms_joined or 0,
        avatar=current_user.avatar,
    )


@router.patch("/me/password")
async def change_password(
    data: PasswordChange,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await verify_password(data.old_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Неверный текущий пароль")
    if len(data.new_password) < 4:
        raise HTTPException(status_code=400, detail="Пароль слишком короткий")
    current_user.hashed_password = await hash_password(data.new_password)
    db.add(current_user)
    await db.commit()
    return {"detail": "Пароль изменён"}


@router.post("/me/avatar")
async def update_avatar(
    data: AvatarUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not data.avatar.startswith("data:image/"):
        raise HTTPException(status_code=400, detail="Неверный формат изображения")
    if len(data.avatar) > 500_000:
        raise HTTPException(status_code=400, detail="Изображение слишком большое (максимум ~375 КБ)")
    current_user.avatar = data.avatar
    db.add(current_user)
    await db.commit()
    return {"detail": "Аватар обновлён"}
