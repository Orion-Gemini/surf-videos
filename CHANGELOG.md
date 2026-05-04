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
- Деплой: Vercel (frontend) + Render.com (backend) + Aiven MySQL + Upstash Redis

**Структура backend:**
- `app/models/` — User, Room, RoomMember, Message
- `app/schemas/` — Pydantic валидация
- `app/services/` — auth (JWT+bcrypt), room CRUD, deps (get_current_user)
- `app/routers/` — auth (register/login), rooms (CRUD + join by code), admin (управление пользователями и комнатами), users (профиль, аватар)
- `app/websocket/` — manager (ConnectionManager), handlers (chat, player, reaction, queue, ready, countdown, moderation), router

**Структура frontend:**
- `pages/AuthPage.jsx` — логин/регистрация (+ юридические соглашения)
- `pages/LobbyPage.jsx` — список публичных комнат, создание, вход по коду, мои комнаты, admin-панель
- `pages/RoomPage.jsx` — плеер Rutube + кастомные контролы + чат + синхронизация + зал ожидания + кинотеатр/fullscreen
- `pages/ProfilePage.jsx` — профиль, аватар, смена пароля
- `hooks/useWebSocket.js` — WebSocket хук
- `player/` — RutubePlayerController, PostMessageBridge, CommandQueue, PlayerEventEmitter, usePlayer
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

## Реализованные фичи

### Переименование и редизайн
- Проект переименован **WatchParty → Surf Videos** (index.html, все страницы, CLAUDE.md)
- Логотип: `logo-light.png` / `logo-dark.png` в `/public`, переключаются с темой, отображаются на всех страницах
- Акцент изменён с кораллового `#E8404E` на янтарный `#DFA06E`
- Тема по умолчанию изменена с `dark` на `light`

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

### Вкладка "Мои комнаты" + покинуть комнату
- `GET /rooms/my` — возвращает все комнаты где пользователь состоит (включая приватные), с invite_code
  - Маршрут перенесён выше `/{room_id}` — иначе FastAPI перехватывал "my" как room_id и возвращал 422
- `DELETE /rooms/{room_id}/leave` — удаляет пользователя из RoomMember; владелец покинуть не может (400)
- LobbyPage: вкладки "Публичные комнаты" / "Мои комнаты" / "Панель администратора"
- На карточках в "Мои комнаты" — кнопка "Покинуть" для не-владельцев, карточка убирается из списка без перезагрузки
- RoomPage: кнопка "Покинуть" в шапке для зрителей (не-владельцев), вызывает `/leave` и возвращает в лобби
- На карточках приватных комнат в "Мои комнаты" отображается invite_code с кнопкой копирования

### Страница профиля
- Новый роутер `routers/users.py` с эндпоинтами:
  - `GET /users/me` — профиль: id, username, email, is_superuser, дата регистрации, кол-во комнат
  - `PATCH /users/me/password` — смена пароля (проверяет старый, минимум 4 символа)
  - `POST /users/me/avatar` — загрузка аватара в виде base64 data URL
- Колонка `avatar` (LONGTEXT, nullable) в таблице `users` — добавляется автоматически при старте
- Аватар включён в WS-события: история чата при входе, новые сообщения чата, `user_joined`
- Новая страница `/profile` (`ProfilePage.jsx`):
  - Аватар с инициалами (или картинка). При наведении появляется иконка 📷
  - Фото автоматически кропается в квадрат 128×128 через Canvas API, конвертируется в JPEG
  - Имя пользователя + бейдж "Администратор" если is_superuser
  - Две карточки статистики: комнат создано / посещено
  - Раскрывающаяся форма смены пароля
- Переход на профиль: клик на имя пользователя в шапке лобби (стало кнопкой-пилюлей)
- Аватары в чате комнаты: у чужих сообщений отображается аватар слева, кэшируются в ref по user_id

### Зал ожидания (синхронный старт после рекламы)
Когда admin загружает видео — вместо немедленного старта все участники видят оверлей "зала ожидания":
- Каждый досматривает рекламу и нажимает **✓ Я готов** → у всех в списке появляется галочка
- Admin видит список готовых и счётчик, может нажать **▶ Начать для всех** в любой момент
- После нажатия: всем показывается анимированный обратный отсчёт **3 → 2 → 1**
- После 0: admin-клиент автоматически отправляет `play` через WS → видео стартует у всех синхронно

**Backend:**
- Redis-ключи: `room:{id}:waiting` (флаг) и `room:{id}:ready_users` (JSON список `{id, username, avatar}`)
- `handle_ready_event`: добавляет пользователя в список, бродкастит `ready_update`
- `handle_countdown_event`: только admin, очищает waiting-режим, бродкастит `countdown` всем
- `handle_player_event` при `change_video`: включает waiting-режим, сбрасывает список готовых
- `send_initial_state`: включает `is_waiting` и `ready_users`

**Frontend:**
- `ready_update` → обновляет список, `countdown` → запускает отсчёт
- Оверлей зала ожидания (z-index 20), оверлей отсчёта (z-index 21)
- Отображение: ✅ с именем для готовых, ⌛ "ждёт..." для остальных

