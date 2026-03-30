# Surf Videos — История изменений и состояние проекта

## Что из себя представляет проект

Дипломная работа (команда 3 человека). Платформа для совместного просмотра видео с Rutube в реальном времени.

**Мини промт**
Все изменения или баги записывай сюда D:\VS code\Diplom\CHANGELOG.md

**Стек:**
- Frontend: React 19 + Vite, Zustand (стейт), CSS Modules
- Backend: Python + FastAPI + WebSockets (asyncio)
- БД: MySQL (SQLAlchemy async) + Redis (состояние плеера)
- Плеер: Rutube embed iframe + postMessage API
- Деплой: ngrok (для демо)

**Структура backend:**
- `app/models/` — User, Room, RoomMember, Message
- `app/schemas/` — Pydantic валидация
- `app/services/` — auth (JWT+bcrypt), room CRUD, deps (get_current_user)
- `app/routers/` — auth (register/login), rooms (CRUD + join by code)
- `app/websocket/` — manager (ConnectionManager), handlers (chat, player, init), router

**Структура frontend:**
- `pages/AuthPage.jsx` — логин/регистрация
- `pages/LobbyPage.jsx` — список публичных комнат, создание, вход по коду
- `pages/RoomPage.jsx` — плеер Rutube + кастомные контролы + чат + синхронизация
- `hooks/useWebSocket.js` — WebSocket хук
- `store/auth.js` — Zustand стор (token, user в localStorage)
- `store/theme.js` — Zustand стор (dark/light тема в localStorage)

---

## Реализованный MVP (всё работает)

- Регистрация / логин (JWT)
- Создание комнат (публичная / приватная с invite-кодом)
- Список публичных комнат в лобби
- Роли: admin (владелец комнаты) / viewer
- Синхронизированный плеер Rutube: play, pause, seek (только admin управляет)
- Состояние плеера сохраняется в Redis (TTL 24ч), новый участник получает актуальное состояние
- Чат внутри комнаты (история 50 последних сообщений при входе)
- Онлайн-счётчик участников
- Тёмная и светлая тема (переключатель в шапке)
- Логи действий в чате ("Алексей поставил на паузу")
- Кнопка mute (иконка громкости кликабельна)
- Оверлей "Нажмите чтобы начать просмотр" перед загрузкой iframe

---

## Цветовая палитра (текущая)

По умолчанию — **светлая тема**.

- Light тема (`:root`): bg `#EDE8D8` (крем), text `#27374D`, accent `#DFA06E` (янтарь)
- Dark тема (`[data-theme="dark"]`): bg `#27374D`, surface `#304560`, surface2 `#3A5472`, border2 `#526D82`, text2 `#9DB2BF`, accent `#DFA06E`

Все цвета через CSS-переменные (`--c-bg`, `--c-accent` и т.д.) в `index.css`.
`[data-theme="dark"]` применяется через `document.documentElement.setAttribute`.

---

## История исправленных багов

### Баг 1: Видео играло под оверлеем (join overlay)
**Проблема:** iframe загружался сразу при монтировании компонента, видео играло под тёмным оверлеем.
**Фикс:** iframe рендерится только после клика по оверлею (`showJoinOverlay` → false). До клика в DOM нет iframe вообще.

### Баг 2: Автовоспроизведение не работало после клика "начать просмотр"
**Проблема:** После клика на оверлей iframe загружался, но Rutube показывал паузу. Команда `player:play` через postMessage игнорировалась браузером (autoplay policy — клик был на оверлее, не внутри iframe).
**Фикс:** Добавлен `?autoplay=1` к URL embed-а **только для зрителя** когда `pendingIsPlaying=true`. Для admin — без autoplay (иначе стрелял лишний `player:play` event).

