from datetime import datetime
from sqlalchemy import Integer, String, Boolean, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    avatar: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    owned_rooms: Mapped[list["Room"]] = relationship("Room", back_populates="owner")
    messages: Mapped[list["Message"]] = relationship("Message", back_populates="user")
    room_members: Mapped[list["RoomMember"]] = relationship("RoomMember", back_populates="user")
