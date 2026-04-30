# Как подключить продакшн окружение

## 1. backend/.env — заменить на продакшн

```
DATABASE_URL=mysql+aiomysql://<user>:<password>@<host>:<port>/defaultdb
REDIS_URL=rediss://default:<password>@<host>:<port>
SECRET_KEY=<your-secret-key>
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
APP_HOST=0.0.0.0
APP_PORT=8000
```

> Реальные значения хранятся локально в `backend/.env` (в .gitignore).

## 2. frontend/.env — заменить на Render URL

```
VITE_BACKEND_URL=https://surf-videos.onrender.com
```

## 3. backend/app/database.py — SSL для Aiven (уже должно быть)

```python
import ssl
ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE
engine = create_async_engine(settings.DATABASE_URL, echo=False, connect_args={"ssl": ssl_ctx})
```

## 4. Запушить в git (Render деплоит автоматически)

```bash
git add backend/app/database.py backend/.env frontend/.env
git commit -m "fix: switch to production env"
git push
```

## 5. Vercel — обновить переменную

Vercel Dashboard → surf-videos → Settings → Environment Variables
→ `VITE_BACKEND_URL` = `https://surf-videos.onrender.com` → Redeploy

## Платформы

| Компонент | Платформа | URL |
|-----------|-----------|-----|
| Frontend  | Vercel    | https://surf-videos-psi.vercel.app |
| Backend   | Render    | https://surf-videos.onrender.com |
| MySQL     | Aiven     | mysql-1c2125cd-ptptoat-2cd2.f.aivencloud.com:23445 (истекает ~01.05.2026) |
| Redis     | Upstash   | on-macaque-74828.upstash.io:6379 |

## Локальная разработка

```
DATABASE_URL=mysql+aiomysql://root:root@localhost:3306/watchparty
REDIS_URL=redis://localhost:6379
VITE_BACKEND_URL=http://localhost:8000
```
