from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str
    REDIS_URL: str = "redis://localhost:6379"
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000
    SUPERUSER_USERNAME: str = "admin"
    SUPERUSER_PASSWORD: str = "admin123"
    SUPERUSER_EMAIL: str = "admin@surfvideos.local"

    class Config:
        env_file = ".env"


settings = Settings()
