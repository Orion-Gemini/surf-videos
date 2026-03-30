import random
import string
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from app.models.room import Room, RoomMember, RoomType, MemberRole
from app.models.user import User


def generate_invite_code(length: int = 8) -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=length))


async def create_room(db: AsyncSession, name: str, room_type: RoomType, owner: User) -> Room:
    invite_code = generate_invite_code() if room_type == RoomType.private else None

    room = Room(name=name, type=room_type, invite_code=invite_code, owner_id=owner.id)
    db.add(room)
    await db.flush()  # получаем room.id до commit

    # Владелец сразу становится admin
    member = RoomMember(room_id=room.id, user_id=owner.id, role=MemberRole.admin)
    db.add(member)

    await db.commit()
    await db.refresh(room)
    return room


async def get_public_rooms(db: AsyncSession) -> list:
    result = await db.execute(
        select(Room, func.count(RoomMember.id).label("member_count"))
        .join(RoomMember, Room.id == RoomMember.room_id, isouter=True)
        .options(selectinload(Room.owner))
        .where(Room.type == RoomType.public)
        .group_by(Room.id)
        .order_by(Room.created_at.desc())
    )
    return result.all()


async def get_room_by_id(db: AsyncSession, room_id: int) -> Room | None:
    result = await db.execute(
        select(Room)
        .options(selectinload(Room.owner), selectinload(Room.members).selectinload(RoomMember.user))
        .where(Room.id == room_id)
    )
    return result.scalar_one_or_none()


async def get_room_by_code(db: AsyncSession, code: str) -> Room | None:
    result = await db.execute(
        select(Room).options(selectinload(Room.owner)).where(Room.invite_code == code)
    )
    return result.scalar_one_or_none()


async def get_member(db: AsyncSession, room_id: int, user_id: int) -> RoomMember | None:
    result = await db.execute(
        select(RoomMember).where(
            RoomMember.room_id == room_id, RoomMember.user_id == user_id
        )
    )
    return result.scalar_one_or_none()


async def get_user_rooms(db: AsyncSession, user_id: int) -> list[Room]:
    result = await db.execute(
        select(Room)
        .join(RoomMember, Room.id == RoomMember.room_id)
        .options(selectinload(Room.owner))
        .where(RoomMember.user_id == user_id)
        .order_by(Room.created_at.desc())
    )
    return result.scalars().all()


async def join_room(db: AsyncSession, room: Room, user: User) -> RoomMember:
    member = RoomMember(room_id=room.id, user_id=user.id, role=MemberRole.viewer)
    db.add(member)
    await db.commit()
    await db.refresh(member)
    return member
