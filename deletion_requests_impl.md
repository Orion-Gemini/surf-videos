# Реализация системы запросов на удаление аккаунта

## Общее описание

Пользователь может подать заявку на удаление своего аккаунта прямо из профиля. Заявка попадает в очередь (тикеты) в панели суперадмина. Администратор просматривает заявки, может посмотреть причину, одобрить (аккаунт удаляется) или отклонить. Это сделано в соответствии с требованиями политики обработки персональных данных, которая предоставляет пользователю право на удаление своих данных.

---

## 1. База данных — модель DeletionRequest

**Файл:** `backend/app/models/deletion_request.py`

```python
from datetime import datetime
from sqlalchemy import Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from app.database import Base


class DeletionRequest(Base):
    __tablename__ = "deletion_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    user: Mapped["User"] = relationship("User")
```

**Поля:**
- `user_id` — FK на таблицу `users` с `ondelete="CASCADE"` (запись удалится автоматически при удалении пользователя)
- `reason` — необязательная причина от пользователя (TEXT, может быть NULL)
- `status` — строка: `"pending"` (ожидает), `"approved"` (одобрен), `"rejected"` (отклонён)
- `created_at` — дата подачи (заполняется автоматически)
- `resolved_at` — дата рассмотрения (заполняется при reject вручную)

**Таблица создаётся автоматически** через `Base.metadata.create_all` при старте приложения.

**Регистрация модели** в `backend/app/models/__init__.py`:

```python
from app.models.deletion_request import DeletionRequest
__all__ = [..., "DeletionRequest"]
```

---

## 2. Backend — пользовательские эндпоинты

**Файл:** `backend/app/routers/users.py`

### Pydantic-схемы

```python
from pydantic import BaseModel
from datetime import datetime

class DeletionRequestIn(BaseModel):
    reason: str | None = None

class DeletionRequestOut(BaseModel):
    id: int
    reason: str | None
    status: str
    created_at: datetime
    model_config = {"from_attributes": True}
```

### Эндпоинты

**POST /users/me/deletion-request** — подать заявку

```python
@router.post("/me/deletion-request", response_model=DeletionRequestOut, status_code=201)
async def create_deletion_request(
    data: DeletionRequestIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(
        select(DeletionRequest).where(
            DeletionRequest.user_id == current_user.id,
            DeletionRequest.status == "pending",
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Заявка уже отправлена и ожидает рассмотрения")
    req = DeletionRequest(user_id=current_user.id, reason=data.reason or None, status="pending")
    db.add(req)
    await db.commit()
    await db.refresh(req)
    return req
```

**GET /users/me/deletion-request** — получить текущую заявку (последнюю)

```python
@router.get("/me/deletion-request", response_model=DeletionRequestOut | None)
async def get_my_deletion_request(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(DeletionRequest)
        .where(DeletionRequest.user_id == current_user.id)
        .order_by(DeletionRequest.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()
```

**DELETE /users/me/deletion-request** — отозвать pending-заявку

```python
@router.delete("/me/deletion-request", status_code=204)
async def cancel_deletion_request(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(DeletionRequest).where(
            DeletionRequest.user_id == current_user.id,
            DeletionRequest.status == "pending",
        )
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Активная заявка не найдена")
    await db.delete(req)
    await db.commit()
```

---

## 3. Backend — эндпоинты администратора

**Файл:** `backend/app/routers/admin.py`

### Вспомогательная функция удаления пользователя

В проекте FK на таблицу `users` в моделях `Room`, `RoomMember`, `Message` заданы **без** `ON DELETE CASCADE` на уровне БД. Поэтому при попытке удалить пользователя через ORM (`db.delete(user)`) MySQL блокирует операцию из-за constraint violations. Решение — вручную удалять зависимые записи в правильном порядке:

```python
from sqlalchemy import delete as sql_delete

async def delete_user_cascade(user_id: int, db: AsyncSession) -> None:
    # Находим комнаты которыми владеет пользователь
    owned_ids_result = await db.execute(select(Room.id).where(Room.owner_id == user_id))
    owned_ids = list(owned_ids_result.scalars())

    if owned_ids:
        # Удаляем сообщения и участников в этих комнатах
        await db.execute(sql_delete(Message).where(Message.room_id.in_(owned_ids)))
        await db.execute(sql_delete(RoomMember).where(RoomMember.room_id.in_(owned_ids)))
        # Удаляем сами комнаты
        await db.execute(sql_delete(Room).where(Room.id.in_(owned_ids)))

    # Удаляем сообщения и членства пользователя в чужих комнатах
    await db.execute(sql_delete(Message).where(Message.user_id == user_id))
    await db.execute(sql_delete(RoomMember).where(RoomMember.user_id == user_id))
    # Удаляем пользователя (DeletionRequest каскадно удаляется через ondelete="CASCADE" на FK)
    await db.execute(sql_delete(User).where(User.id == user_id))
```

