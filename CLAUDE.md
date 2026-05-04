# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Surf Videos — дипломная работа. Платформа для синхронного просмотра видео с Rutube в реальном времени. Backend на FastAPI + WebSockets, frontend на React 19 + Vite.

## Commands

### Backend
```bash
cd backend
pip install -r requirements.txt
python run.py          # запуск на localhost:8000 с reload
```

Требует `.env` файл в `backend/` (см. `.env.example`):
```
DATABASE_URL=mysql+aiomysql://user:pass@localhost/dbname
REDIS_URL=redis://localhost:6379
SECRET_KEY=your-secret-key
```

Таблицы создаются автоматически при старте через `Base.metadata.create_all` в `app/main.py`.

### Frontend
```bash
cd frontend
npm install
npm run dev      # localhost:5173
npm run build
npm run lint     # eslint
```

## Architecture

### Backend (`backend/app/`)

**Слои:**
- `models/` — SQLAlchemy ORM: `User`, `Room`+`RoomMember`+`RoomType`+`MemberRole`, `Message`
- `schemas/` — Pydantic модели для валидации HTTP запросов/ответов
- `services/` — бизнес-логика: `auth.py` (JWT+bcrypt), `room.py` (CRUD), `deps.py` (FastAPI dependency `get_current_user`)
- `routers/` — HTTP endpoints: `auth.py` (register/login), `rooms.py` (CRUD + join by invite code), `admin.py` (управление пользователями и комнатами), `users.py` (профиль, аватар)
- `websocket/` — real-time слой (см. ниже)

**WebSocket (`websocket/`):**
- `manager.py` — `ConnectionManager`: in-memory `dict[room_id -> dict[user_id -> WebSocket]]`, методы `connect/disconnect/broadcast/send_to`
- `router.py` — единственный WS endpoint `/ws/rooms/{room_id}?token=...`: аутентификация → `ws.accept()` → `send_initial_state` → event loop
- `handlers.py` — обработчики событий по типу:
  - `chat` → `handle_message`: сохраняет в MySQL, бродкаст
  - `player` → `handle_player_event`: только admin (или суперадмин), сохраняет в Redis, бродкаст (exclude_user_id=sender)
  - `reaction` → `handle_reaction`: летящий эмодзи + запись в Redis timeline
  - `queue` → `handle_queue_event`: add/remove/skip очереди в Redis
  - `ready` → `handle_ready_event`: зал ожидания — пользователь готов, бродкаст `ready_update`
  - `countdown` → `handle_countdown_event`: только admin, запускает обратный отсчёт перед стартом
  - `moderation` → handle mute/unmute/kick: только admin/суперадмин, управляет `muted_users` в Redis или закрывает WS кодом 4011

**Redis ключи** (TTL 24ч):
- `room:{id}:player` — текущее состояние плеера (action, position, video_id, is_playing, played_at)
- `room:{id}:queue` — очередь видео (JSON list)
- `room:{id}:video:{vid}:timeline` — таймлайн реакций для видео (JSON list)
- `room:{id}:waiting` — флаг режима зала ожидания (JSON bool)
- `room:{id}:ready_users` — список готовых пользователей (JSON list `{id, username, avatar}`)
- `room:{id}:muted_users` — список замученных user_id (JSON list)

**Авторизация WebSocket:** токен передаётся через query param `?token=...`, декодируется до `ws.accept()`, отказ через `ws.close(code=...)` после accept. Коды: 4001 (нет токена), 4003 (нет доступа к приватной комнате), 4004 (комната не найдена), 4010 (kick room / удаление комнаты), 4011 (kick user модератором).

### Frontend (`frontend/src/`)

**Роутинг** (`App.jsx`): `/auth` → `AuthPage`, `/` → `LobbyPage` (private), `/room/:id` → `RoomPage` (private), `/profile` → `ProfilePage` (private).

**Стейт:**
- `store/auth.js` — Zustand: token + user в localStorage, `login(token, user)` / `logout()`
- `store/theme.js` — Zustand: dark/light тема, `toggle()` пишет в localStorage и `document.documentElement.setAttribute("data-theme", ...)`

**API:** `api.js` — axios instance на `VITE_BACKEND_URL || "http://localhost:8000"`, interceptor добавляет `Authorization: Bearer {token}`.

**Тема:** CSS-переменные (`--c-bg`, `--c-surface`, `--c-accent` и др.) в `index.css`. По умолчанию — светлая тема (`:root`), `[data-theme="dark"]` переопределяет переменные на тёмные.

**RoomPage** (`pages/RoomPage.jsx`) — основная сложность:
- Rutube embed iframe управляется через `postMessage` API (`player:play`, `player:pause`, `player:setCurrentTime`, `player:mute` и др.)
- **Join overlay**: iframe не рендерится до клика пользователя (`showJoinOverlay` state), чтобы не нарушать autoplay policy браузера
- **Sync при входе**: состояние плеера приходит в `init` WS-событии → сохраняется в `pendingStateRef` → применяется в `player:ready` postMessage callback
- **Viewer autoplay**: `?autoplay=1` добавляется к embed URL для всех пользователей; admin подавляет эхо-событие через `suppressPlayRef`
- **NaN защита**: вся работа с position через `isFinite(Number(x)) ? Number(x) : 0`
- **Live события пока overlay показан**: обновляют `pendingStateRef` чтобы при входе применилось актуальное состояние
- `handlersRef` паттерн в `useWebSocket` предотвращает stale closure на WS callbacks

**WebSocket hook** (`hooks/useWebSocket.js`): `cancelled` флаг + обработка `CONNECTING` состояния для React StrictMode double-mount.

### WS protocol (client ↔ server)

**Клиент → сервер:**
```js
{ type: "chat", text }
{ type: "player", action: "play"|"pause"|"seek"|"change_video"|"sync", position, video_id }
{ type: "reaction", emoji, time }
{ type: "queue", action: "add"|"remove"|"skip", video_id?, index? }
{ type: "ready" }
{ type: "countdown" }
{ type: "moderation", action: "mute"|"unmute"|"kick", user_id }
```

**Сервер → клиент:**
```js
{ type: "init", chat_history, player_state, online_user_ids, online_users: [{id, username, avatar}], queue, timeline, is_waiting, ready_users, muted_user_ids }
{ type: "chat", id, user_id, username, text, created_at }
{ type: "player", action, position, video_id, is_playing, played_at, by }
{ type: "reaction", emoji, user_id, username }
{ type: "queue_update", queue }
{ type: "timeline_update", timeline }
{ type: "user_joined"|"user_left", user_id, username }
{ type: "ready_update", ready_users }
{ type: "countdown" }
{ type: "moderated", action, user_id, username, by }
```

### Роли

`MemberRole.admin` — владелец комнаты (создатель). Только admin управляет плеером, очередью и модерацией. Роль проверяется в `handlers.py` через `room_service.get_member()`. Суперадмин (`is_superuser=True`) имеет те же права в **любой** комнате без проверки членства.