### Баг 3: Рассинхрон позиции при входе в комнату
**Проблема:** `actualPosition` считался в момент вызова `applyToPlayer`, а реальный seek происходил через 800мс — опоздание накапливалось.
**Фикс:** Позиция пересчитывается **внутри setTimeout** прямо перед seek:
```js
setTimeout(() => {
  const seekPos = safePos + Math.max(0, Date.now() / 1000 - playedAt);
  postToPlayer(iframe, "player:setCurrentTime", { time: seekPos });
}, 800);
```

### Баг 4: NaN в currentTime (ошибка "non-finite value")
**Проблема:** `TypeError: Failed to set the 'currentTime' property: The provided double value is non-finite` — Rutube получал NaN через postMessage.
**Причины:**
1. `?autoplay=1` на admin-стороне → лишний `player:play` → отправлял position в неправильный момент
2. Возможные NaN/null в `position` из Redis

**Фикс:** NaN-защита во всём `applyToPlayer`:
```js
const safePos = isFinite(Number(position)) ? Number(position) : 0;
if (!isFinite(seekPos)) seekPos = safePos;
```

### Баг 5: Зритель пропускал live player-события пока overlay показан
**Проблема:** Пока зритель не кликнул на overlay (iframe ещё нет), admin мог нажать play. `applyToPlayer` возвращался сразу (iframe=null). Зритель входил с устаревшим состоянием из Redis.
**Фикс:** При получении `player` WS-события пока `!playerReadyRef.current` — обновляем `pendingStateRef` и `pendingIsPlaying`, чтобы при входе применилось актуальное состояние.

### Баг 6: WebSocket "closed before connection established" (StrictMode)
**Проблема:** React StrictMode в dev монтирует эффекты дважды. Первый WS закрывался до установки соединения — warning в консоли.
**Фикс:** В `useWebSocket.js` добавлен `cancelled` флаг + обработка CONNECTING состояния:
```js
return () => {
  cancelled = true;
  if (ws.readyState === WebSocket.CONNECTING) {
    ws.onopen = () => ws.close();
  } else {
    ws.close();
  }
};
```
Также `handlers` теперь через `handlersRef` — всегда актуальный колбэк без stale closure.

### Баг 7: Оверлей Rutube при паузе
**Проблема:** При нажатии паузы Rutube показывал свой интерфейс поверх видео.
**Статус:** Полностью убрать нельзя — cross-origin iframe. Сделан `.playerOverlay` div поверх iframe с `z-index: 10`, который блокирует клики по Rutube UI.

### Баг 8: Volume mixer — нельзя полностью выключить звук
**Проблема:** `player:setVolume` с value=0 не всегда работал в Rutube. Слайдер до 0 менял иконку на 🔇 вводя в заблуждение.
**Фикс:** Добавлена кнопка **mute** (клик на иконку громкости):
- `player:mute` / `player:unmute` postMessage
- Иконка 🔇 только при реальном mute (не при слайдере на 0)
- При перетаскивании слайдера пока muted — автоматически unmute

### Баг 9: Чёрный экран плеера
**Причина:** Ad-blocker блокировал `adsdk.js` Rutube → `Plugin resolve error` → плеер не инициализировался.
**Решение:** Отключить ad-blocker для localhost. Атрибут `allow` на iframe расширен:
```
allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
```

---

## Известные ограничения (не баги, особенности)

- URL бэкенда захардкожен `localhost:8000` — перед деплоем через ngrok нужно вынести в `.env`
- CORS `allow_origins=["*"]` — для продакшна нужно ограничить
- Volume через postMessage `player:setVolume` — уровень зависит от поддержки Rutube API
- Invite code генерируется через `random` (не `secrets`) — некритично для диплома
- `ws.accept()` до проверки прав в WebSocket router — небольшая архитектурная проблема

---

## Переименование и редизайн

- Проект переименован **WatchParty → Surf Videos** (index.html, все страницы, CLAUDE.md)
- Логотип: `logo-light.png` / `logo-dark.png` в `/public`, переключаются с темой, отображаются на всех страницах
- Акцент изменён с кораллового `#E8404E` на янтарный `#DFA06E`
- Тема по умолчанию изменена с `dark` на `light`