Эта функция используется и при прямом удалении пользователя из таблицы (`DELETE /admin/users/{id}`), и при одобрении заявки.

### Pydantic-схема для отображения заявок

```python
class DeletionRequestAdminOut(BaseModel):
    id: int
    user_id: int
    username: str
    email: str
    reason: str | None
    status: str
    created_at: datetime
    model_config = {"from_attributes": True}
```

### Эндпоинты

**GET /admin/deletion-requests** — список всех заявок (pending идут первыми)

```python
@router.get("/deletion-requests", response_model=list[DeletionRequestAdminOut])
async def list_deletion_requests(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_superuser),
):
    result = await db.execute(
        select(DeletionRequest)
        .options(selectinload(DeletionRequest.user))
        .order_by(DeletionRequest.status, DeletionRequest.created_at.desc())
    )
    rows = result.scalars().all()
    return [
        DeletionRequestAdminOut(
            id=r.id, user_id=r.user_id,
            username=r.user.username, email=r.user.email,
            reason=r.reason, status=r.status, created_at=r.created_at,
        )
        for r in rows
    ]
```

**POST /admin/deletion-requests/{id}/approve** — одобрить (удалить пользователя)

```python
@router.post("/deletion-requests/{request_id}/approve", status_code=204)
async def approve_deletion_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_superuser),
):
    result = await db.execute(
        select(DeletionRequest)
        .options(selectinload(DeletionRequest.user))
        .where(DeletionRequest.id == request_id)
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    if req.status != "pending":
        raise HTTPException(status_code=400, detail="Заявка уже обработана")
    if req.user.username == settings.SUPERUSER_USERNAME:
        raise HTTPException(status_code=403, detail="Нельзя удалить суперадмина")
    if req.user_id == current.id:
        raise HTTPException(status_code=400, detail="Нельзя удалить самого себя")
    await delete_user_cascade(req.user_id, db)
    await db.commit()
```

**POST /admin/deletion-requests/{id}/reject** — отклонить заявку

```python
@router.post("/deletion-requests/{request_id}/reject", status_code=204)
async def reject_deletion_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_superuser),
):
    result = await db.execute(
        select(DeletionRequest).where(DeletionRequest.id == request_id)
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    if req.status != "pending":
        raise HTTPException(status_code=400, detail="Заявка уже обработана")
    req.status = "rejected"
    req.resolved_at = datetime.now(timezone.utc)
    await db.commit()
```

---

## 4. Frontend — страница профиля (ProfilePage.jsx)

### State-переменные

```js
const [deletionRequest, setDeletionRequest] = useState(undefined); // undefined = ещё не загружено
const [showDeletionForm, setShowDeletionForm] = useState(false);
const [deletionReason, setDeletionReason] = useState("");
const [deletionLoading, setDeletionLoading] = useState(false);
const [deletionError, setDeletionError] = useState("");
```

### Загрузка текущей заявки при монтировании

```js
useEffect(() => {
    api.get("/users/me/deletion-request")
      .then(({ data }) => setDeletionRequest(data))
      .catch(() => setDeletionRequest(null));
}, []);
```

### Обработчики

```js
async function handleDeletionSubmit(e) {
    e.preventDefault();
    setDeletionLoading(true);
    try {
        const { data } = await api.post("/users/me/deletion-request", { reason: deletionReason || null });
        setDeletionRequest(data);
        setShowDeletionForm(false);
        setDeletionReason("");
    } catch (err) {
        setDeletionError(err.response?.data?.detail || "Ошибка");
    } finally {
        setDeletionLoading(false);
    }
}

async function handleDeletionCancel() {
    setDeletionLoading(true);
    try {
        await api.delete("/users/me/deletion-request");
        setDeletionRequest(null);
    } catch (err) {
        setDeletionError(err.response?.data?.detail || "Ошибка");
    } finally {
        setDeletionLoading(false);
    }
}
```

### JSX — секция "Удалить аккаунт"

Секция располагается между формой смены пароля и кнопкой выхода. Раскрывается по клику (аналогично смене пароля). Внутри отображается одно из трёх состояний:

1. **Заявка pending** — сообщение "ожидает рассмотрения" + кнопка "Отозвать заявку"
2. **Заявка rejected** — сообщение "была отклонена" + форма для подачи новой заявки
3. **Нет заявки** — форма с необязательным textarea (причина) + кнопка "Отправить заявку"

Textarea имеет `style={{ userSelect: "text", WebkitUserSelect: "text" }}` и CSS `resize: none` чтобы не выходил за границы карточки.

---

## 5. Frontend — панель администратора (LobbyPage.jsx)

### State и загрузка данных

