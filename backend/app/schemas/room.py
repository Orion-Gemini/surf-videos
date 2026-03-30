from pydantic import BaseModel
from typing import Optional
from app.models.room import RoomType, MemberRole
from app.schemas.user import UserOut


class RoomCreate(BaseModel):
    name: str
    type: RoomType = RoomType.public


class RoomOut(BaseModel):
    id: int
    name: str
    type: RoomType
    invite_code: Optional[str]
    owner: UserOut
    member_count: int

    model_config = {"from_attributes": True}


class RoomDetail(RoomOut):
    current_video_id: Optional[str]


class RoomMemberOut(BaseModel):
    user: UserOut
    role: MemberRole

    model_config = {"from_attributes": True}


class JoinByCode(BaseModel):
    invite_code: str