### Улучшенная панель администратора
- **Карточки статистики** вверху: пользователей / комнат / администраторов / онлайн сейчас (счётчик живой — сумма WebSocket-подключений по всем комнатам)
- **Поиск** по таблице пользователей (имя + email) и по таблице комнат (название + владелец) — live-фильтр, счётчик `N / итого`
- **Онлайн-счётчик** в таблице комнат — зелёная точка + число подключённых; прочерк если пусто. Backend: добавлено поле `online_count` в `RoomAdminOut`
- **Аватарки/инициалы** в таблице пользователей — первая буква имени в круглом значке акцентного цвета
- **Кнопка "Войти"** в таблице комнат — прямой переход в комнату из панели администратора

### Баг: автозаполнение email на вкладке входа
Email-поле существует в DOM даже на вкладке "Войти" (только CSS-скрыто). Браузер автозаполнял его и показывал ошибку валидации при сабмите.
**Фикс:** `disabled={mode !== "register"}` на email-инпуте — браузер полностью игнорирует disabled-поля при автозаполнении и валидации.

### Режим кинотеатра
- Кнопка в панели контролов плеера (иконка прямоугольника-экрана, tooltip при наведении)
- В режиме кинотеатра: шапка скрывается, layout занимает `100vh`, паддинги плеера уменьшаются, поле ввода ID видео скрывается, чат сужается до 280px
- **Контролы поверх видео**: в cinema mode панель управления (реакции + seekbar + play/pause/громкость) становится абсолютным оверлеем с тёмным градиентом снизу. Появляется при движении мыши, скрывается через 3 секунды. Цвета адаптированы под тёмный фон

### Полный экран + оверлей чата
- **Кнопка полного экрана** в панели контролов (рядом с кнопкой кинотеатра), использует Fullscreen API (`requestFullscreen` / `exitFullscreen`), слушает `fullscreenchange`
- **Кнопка "Оверлей чата"** (`💬`) появляется только в fullscreen — фиксированная в правом верхнем углу (в cinema mode смещается левее чата). Подсвечивается акцентным цветом когда активна
- **Всплывающие сообщения**: новые сообщения чата появляются снизу-слева поверх видео — полупрозрачный размытый фон (`rgba(0,0,0,0.38)` + `backdrop-filter`), имя акцентным цветом, текст белый. Slide-in анимация, исчезают через 4.5 сек, максимум 5 сообщений одновременно
- При выходе из fullscreen оверлей автоматически отключается

### Вкладка "Участники" + модерация
Новая вкладка в боковой панели чата (рядом с Чат / Действия / Очередь):
- Показывает всех онлайн-участников с аватаркой, именем и бейджем 👑 у хоста
- Замученные участники визуально приглушены, помечены 🔇
- Хост комнаты и суперадмин видят кнопки 🔇 (мут/размут) и ✕ (кик) у каждого участника кроме себя
- Нельзя мутить/кикать других суперадминов (защита на бэкенде)
- Хост нажимает 🔇 → `room:{id}:muted_users` в Redis; замученный видит надпись вместо поля ввода
- Хост нажимает ✕ → WS закрывается с кодом 4011; пользователь уходит в лобби
- Суперадмин управляет плеером, очередью и модерацией в **любой** комнате
- `manager.kick_user(room_id, user_id)` — закрывает WS конкретного пользователя (код 4011)
- WS-тип `moderation` (клиент → сервер): `{ action: "mute"|"unmute"|"kick", user_id }`
- WS-тип `moderated` (сервер → клиент): `{ action, user_id, username, by }`

---

## Юридическое соответствие (по требованию комиссии)

### Согласие на обработку персональных данных и лицензионное соглашение
- При регистрации появляется чекбокс: «Я принимаю Лицензионное соглашение и Политику обработки персональных данных». Без галочки форма не отправляется.
- Каждая ссылка открывает модальное окно с полным текстом документа.
- Кнопка «Принять и закрыть» в модале автоматически ставит галочку.
- Чекбокс анимированно появляется/скрывается вместе с полем Email (только в режиме регистрации).
- Оба документа хранятся прямо в `AuthPage.jsx` (константы `PRIVACY_TEXT`, `LICENSE_TEXT`) — не требуют отдельных файлов или роутов.
- **Файлы:** `frontend/src/pages/AuthPage.jsx`, `frontend/src/pages/AuthPage.module.css`

## Функции администратора

### Бан пользователя
- **Backend** `PATCH /admin/users/{user_id}/ban` — принимает `{ is_active: bool }`, сохраняет в поле `User.is_active`. Нельзя забанить себя и суперадмина.
- **Баг-фикс**: в `/auth/login` не было проверки `is_active` — забаненный пользователь всё равно получал токен. Добавлена проверка: `if not user.is_active → 403 "Аккаунт заблокирован"`. Старые токены инвалидируются через `get_current_user` при следующем запросе.
- **Frontend** — кнопка "Бан" / "Разбан" в строке пользователя в таблице (показывает confirm-модал перед действием). Забаненные строки подсвечиваются тусклее (`adminRowBanned`), рядом с именем появляется бейдж `badgeBanned`.

### Удаление аккаунта
- **Backend** `DELETE /admin/users/{user_id}` — удаляет пользователя из БД. Нельзя удалить себя и суперадмина.
- **Frontend** — кнопка "✕" (красная, узкая) в строке пользователя. При клике показывает confirm-модал с предупреждением. После удаления строка исчезает из таблицы.