```js
const [adminDeletionRequests, setAdminDeletionRequests] = useState([]);
const [reasonModal, setReasonModal] = useState(null); // string | null — текст причины для модалки
```

В функции `loadAdminData` добавлен запрос:

```js
const [usersRes, roomsRes, delRes] = await Promise.all([
    api.get("/admin/users"),
    api.get("/admin/rooms"),
    api.get("/admin/deletion-requests"),
]);
setAdminDeletionRequests(delRes.data);
```

### Обработчики

```js
function handleApproveDeletion(reqId, username) {
    askConfirm({
        icon: "💀",
        title: "Подтвердить удаление?",
        message: `Аккаунт @${username} будет удалён безвозвратно.`,
        confirmLabel: "Удалить",
        onConfirm: async () => {
            await api.post(`/admin/deletion-requests/${reqId}/approve`);
            setAdminDeletionRequests(prev => prev.filter(r => r.id !== reqId));
            setAdminUsers(prev => prev.filter(u => u.username !== username));
        }
    });
}

async function handleRejectDeletion(reqId) {
    await api.post(`/admin/deletion-requests/${reqId}/reject`);
    setAdminDeletionRequests(prev =>
        prev.map(r => r.id === reqId ? { ...r, status: "rejected" } : r)
    );
}
```

### Таблица тикетов (JSX)

Таблица в секции "Запросы на удаление" находится в admin panel (вкладка видна только суперадмину). Колонки: **Пользователь / Email / Причина / Дата / Статус / Действия**.

- Колонка **Причина**: если причина есть — кнопка "Просмотреть", при клике открывает `reasonModal`; если нет — прочерк.
- Колонка **Действия**: для pending-заявок — кнопки "Одобрить" и "Отклонить". Для остальных статусов — пусто.
- Счётчик `N ожидают` в заголовке секции показывает только pending-заявки.

### Модалка причины

```jsx
{reasonModal && (
    <div className={styles.modalOverlay} onClick={() => setReasonModal(null)}>
        <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalIcon}>💬</div>
            <h3 className={styles.modalTitle}>Причина удаления</h3>
            <p className={styles.modalMessage}>{reasonModal}</p>
            <div className={styles.modalActions}>
                <button className={styles.modalCancel} onClick={() => setReasonModal(null)}>Закрыть</button>
            </div>
        </div>
    </div>
)}
```

---

## 6. CSS

### LobbyPage.module.css — бейджи статусов

```css
.badgeTicketPending  { background: rgba(223,160,110,0.15); color: var(--c-accent); }
.badgeTicketApproved { background: rgba(76,175,80,0.12);   color: #4caf50; }
.badgeTicketRejected { background: rgba(100,116,139,0.12); color: var(--c-text3); }
```

### LobbyPage.module.css — масштабируемость таблиц

Все три таблицы (пользователи, комнаты, тикеты) обёрнуты в `adminTableWrap` с `overflow-x: auto` — при нехватке ширины появляется горизонтальный скролл. Таблица внутри имеет `min-width: max-content`.

### ProfilePage.module.css — новые классы

- `.btnDanger` — красная кнопка с прозрачным фоном для кнопки "Отправить заявку"
- `.btnGhost` — серая кнопка для "Отозвать заявку"
- `.deletionSection`, `.deletionPending`, `.deletionStatusText`, `.deletionReason`, `.deletionHint` — стили секции удаления

---

## 7. Поток данных — сценарии использования

### Сценарий 1: пользователь подаёт заявку
1. Профиль → раздел "Удалить аккаунт" → вводит причину (необязательно) → "Отправить заявку"
2. `POST /users/me/deletion-request` → статус `pending`
3. Секция переключается в режим "ожидает рассмотрения"

### Сценарий 2: пользователь отзывает заявку
1. Профиль → "Отозвать заявку"
2. `DELETE /users/me/deletion-request` → запись удаляется
3. Секция возвращается в форму подачи

### Сценарий 3: администратор одобряет
1. Лобби → "Панель администратора" → "Запросы на удаление" → "Одобрить" → confirm-модал
2. `POST /admin/deletion-requests/{id}/approve`
3. Бэкенд удаляет все данные пользователя в порядке: сообщения в его комнатах → участники в его комнатах → его комнаты → его сообщения в чужих комнатах → его членства в чужих комнатах → пользователь (запись `deletion_requests` каскадно удаляется через `ondelete="CASCADE"`)
4. Строка исчезает из таблицы тикетов, пользователь исчезает из таблицы пользователей

### Сценарий 4: администратор отклоняет
1. "Отклонить" → `POST /admin/deletion-requests/{id}/reject`
2. `status` → `"rejected"`, `resolved_at` → текущее время
3. Бейдж строки меняется на "Отклонён"
4. Пользователь в профиле увидит "заявка была отклонена" и сможет подать новую
