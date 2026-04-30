from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from app.database import engine, Base, AsyncSessionLocal
import app.models  # noqa: F401 — регистрируем модели
from app.routers import auth, rooms, admin, users
from app.websocket.router import router as ws_router

app = FastAPI(title="Surf Videos API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(rooms.router)
app.include_router(admin.router)
app.include_router(users.router)
app.include_router(ws_router)


@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Добавляем is_superuser если колонки ещё нет (create_all не мигрирует существующие таблицы)
        result = await conn.execute(text(
            "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'is_superuser'"
        ))
        if result.scalar() == 0:
            await conn.execute(text(
                "ALTER TABLE users ADD COLUMN is_superuser TINYINT(1) NOT NULL DEFAULT 0"
            ))
        result2 = await conn.execute(text(
            "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'avatar'"
        ))
        if result2.scalar() == 0:
            await conn.execute(text(
                "ALTER TABLE users ADD COLUMN avatar LONGTEXT NULL"
            ))
    await ensure_superuser()


async def ensure_superuser():
    """Создаём суперадмина при первом запуске если его нет."""
    from sqlalchemy import select
    from app.models.user import User
    from app.services.auth import hash_password
    from app.config import settings

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(User).where(User.username == settings.SUPERUSER_USERNAME)
        )
        existing = result.scalar_one_or_none()
        if not existing:
            superuser = User(
                username=settings.SUPERUSER_USERNAME,
                email=settings.SUPERUSER_EMAIL,
                hashed_password=await hash_password(settings.SUPERUSER_PASSWORD),
                is_active=True,
                is_superuser=True,
            )
            db.add(superuser)
            await db.commit()


@app.get("/health")
async def health():
    return {"status": "ok"}