### UI изменения
- Колонка "Действия" в таблице пользователей расширена с 160px до 230px (вмещает 3 кнопки)
- Sweep-анимация добавлена на кнопку "Бан" (как у Назначить/Разжаловать)
- Новые CSS-классы: `adminRowBanned`, `badgeBanned`, `btnBan`, `btnUnban`, `btnDeleteUser`

---

## Анимации и UI-полировка

### Админ-панель
- **Счётчики в stat-карточках** — числа (пользователей / комнат / администраторов / онлайн) анимированно считают от 0 до значения за 1.2 секунды с easeOutCubic при каждой загрузке данных. Реализовано через хук `useCountUp` (requestAnimationFrame).
- **Каскадное появление stat-карточек** — 4 карточки статистики появляются снизу с упругим `cubic-bezier(0.34, 1.56, 0.64, 1)` с задержкой 80мс между каждой.
- **Каскадные строки таблиц** — каждая строка пользователей и комнат выезжает слева с задержкой 45мс после предыдущей (`animationDelay` через inline style по индексу).
- **Sweep-эффект на кнопках** — кнопки "Назначить", "Разжаловать", "Войти" — при наведении прокатывается световой блик слева направо через `::after` псевдоэлемент.
- **Покачивание иконок фичей** — иконки 🎬 💬 🎭 на feature-карточках плавно поднимаются и опускаются с разными задержками (`animation: float 3.2s ease-in-out infinite`) — тематично под "Surf".

### Страница входа / регистрации
- Фон и карточка плавно появляются при открытии страницы (fade + лёгкое всплытие снизу)
- Переключатель вкладок "Войти" / "Регистрация": белый прямоугольник плавно перелетает между вкладками при нажатии (скользящий слайдер через CSS transform)
- Поле Email плавно разворачивается при переходе на регистрацию — карточка не прыгает
- При переходе обратно на "Войти" поле Email так же плавно схлопывается (div остаётся в DOM, анимируется через grid-template-rows + margin-top)
- Кнопка "Войти" мягко пульсирует дважды при загрузке страницы — привлекает внимание
- Fade-out при успешном входе перед переходом в лобби

### Лобби
- Страница появляется с плавным fade при загрузке
- Карточки комнат появляются по одной с небольшой задержкой (каскадом)
- Кнопки при наведении чуть приподнимаются
- При наведении на кнопку удаления (✕) карточка комнаты мягко дрожит
- Вместо стандартного браузерного окна подтверждения — кастомный модал
- Мигающая зелёная точка рядом со счётчиком онлайн на карточке комнаты
- Fade-out при переходе в комнату или выходе в лобби
- **Скользящий индикатор вкладок**: акцентная полоска плавно скользит под активной вкладкой с упругим эффектом. Реализовано через `useLayoutEffect` + `offsetLeft/offsetWidth`

### Комната
- Новые сообщения в чате появляются с плавным slide снизу
- Элементы очереди видео появляются так же
- Кнопки реакций пружинят при нажатии
- Иконка ▶/⏸ вспыхивает pop-анимацией при смене состояния
- Кнопка ⟳ вращается при нажатии sync
- Точки эмодзи на таймлайне появляются с pop-анимацией
- Fade-out при выходе в лобби
- **Скользящий индикатор вкладок чата**: та же упругая анимация что в лобби

### Переходы между страницами
- Все переходы сопровождаются плавным fade-out (0.22s) перед navigate()

### Смена темы
- Плавная анимация через View Transitions API: новая тема "расходится" кругом из точки клика по кнопке. Реализовано через `document.startViewTransition` + `clip-path: circle(0px → Rpx)` на `::view-transition-new(root)`. Fallback для старых браузеров — мгновенная смена.

### Фикс: fullscreen контролы + исправление багов (RoomPage.jsx)

- **Fullscreen контролы**: контролы видны поверх видео при движении мыши. Причина бага — `document.fullscreenElement === pageRef.current` давало `false`; заменено на `!!document.fullscreenElement`
- **iframe не перехватывает fullscreen**: убран атрибут `allowFullScreen` у iframe Rutube — теперь только наша кнопка управляет fullscreen
- **Двойной WS-send для админа**: добавлен `suppressAdminMsgRef` — когда admin сам отправляет команду play/pause, postMessage-ответ от iframe игнорируется
- **`onlineCount` рассинхронизация**: удалён отдельный state `onlineCount`, везде используется `onlineUsers.length`
- **`showJoinOverlay` не сбрасывался**: при смене видео теперь вызывается `setShowJoinOverlay(true)` — браузер не нарушает autoplay policy
- **Дрейф таймера**: вместо двух независимых `setInterval` — один интервал 500мс на базе `Date.now()` (абсолютное время без дрейфа)
- **`isAdmin` дублировался**: убран `useEffect` для `isAdminRef`, `isAdmin` вычисляется один раз в рендере, `isAdminRef.current = isAdmin` синхронно
- **Fullscreen auto-show контролов**: при входе в fullscreen контролы автоматически показываются на 3 секунды; таймер скрытия — 2.5с вместо 600мс; `mousemove` слушается на уровне `document`