---

## Реализованные дипломные фичи (добавлены поэтапно)

### Реакции поверх видео (emoji overlay)
- Кнопки реакций (❤️ 😂 😮 👏 🔥 😢) под плеером — видны всем после клика на оверлей
- WS-событие `reaction` → backend сохраняет в таймлайн + рассылает всем
- Летящий эмодзи анимация (CSS keyframes `flyUp`) поверх iframe, z-index: 15
- Случайная x-позиция каждой реакции (10–85% ширины)

### Очередь видео
- Таб "Очередь" в боковой панели чата с badge-счётчиком
- Только admin: добавить/удалить/пропустить (`queue:add/remove/skip`)
- `skip` автоматически переключает плеер на следующее видео + обновляет `current_video_id` в БД
- Состояние очереди в Redis (`room:{id}:queue`), TTL 24ч
- Зрители видят очередь (только чтение)

### Таймлайн эмоций
- Точки-эмодзи над полосой прокрутки, позиция = `(time/duration)*100%`
- Tooltip: `{emoji} {username} · {formatTime(time)}`
- Хранится в Redis (`room:{id}:video:{vid}:timeline`), новый участник получает при входе
- Обновляется в реальном времени через WS-событие `timeline_update`

### Ad-sync (компенсация рекламы Rutube)
- Rutube показывает рекламу каждому пользователю разной длины → зрители рассинхронизируются
- **Решение:** admin каждые 5 секунд автоматически отправляет `{type: "player", action: "sync", position, video_id}`
- Backend сохраняет обновлённый `played_at` в Redis, рассылает зрителям (exclude sender)
- Зрители делают seek с коррекцией на `played_at` без повторной команды play
- Кнопка ⟳ для немедленной ручной синхронизации рядом с play/pause

### Суперадмин система
- Поле `is_superuser` в модели `User`, INFORMATION_SCHEMA-safe миграция (`ALTER TABLE`) при startup
- Авто-создание root-суперадмина из `.env` (`SUPERUSER_USERNAME`, `SUPERUSER_PASSWORD`, `SUPERUSER_EMAIL`)
- Backend роутер `/admin/*`: список пользователей, повышение/понижение, создание, список всех комнат, удаление
- Удаление комнаты: `DELETE /rooms/{room_id}` — только хост или суперадмин
- Frontend: вкладка "Панель администратора" в LobbyPage (видна только суперадмину)
  - Таблица пользователей с бейджами и кнопками "Назначить админом" / "Разжаловать"
  - Таблица всех комнат с типом, владельцем и кнопкой удаления
- Кнопка ✕ на карточке комнаты в лобби (для owner и superuser)
- Root-суперадмин (`SUPERUSER_USERNAME`) защищён от разжалования

---

## Вкладка "Мои комнаты" + покинуть комнату

- `GET /rooms/my` — возвращает все комнаты где пользователь состоит (включая приватные), с invite_code
- **Баг-фикс:** маршрут `/rooms/my` перенесён выше `/{room_id}` — иначе FastAPI перехватывал "my" как room_id и возвращал 422
- `DELETE /rooms/{room_id}/leave` — удаляет пользователя из RoomMember; владелец покинуть не может (400)
- LobbyPage: вкладки "Публичные комнаты" / "Мои комнаты" / "Панель администратора" (для всех, не только суперадминов)
- На карточках в "Мои комнаты" — кнопка "Покинуть" для не-владельцев, карточка убирается из списка без перезагрузки
- RoomPage: кнопка "Покинуть" в шапке для зрителей (не-владельцев), вызывает `/leave` и возвращает в лобби
- На карточках приватных комнат в "Мои комнаты" отображается invite_code с кнопкой копирования

## Баг-фиксы по результатам code review

