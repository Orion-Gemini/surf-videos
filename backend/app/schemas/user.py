from pydantic import BaseModel, EmailStr
from datetime import datetime


class UserRegister(BaseModel):
    username: str
    email: EmailStr
    password: str


class UserLogin(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    email: str
    is_superuser: bool = False

    model_config = {"from_attributes": True}


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserProfile(BaseModel):
    id: int
    username: str
    email: str
    is_superuser: bool = False
    created_at: datetime
    rooms_created: int
    rooms_joined: int
    avatar: str | None = None

    model_config = {"from_attributes": True}


class PasswordChange(BaseModel):
    old_password: str
    new_password: str


class AvatarUpdate(BaseModel):
    avatar: str  # base64 data URL