---

## Известные ограничения (не баги, особенности)

- CORS `allow_origins=["*"]` — для продакшна нужно ограничить
- Volume через postMessage `player:setVolume` — уровень зависит от поддержки Rutube API
- Invite code генерируется через `random` (не `secrets`) — некритично для диплома
- Rutube показывает свой оверлей при паузе (cross-origin iframe, убрать полностью нельзя) — перекрыт `.playerOverlay` div с z-index: 10

## Что ещё не реализовано

- Статус участников (подробный)
- История просмотров пользователя
- Thumbnail и название видео в очереди (backend endpoint `/rooms/video-info/{video_id}` готов, frontend state готов)

---

## БАГИ

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
**Проблема:** `TypeError: Failed to set the 'currentTime' property: The provided double value is non-finite` — Rutube получал NaN через postMessage. Причины: `?autoplay=1` на admin-стороне → лишний `player:play`, и возможные NaN/null в `position` из Redis.
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
**Фикс:** В `useWebSocket.js` добавлен `cancelled` флаг + обработка CONNECTING состояния. `handlers` через `handlersRef` — всегда актуальный колбэк без stale closure.

### Баг 7: Оверлей Rutube при паузе
**Проблема:** При нажатии паузы Rutube показывал свой интерфейс поверх видео.
**Статус:** Полностью убрать нельзя — cross-origin iframe. Сделан `.playerOverlay` div поверх iframe с `z-index: 10`, который блокирует клики по Rutube UI.

### Баг 8: Volume mixer — нельзя полностью выключить звук
**Проблема:** `player:setVolume` с value=0 не всегда работал в Rutube. Слайдер до 0 менял иконку на 🔇 вводя в заблуждение.
**Фикс:** Добавлена кнопка mute (клик на иконку громкости): `player:mute` / `player:unmute` postMessage. При перетаскивании слайдера пока muted — автоматически unmute.

### Баг 9: Чёрный экран плеера
**Причина:** Ad-blocker блокировал `adsdk.js` Rutube → `Plugin resolve error` → плеер не инициализировался.
**Решение:** Отключить ad-blocker для localhost. Атрибут `allow` на iframe расширен до полного набора разрешений.

### Баг 10: Зритель не видел смену видео (change_video)
**Проблема:** Когда admin менял видео, зритель продолжал видеть старый iframe — `room.current_video_id` в его локальном стейте не обновлялось. В обработчике `player` WS-события не было ветки для `change_video` на стороне зрителя.
**Фикс:** При получении `{type: "player", action: "change_video"}` зритель делает `setRoom(prev => {...prev, current_video_id: data.video_id})` → iframe перезагружается с новым src. Также сбрасываются `timeline`, `playerReadyRef`, `pendingStateRef`.

### Баг 11: Авторизация зависала (bcrypt блокировал event loop)
**Проблема:** `bcrypt.hashpw` / `bcrypt.checkpw` — синхронные CPU-интенсивные операции, вызывались напрямую из async FastAPI роутов и блокировали весь event loop на несколько секунд.
**Фикс:** `hash_password` и `verify_password` стали `async`, bcrypt выполняется через `asyncio.to_thread()`. Все вызовы в `auth.py`, `admin.py`, `main.py` обновлены на `await`.

### Баг 12: Назначенный админ мог разжаловать root-суперадмина
**Проблема:** В `/admin/users/{id}/promote` была только одна защита — нельзя изменить себя. Любой суперадмин мог понизить любого другого, включая root-пользователя из `.env`.
**Фикс:** Добавлена проверка `if user.username == settings.SUPERUSER_USERNAME` → 403. Root-суперадмин неприкосновенен.

### Баг 13: Счётчик участников в лобби показывал неверное число
**Проблема:** `member_count` считал все строки в таблице `RoomMember` (все кто когда-либо вступал в комнату), а не реально подключённых сейчас.
**Фикс:** `list_public_rooms` теперь берёт `len(manager.rooms.get(room_id, {}))` — реальное число активных WebSocket-подключений. Надпись изменена на "● N онлайн".

### Баг 14: Удаление комнаты не закрывало WebSocket-соединения клиентов
**Проблема:** `DELETE /rooms/{room_id}` удалял запись из БД, но пользователи внутри комнаты оставались подключены по WebSocket к несуществующей комнате.
**Фикс:** Добавлен метод `manager.kick_room(room_id)` — закрывает все WS-соединения в комнате с кодом 4010 перед удалением из БД. Вызывается в обоих роутерах.

### Баг 15: `broadcast` не очищал мёртвые соединения
**Проблема:** При ошибке отправки в `broadcast` исключение молча игнорировалось (`except Exception: pass`). Мёртвые соединения навсегда оставались в `manager.rooms`, засоряя память.
**Фикс:** Ошибочные соединения собираются в список `dead` и удаляются через `disconnect()` после обхода.

### Баг 16: `int(payload.get("sub"))` падал с TypeError
**Проблема:** Если JWT-токен валиден, но не содержит поле `sub` — `payload.get("sub")` возвращает `None`, и `int(None)` бросает `TypeError`. Бэкенд падал с 500.
**Фикс:** Обёрнуто в `try/except (TypeError, ValueError): return None`.