### Баг 14: Удаление комнаты не закрывало WebSocket-соединения клиентов
**Проблема:** `DELETE /rooms/{room_id}` и `DELETE /admin/rooms/{room_id}` удаляли запись из БД, но пользователи внутри комнаты оставались подключены по WebSocket к несуществующей комнате и продолжали слать события.
**Фикс:** Добавлен метод `manager.kick_room(room_id)` — закрывает все WS-соединения в комнате с кодом 4010 перед удалением из БД. Вызывается в обоих роутерах.

### Баг 15: `broadcast` не очищал мёртвые соединения
**Проблема:** При ошибке отправки в `broadcast` исключение молча игнорировалось (`except Exception: pass`). Мёртвые соединения навсегда оставались в `manager.rooms`, засоряя память.
**Фикс:** Ошибочные соединения собираются в список `dead` и удаляются через `disconnect()` после обхода.

### Баг 16: `int(payload.get("sub"))` падал с TypeError
**Проблема:** Если JWT-токен валиден, но не содержит поле `sub` — `payload.get("sub")` возвращает `None`, и `int(None)` бросает `TypeError`. Бэкенд падал с 500 вместо отказа в подключении.
**Фикс:** Обёрнуто в `try/except (TypeError, ValueError): return None`.

### Баг 17: Hardcoded `localhost:8000` в `fetchVideoInfo`
**Проблема:** `fetch('http://localhost:8000/rooms/video-info/...')` — захардкожен адрес. Не работало бы при деплое через ngrok.
**Фикс:** Заменено на `api.get('/rooms/video-info/...')` — использует axios instance с базовым URL из конфига.

## Что ещё не реализовано

- Статус участников (подробный)
- История просмотров пользователя
- Thumbnail и название видео в очереди (backend endpoint `/rooms/video-info/{video_id}` готов, frontend state готов, JSX не обновлён)

### Баг 10: Зритель не видел смену видео (change_video)
**Проблема:** Когда admin менял видео, зритель продолжал видеть старый iframe — `room.current_video_id` в его локальном стейте не обновлялось.
**Причина:** В обработчике `player` WS-события не было ветки для `change_video` на стороне зрителя.
**Фикс:** При получении `{type: "player", action: "change_video"}` зритель теперь делает `setRoom(prev => {...prev, current_video_id: data.video_id})` → iframe перезагружается с новым src. Также сбрасываются `timeline`, `playerReadyRef`, `pendingStateRef`.

### Баг 11: Авторизация зависала (bcrypt блокировал event loop)
**Проблема:** `bcrypt.hashpw` / `bcrypt.checkpw` — синхронные CPU-интенсивные операции, вызывались напрямую из async FastAPI роутов и блокировали весь event loop на несколько секунд. Кнопка "Войти" показывала "..." и не реагировала.
**Фикс:** `hash_password` и `verify_password` стали `async`, bcrypt выполняется через `asyncio.to_thread()`. Все вызовы в `auth.py`, `admin.py`, `main.py` обновлены на `await`.

### Баг 12: Назначенный админ мог разжаловать root-суперадмина
**Проблема:** В `/admin/users/{id}/promote` была только одна защита — нельзя изменить себя. Любой суперадмин мог понизить любого другого, включая root-пользователя из `.env`.
**Фикс:** Добавлена проверка `if user.username == settings.SUPERUSER_USERNAME` → 403. Root-суперадмин неприкосновенен.

### Баг 13: Счётчик участников в лобби показывал неверное число
**Проблема:** `member_count` считал все строки в таблице `RoomMember` (все кто когда-либо вступал в комнату), а не реально подключённых сейчас.
**Фикс:** `list_public_rooms` теперь берёт `len(manager.rooms.get(room_id, {}))` — реальное число активных WebSocket-подключений. Надпись изменена на "● N онлайн" (зелёным цветом).

---

## Команды для запуска

```bash
# Backend
cd backend
pip install -r requirements.txt
python run.py

# Frontend
cd frontend
npm install
npm run dev
```