### Баг 17: Hardcoded `localhost:8000` в `fetchVideoInfo`
**Проблема:** `fetch('http://localhost:8000/rooms/video-info/...')` — захардкожен адрес. Не работало бы при деплое.
**Фикс:** Заменено на `api.get('/rooms/video-info/...')` — использует axios instance с базовым URL из конфига.

### Баг 18: Пробел между полями при скрытом email
**Проблема:** После скрытия поля Email div оставался в DOM с нулевой высотой, но `gap: 10px` во flex-контейнере всё равно добавлял отступ между полями.
**Фикс:** К `.emailFieldHidden` добавлен `margin-top: -10px` с transition — компенсирует gap и плавно анимируется.

### Баг 19: Анимация появления карточки воспроизводилась повторно при уборке курсора с кнопки удаления
**Проблема:** `cardFadeIn` и `shake` были обе на `.roomCard`. Когда `:has(.btnDelete:hover)` переставал работать — браузер переключал `animation` обратно на `cardFadeIn` и запускал её заново.
**Фикс:** Shake перенесён на внутренний `.roomCardInner` — отдельный wrapper div внутри карточки.

### Баг 20: Тройное сообщение "вошёл/покинул/вошёл" при входе в комнату
**Проблема:** React StrictMode в dev-режиме монтирует эффекты дважды — WebSocket подключался, отключался и снова подключался. Сервер рассылал три события, и все три появлялись в чате.
**Фикс:** Дебаунс 800мс через `joinLeaveTimers` ref. Если события для одного пользователя приходят чаще чем раз в 800мс — таймер сбрасывается и показывается только последнее. Собственные события текущего пользователя не показываются.

### Баг 21: Бесконечная загрузка при загрузке аватара
**Проблема:** В `resizeToBase64` отсутствовал обработчик `img.onerror` — если изображение не загружалось, Promise зависал навсегда и `setAvatarUploading(false)` никогда не вызывался.
**Фикс:** Добавлен `img.onerror` с `reject()`, блок `img.onload` обёрнут в `try/catch`.

### Баг 22: Аватарки не сохранялись (ошибка сессии SQLAlchemy)
**Проблема:** В `routers/users.py` был определён собственный локальный `get_db`, не совпадающий с `get_db` из `app.database`. FastAPI создавал две отдельные сессии: `current_user` принадлежал сессии A, а `db` — сессии B. При `db.add(current_user)` SQLAlchemy бросал `InvalidRequestError`. Аватар не сохранялся, смена пароля тоже не работала.
**Фикс:** Убран локальный `get_db` из `users.py`, вместо него `from app.database import get_db`. Теперь FastAPI кеширует одну сессию на запрос для всей цепочки зависимостей.

### Баг 23: Оверлей зала ожидания не появлялся
**Проблема:** В обработчике `player` события условие `data.action === "play" || data.action === "change_video"` вызывало `setIsWaiting(false)` — то есть `change_video` сначала выключал режим ожидания, а потом приходящий `ready_update` пытался его включить. Для admin `player(change_video)` вообще не приходит (excluded), а в `changeVideo()` не было `setIsWaiting(true)`.
**Фикс:** Убрал `change_video` из условия сброса. В ветке `change_video` добавил `setIsWaiting(true)`. В функции `changeVideo()` admin-клиента тоже добавил `setIsWaiting(true)`.

### Баг 24: Суперадмин не видел кнопки мута/кика для хоста комнаты
**Проблема:** В JSX условие `!isOwner` скрывало кнопки модерации для хоста комнаты даже когда текущий пользователь — суперадмин. На бэкенде стояла жёсткая защита `if target.is_superuser: return` — суперадмин не мог мутить других суперадминов.
**Фикс:** JSX: `!isOwner` заменено на `!isOwner || user?.is_superuser`. Backend: проверка изменена на `if not user.is_superuser and target.is_superuser`.
**Попутно:** В `RoomPage.jsx` уже существовал `isMuted` для громкости плеера. При добавлении нового `isMuted` для чат-мута возник конфликт имён — переименовано в `isChatMuted`.

### Баг 25: Memory leak — `joinLeaveTimers` накапливал ключи бесконечно
**Файл:** `RoomPage.jsx`
**Проблема:** При каждом join/leave в `joinLeaveTimers.current` создавался ключ `user_id`, но после срабатывания таймера ключ не удалялся. В активной комнате объект рос неограниченно.
**Фикс:** Добавлен `delete joinLeaveTimers.current[data.user_id]` внутри коллбека setTimeout.

### Баг 26: `joinLeaveTimers` не очищались при размонтировании компонента
**Файл:** `RoomPage.jsx`
**Проблема:** В cleanup-эффекте при размонтировании очищались только `timerRef` и `countdownRef`. Висящие 800мс таймеры из `joinLeaveTimers` могли вызвать setState на уже размонтированном компоненте.
**Фикс:** В cleanup добавлено `Object.values(joinLeaveTimers.current).forEach(clearTimeout)`.

### Баг 27: `ready_update` безусловно выставлял `isWaiting = true`
**Файл:** `RoomPage.jsx`
**Проблема:** `setIsWaiting(true)` вызывался при каждом `ready_update` — в том числе когда уже шёл обратный отсчёт. Это перезапускало оверлей ожидания поверх отсчёта.
**Фикс:** Заменено на `setIsWaiting((prev) => prev || (data.ready_users?.length > 0))` — не включает ожидание если оно уже выключено.

### Баг 28: `manager.broadcast` создавал пустые записи в defaultdict
**Файл:** `websocket/manager.py`
**Проблема:** `self.rooms[room_id].items()` на defaultdict создавал пустую запись для несуществующего `room_id`. После этого `disconnect()` не мог корректно удалить комнату.
**Фикс:** Заменено на `self.rooms.get(room_id, {}).items()`.

### Баг 29: WebSocket закрывался без кода при cleanup
**Файл:** `useWebSocket.js`
**Проблема:** При React StrictMode double-mount, если WS ещё в состоянии `CONNECTING`, устанавливался `ws.onopen = () => ws.close()` без кода закрытия. Сервер получал обычное закрытие и делал лишний `user_left` broadcast.
**Фикс:** `ws.close()` → `ws.close(1000)`.

### Баг 30: `setRoom(prev => ({ ...prev }))` при `prev = null`
**Файл:** `RoomPage.jsx`
**Проблема:** В `changeVideo()` — `setRoom((prev) => ({ ...prev, current_video_id: trimmed }))` без проверки на `null`. Если комната была удалена пока функция вызывалась — spread `null` давал `{}` и компонент мог крэшнуться.
**Фикс:** Заменено на `prev ? { ...prev, current_video_id: trimmed } : prev`.

### Баг 32: Rutube iframe fullscreen сбрасывал состояние — кнопки пропадали после запуска видео
**Файл:** `RoomPage.jsx`
**Проблема:** Rutube embed iframe имеет разрешение `allow="fullscreen"` и при воспроизведении может вызывать `requestFullscreen()`. Это провоцирует `fullscreenchange` событие в parent-документе. Старый обработчик: `const fs = !!document.fullscreenElement` — возвращал `true` даже когда в fullscreen был iframe, а не наш page div. React применял класс `fullscreenMode` → controls скрывались (`opacity: 0; pointer-events: none`). Курсор попадал внутрь iframe, parent переставал получать `mousemove` → controls не возвращались.
**Фикс 1:** Обработчик изменён: `const fs = document.fullscreenElement === pageRef.current` — fullscreen считается активным только когда в fullscreen наш page элемент.
**Фикс 2:** Добавлен `cinemaMouseCatcher` — прозрачный `position: absolute; inset: 0; z-index: 13` div внутри playerSection, рендерится только в cinema/fullscreen. Перехватывает все события мыши в зоне плеера, не давая курсору провалиться в iframe. Z-index 13 — выше playerOverlay (10), ниже controls (14,15) — controls всё равно получают события когда видны.
**Фикс 3:** Убран `onMouseLeave` с корневого page div — он срабатывал при переходе курсора в iframe и ставил 600мс таймер скрытия controls.

### Баг 33: Ползунок прогресса скачет после перемотки
**Файл:** `RoomPage.jsx`
**Проблема:** `startTimer(fromPosition)` захватывает `fromPosition` и `startedAt` в замыкании. После перемотки (`onSeekCommit`) замыкание оставалось старым — таймер продолжал считать `oldFromPosition + elapsed` и каждые 100мс перезаписывал `currentTime` неверным значением.
**Фикс:** В `onSeekCommit` при `isPlayingRef.current === true` вызываем `startTimer(val)` — перезапускает замыкание от новой позиции. При паузе — только `setCurrentTime(val)`.

### Баг 34: Задержка у зрителей и хоста
**Файл:** `RoomPage.jsx`
**Проблема:** Несколько источников задержки: таймер 500мс (до 500мс лага прогресс-бара), 800мс задержка play для уже готового плеера, sync heartbeat каждые 5с без порога коррекции.
**Фикс:**
- Таймер: 500мс → 100мс (внутренняя точность), `setCurrentTime` — не чаще раза в 250мс (throttle для ре-рендеров)
- Play-задержка: 800мс при первой загрузке, 300мс если `playerReadyRef.current` уже true
- Sync heartbeat: 5с → 3с; коррекция только при рассинхроне > 0.5с
- `suppressAdminMsgRef` разделён на `suppressPlayRef` / `suppressPauseRef` — предотвращает двойной WS-send при быстром play→pause

### Баг 35: Два источника обновляют `currentTimeRef` — прыжки после seek
**Файл:** `RoomPage.jsx`
**Проблема:** Rutube присылает `player:currentTime` postMessage-события сразу после seek, ещё с буферизованной старой позицией. Параллельно работает `startTimer` — конфликт двух источников давал кратковременные прыжки ползунка.
**Фикс:** Добавлен `justSeekedRef` — на 300мс после seek блокирует обновление `currentTimeRef` из `player:currentTime`. Seek устанавливает `justSeekedRef.current = true`, сбрасывается через 300мс.

### Баг 36: Утечка памяти — setTimeout в `applyToPlayer` не очищался
**Файл:** `RoomPage.jsx`
**Проблема:** `setTimeout` внутри `applyToPlayer("play")` не сохранялся в ref и не очищался при размонтировании. Если пользователь уходил из комнаты за 300–800мс после команды play — `startTimer` вызывался на размонтированном компоненте и создавал `setInterval` который никогда не очищался.
**Фикс:** `applyTimeoutRef` — единый ref для setTimeout в `applyToPlayer` и `seek`. `clearTimeout(applyTimeoutRef.current)` в cleanup-эффекте.

### Баг 37: `isSeeking` state в dependency array useEffect — лишние пересоздания listener
**Файл:** `RoomPage.jsx`
**Проблема:** `isSeeking` state был в deps массиве `handleMessage` useEffect. При каждом начале/конце перемотки эффект пересоздавал `message` event listener.
**Фикс:** Удалён `isSeeking` state полностью. Везде используется `isSeekingRef.current` (уже существовал). Из deps убран `isSeeking`.

### Баг 38: Rutube overlay показывает свой UI поверх видео
**Файл:** `RoomPage.jsx`, `RoomPage.module.css`
**Проблема:** Rutube embed загружался без autoplay — показывал паузу с нативными контролами (кнопка play, "Смотреть на RUTUBE"). Прозрачный `playerOverlay` блокировал клики, но не скрывал визуально.
**Фикс:** `?autoplay=1` добавлен в URL embed для всех пользователей. Для админа в `handleJoin` устанавливается `suppressPlayRef.current = true` — подавляет WS-broadcast autoplay echo. `pendingIsPlaying` state удалён.

### Баг 39: Видео автовоспроизводится с начала до синхронизации
**Файл:** `RoomPage.jsx`, `RoomPage.module.css`
**Проблема:** После клика "начать просмотр" iframe загружается с `?autoplay=1` → Rutube стартует с позиции 0, через 300–800мс прилетает seek на нужную позицию — пользователь видит начало видео.
**Фикс:** Добавлен `showSyncOverlay` state + стиль `.syncOverlay` (чёрный экран, z-index: 11). В `handleJoin` при наличии `pendingStateRef` — показываем overlay. В `player:ready` после `applyToPlayer` — убираем overlay через 600мс (seek delay + буфер).

### Баг 40: В fullscreen контролы не исчезают при неактивности курсора
**Файл:** `RoomPage.module.css`
**Проблема:** В cinema mode контролы имели `opacity: 0; pointer-events: none` по умолчанию и показывались только через `.showControls`. В fullscreen mode эти правила отсутствовали — `opacity: 1` всегда, `showControls` не влиял.
**Фикс:** По аналогии с cinema mode добавлены правила: `.fullscreenMode .reactionBar` и `.fullscreenMode .customControls` по умолчанию `opacity: 0; pointer-events: none`; `.fullscreenMode .showControls .reactionBar/customControls` — `opacity: 1; pointer-events: all`.

### Баг 31: Stale closure — элементы управления не появлялись при наведении в fullscreen
**Файл:** `RoomPage.jsx`
**Проблема:** `onCinemaMouseMove` проверял `isFullscreen` из замыкания. `isFullscreen` устанавливается через асинхронный `fullscreenchange` event → React re-render. Первые движения мыши после перехода в fullscreen видели `isFullscreen = false` в старом замыкании → guard возвращал управление, контролы не показывались. Та же причина ломала оверлей чата (`isFullscreen && <button>`).
**Фикс:** Добавлен `isFullscreenRef = useRef(false)`. В `fullscreenchange` обработчике немедленно обновляется `isFullscreenRef.current = fs` до `setIsFullscreen(fs)`. `onCinemaMouseMove`/`onCinemaMouseLeave` используют `isFullscreenRef.current`. Дополнительно добавлены `onMouseMove`/`onMouseLeave` на корневой `page` div для полного покрытия fullscreen.

### Баг 41: `deps.py` — `int(payload.get("sub"))` без try/except → 500 на всех HTTP-эндпоинтах
**Файл:** `backend/app/services/deps.py`
**Проблема:** Баг 16 был исправлен только в `websocket/router.py` (`get_user_from_token`), но аналогичная строка в `deps.py` `get_current_user` оставалась без защиты. Если JWT валиден, но не содержит поле `sub` — `int(None)` бросает `TypeError` → 500 на всех HTTP-эндпоинтах.
**Фикс:** Обёрнуто в `try/except (TypeError, ValueError)` → `HTTPException 401`.

### Баг 42: seek/pause перезаписывали `is_playing=False` в Redis
**Файл:** `backend/app/websocket/handlers.py`
**Проблема:** Состояние плеера строилось как `"is_playing": action == "play"` — для seek и pause всегда записывалось `False`. Новый участник, вошедший в комнату во время воспроизведения (после перемотки), получал `is_playing=False` в `init` → видео не запускалось автоматически.
**Фикс:** Для `seek` — берём `is_playing` из текущего состояния Redis. `played_at` при seek сохраняется если видео играло. Для `pause` — `False` как раньше.

### Баг 43: `manager.py` — `kick_room`, `kick_user`, `get_connected_user_ids` создавали пустые записи в defaultdict
**Файл:** `backend/app/websocket/manager.py`
**Проблема:** Три метода обращались к `self.rooms[room_id]` напрямую. На `defaultdict` это создаёт пустую запись `{}` для несуществующего `room_id`. `broadcast` был исправлен ранее (Баг 28), остальные методы — нет.
**Фикс:** Заменено на `self.rooms.get(room_id, {})` во всех трёх методах.

### Баг 44: `RoomMember` без `UniqueConstraint(room_id, user_id)` — дублирующие записи при гонке
**Файл:** `backend/app/models/room.py`
**Проблема:** Два одновременных WS-подключения одного пользователя оба видят `existing=None` и оба вызывают `join_room` → дублирующая запись в `room_members`. Уникального ограничения в модели не было.
**Фикс:** Добавлен `__table_args__ = (UniqueConstraint("room_id", "user_id", name="uq_room_member"),)` на `RoomMember`.

### Баг 45: WS router — `receive_json()` не защищён от невалидного JSON
**Файл:** `backend/app/websocket/router.py`
**Проблема:** Если клиент присылает не-JSON или битый пакет — `json.JSONDecodeError` не ловится `except WebSocketDisconnect` → исключение всплывает, WS закрывается без `user_left` broadcast.
**Фикс:** `receive_json()` обёрнут в `try/except`, `WebSocketDisconnect` пробрасывается дальше, остальные исключения — `continue` (пропускаем битый пакет).

### Баг 46: countdown — двойная WS-команда play от admin
**Файл:** `frontend/src/pages/RoomPage.jsx`
**Проблема:** После отсчёта 3-2-1 admin вызывал `postToPlayer(iframe, "player:play")` без установки `suppressPlayRef.current = true`. Rutube отвечал эхо-событием `player:play` → `handleMessage` видел его, не находил suppress, вызывал `startTimer` повторно и отправлял второй WS `play`-пакет. В логах появлялось двойное "запустил воспроизведение".
**Фикс:** Добавлен `suppressPlayRef.current = true` перед `postToPlayer` в countdown handler — аналогично `adminPlayerAction` и `handleJoin`.

### Баг 47: `RoomCard` объявлен внутри `LobbyPage` — remount при каждом ре-рендере
**Файл:** `frontend/src/pages/LobbyPage.jsx`
**Проблема:** `function RoomCard(...)` объявлена внутри тела `LobbyPage`. При каждом ре-рендере родителя (открытие формы, поиск в admin-панели и т.д.) React получает новую ссылку на функцию — считает её новым типом компонента и делает полный unmount/remount всех карточек. Анимация появления проигрывалась повторно, фокус сбрасывался.
**Фикс:** `RoomCard` вынесен за пределы `LobbyPage`. Зависимости от `user` и `goTo` переданы явно через props.

### Баг 48: ProfilePage — ошибка загрузки аватара не отображается пользователю
**Файл:** `frontend/src/pages/ProfilePage.jsx`
**Проблема:** При ошибке в `handleAvatarChange` вызывался `setPassError(...)` — но элемент с `passError` рендерится только внутри `{showPassForm && ...}`. Если форма смены пароля закрыта (по умолчанию), пользователь не видел никакого сообщения об ошибке.
**Фикс:** Добавлен отдельный `avatarError` state. Ошибка аватара рендерится прямо под аватаром — всегда видна независимо от состояния формы пароля.

### Баг 50: `formatTime` без защиты от NaN/Infinity
**Файл:** `frontend/src/pages/RoomPage.jsx`
**Проблема:** При `sec = NaN` или `Infinity` (сбой Rutube API при `durationChange`) `Math.floor(NaN) = NaN` → все вычисления NaN → `padStart` на NaN → строки "NaN:NaN" в интерфейсе.
**Фикс:** Guard в начале функции: `if (!isFinite(sec) || sec < 0) return "00:00"`.

---

## Деплой (текущее решение)

### Инфраструктура

| Компонент | Платформа | URL | Примечания |
|-----------|-----------|-----|------------|
| Frontend | Vercel | https://surf-videos-psi.vercel.app | Auto-deploy из GitHub main |
| Backend | Render.com | https://surf-videos.onrender.com | Free tier, засыпает после 15 мин |
| MySQL | Aiven.io | mysql-1c2125cd-ptptoat-2cd2.f.aivencloud.com:23445 | **ИСТЁК 01.05.2026** — заменить на freesqldatabase.com (обновить DATABASE_URL в Render) |
| Redis | Upstash | on-macaque-74828.upstash.io:6379 | Free навсегда, 256MB |

### Важные детали

- **Render засыпает** после 15 мин неактивности → первый запрос ждёт ~50 сек. Перед демо открыть `https://surf-videos.onrender.com/docs` чтобы разбудить.
- **Aiven истёк** 01.05.2026. Перейти на freesqldatabase.com (обновить `DATABASE_URL` в Render Environment Variables).
- **SSL для Aiven:** в `app/database.py` — `ssl_ctx.verify_mode = ssl.CERT_NONE` (самоподписанный сертификат Aiven).
- **`VITE_BACKEND_URL`** выставлен в Vercel Environment Variables → `https://surf-videos.onrender.com`.

### Переменные окружения на Render

```
DATABASE_URL=mysql+aiomysql://avnadmin:...@mysql-1c2125cd-ptptoat-2cd2.f.aivencloud.com:23445/defaultdb
REDIS_URL=rediss://default:...@on-macaque-74828.upstash.io:6379
SECRET_KEY=...
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
```

---

## Команды для запуска (локально)

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
