import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import { useAuthStore } from "../store/auth";
import { useThemeStore } from "../store/theme";
import styles from "./LobbyPage.module.css";

export default function LobbyPage() {
  const { user, logout } = useAuthStore();
  const { theme, toggle } = useThemeStore();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState("rooms");
  const [rooms, setRooms] = useState([]);
  const [myRooms, setMyRooms] = useState([]);
  const [myRoomsLoading, setMyRoomsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", type: "public" });
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");

  // Admin state
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminRooms, setAdminRooms] = useState([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState("");

  async function loadRooms() {
    try {
      const { data } = await api.get("/rooms");
      setRooms(data);
    } finally {
      setLoading(false);
    }
  }

  async function loadMyRooms() {
    setMyRoomsLoading(true);
    try {
      const { data } = await api.get("/rooms/my");
      setMyRooms(data);
    } finally {
      setMyRoomsLoading(false);
    }
  }

  async function loadAdminData() {
    setAdminLoading(true);
    setAdminError("");
    try {
      const [usersRes, roomsRes] = await Promise.all([
        api.get("/admin/users"),
        api.get("/admin/rooms"),
      ]);
      setAdminUsers(usersRes.data);
      setAdminRooms(roomsRes.data);
    } catch {
      setAdminError("Ошибка загрузки данных");
    } finally {
      setAdminLoading(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError("");
    try {
      const { data } = await api.post("/rooms", createForm);
      navigate(`/room/${data.id}`);
    } catch (err) {
      setError(err.response?.data?.detail || "Ошибка");
    }
  }

  async function handleJoin(e) {
    e.preventDefault();
    setError("");
    try {
      const { data } = await api.post("/rooms/join", { invite_code: joinCode.trim().toUpperCase() });
      navigate(`/room/${data.id}`);
    } catch (err) {
      setError(err.response?.data?.detail || "Неверный код");
    }
  }

  async function handleDeleteRoom(roomId, e) {
    e.stopPropagation();
    if (!confirm("Удалить комнату?")) return;
    try {
      await api.delete(`/rooms/${roomId}`);
      setRooms(prev => prev.filter(r => r.id !== roomId));
      setMyRooms(prev => prev.filter(r => r.id !== roomId));
    } catch (err) {
      alert(err.response?.data?.detail || "Ошибка удаления");
    }
  }

  async function handleLeaveRoom(roomId, e) {
    e.stopPropagation();
    if (!confirm("Покинуть комнату?")) return;
    try {
      await api.delete(`/rooms/${roomId}/leave`);
      setMyRooms(prev => prev.filter(r => r.id !== roomId));
    } catch (err) {
      alert(err.response?.data?.detail || "Ошибка");
    }
  }

  async function handleAdminDeleteRoom(roomId) {
    if (!confirm("Удалить комнату?")) return;
    try {
      await api.delete(`/admin/rooms/${roomId}`);
      setAdminRooms(prev => prev.filter(r => r.id !== roomId));
    } catch (err) {
      alert(err.response?.data?.detail || "Ошибка удаления");
    }
  }

  async function handlePromote(userId, isSuperuser) {
    try {
      const { data } = await api.patch(`/admin/users/${userId}/promote`, { is_superuser: isSuperuser });
      setAdminUsers(prev => prev.map(u => u.id === userId ? data : u));
    } catch (err) {
      alert(err.response?.data?.detail || "Ошибка");
    }
  }

  function handleLogout() {
    logout();
    navigate("/auth");
  }

  useEffect(() => { loadRooms(); }, []);

  useEffect(() => {
    if (activeTab === "my") loadMyRooms();
    if (activeTab === "admin" && user?.is_superuser) loadAdminData();
  }, [activeTab]);

  function RoomCard({ room, onDelete, onLeave }) {
    const isOwner = room.owner?.username === user?.username;
    const canDelete = isOwner || user?.is_superuser;
    const canLeave = onLeave && !isOwner;
    return (
      <div className={styles.roomCard} onClick={() => navigate(`/room/${room.id}`)}>
        <div className={styles.roomCardTop}>
          <div className={styles.roomName}>{room.name}</div>
          <div className={styles.roomCardActions}>
            {canLeave && (
              <button className={styles.btnLeave} onClick={(e) => onLeave(room.id, e)} title="Покинуть комнату">
                Покинуть
              </button>
            )}
            {canDelete && (
              <button className={styles.btnDelete} onClick={(e) => onDelete(room.id, e)} title="Удалить комнату">
                ✕
              </button>
            )}
          </div>
        </div>
        <div className={styles.roomMeta}>
          <span>● {room.member_count} онлайн</span>
          <div className={styles.roomMetaRight}>
            {room.type === "private" && (
              <span className={styles.roomInvite} onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(room.invite_code); }} title="Скопировать код">
                🔒 {room.invite_code}
              </span>
            )}
            <span className={styles.roomOwner}>@{room.owner.username}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <img
            src={theme === "dark" ? "/logo-dark.png" : "/logo-light.png"}
            alt="Surf Videos"
            className={styles.logoImg}
          />
          <span className={styles.logo}>Surf<span> Videos</span></span>
        </div>
        <div className={styles.headerRight}>
          <button className={styles.btnTheme} onClick={toggle} title="Сменить тему">
            {theme === "dark" ? "☀" : "🌙"}
          </button>
          <span className={styles.username}>{user?.username}</span>
          <button className={styles.btnGhost} onClick={handleLogout}>Выйти</button>
        </div>
      </header>

      <div className={styles.tabBar}>
        <button
          className={activeTab === "rooms" ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab("rooms")}
        >
          Публичные комнаты
        </button>
        <button
          className={activeTab === "my" ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab("my")}
        >
          Мои комнаты
        </button>
        {user?.is_superuser && (
          <button
            className={activeTab === "admin" ? styles.tabActive : styles.tab}
            onClick={() => setActiveTab("admin")}
          >
            Панель администратора
          </button>
        )}
      </div>

      <main className={styles.main}>
        {activeTab === "rooms" && (
          <>
            <div className={styles.actions}>
              <button className={styles.btn} onClick={() => { setShowCreate(true); setShowJoin(false); setError(""); }}>
                + Создать комнату
              </button>
              <button className={styles.btnSecondary} onClick={() => { setShowJoin(true); setShowCreate(false); setError(""); }}>
                Войти по коду
              </button>
              <button className={styles.btnGhost} onClick={loadRooms}>Обновить</button>
            </div>

            {showCreate && (
              <form className={styles.panel} onSubmit={handleCreate}>
                <h3 className={styles.panelTitle}>Новая комната</h3>
                <input
                  className={styles.input}
                  placeholder="Название комнаты"
                  value={createForm.name}
                  onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
                  required
                />
                <div className={styles.radioGroup}>
                  <label className={styles.radio}>
                    <input type="radio" value="public" checked={createForm.type === "public"}
                      onChange={() => setCreateForm({ ...createForm, type: "public" })} />
                    Публичная
                  </label>
                  <label className={styles.radio}>
                    <input type="radio" value="private" checked={createForm.type === "private"}
                      onChange={() => setCreateForm({ ...createForm, type: "private" })} />
                    Приватная
                  </label>
                </div>
                {error && <p className={styles.error}>{error}</p>}
                <div className={styles.panelActions}>
                  <button className={styles.btn} type="submit">Создать</button>
                  <button className={styles.btnGhost} type="button" onClick={() => setShowCreate(false)}>Отмена</button>
                </div>
              </form>
            )}

            {showJoin && (
              <form className={styles.panel} onSubmit={handleJoin}>
                <h3 className={styles.panelTitle}>Войти по коду</h3>
                <input
                  className={styles.input}
                  placeholder="Invite-код (8 символов)"
                  value={joinCode}
                  onChange={e => setJoinCode(e.target.value)}
                  maxLength={8}
                  required
                />
                {error && <p className={styles.error}>{error}</p>}
                <div className={styles.panelActions}>
                  <button className={styles.btn} type="submit">Войти</button>
                  <button className={styles.btnGhost} type="button" onClick={() => setShowJoin(false)}>Отмена</button>
                </div>
              </form>
            )}

            <h2 className={styles.sectionTitle}>Публичные комнаты</h2>

            {loading && <p className={styles.hint}>Загрузка...</p>}
            {!loading && rooms.length === 0 && (
              <p className={styles.hint}>Нет активных комнат. Создай первую!</p>
            )}

            <div className={styles.roomGrid}>
              {rooms.map(room => (
                <RoomCard key={room.id} room={room} onDelete={handleDeleteRoom} />
              ))}
            </div>

            <div className={styles.features}>
              <div className={styles.featureCard}>
                <span className={styles.featureIcon}>🎬</span>
                <h3 className={styles.featureTitle}>Синхронный просмотр</h3>
                <p className={styles.featureText}>Видео играет одновременно у всех участников. Пауза, перемотка и смена видео мгновенно синхронизируются.</p>
              </div>
              <div className={styles.featureCard}>
                <span className={styles.featureIcon}>💬</span>
                <h3 className={styles.featureTitle}>Живой чат</h3>
                <p className={styles.featureText}>Обсуждайте видео в реальном времени. История чата сохраняется — опоздавшие не пропустят ничего важного.</p>
              </div>
              <div className={styles.featureCard}>
                <span className={styles.featureIcon}>🎭</span>
                <h3 className={styles.featureTitle}>Реакции и очередь</h3>
                <p className={styles.featureText}>Отправляйте летящие эмодзи прямо поверх видео. Собирайте плейлист через общую очередь просмотра.</p>
              </div>
            </div>
          </>
        )}

        {activeTab === "my" && (
          <>
            <div className={styles.actions}>
              <button className={styles.btn} onClick={() => { setShowCreate(true); setShowJoin(false); setError(""); }}>
                + Создать комнату
              </button>
              <button className={styles.btnSecondary} onClick={() => { setShowJoin(true); setShowCreate(false); setError(""); }}>
                Войти по коду
              </button>
              <button className={styles.btnGhost} onClick={loadMyRooms}>Обновить</button>
            </div>

            {showCreate && (
              <form className={styles.panel} onSubmit={handleCreate}>
                <h3 className={styles.panelTitle}>Новая комната</h3>
                <input
                  className={styles.input}
                  placeholder="Название комнаты"
                  value={createForm.name}
                  onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
                  required
                />
                <div className={styles.radioGroup}>
                  <label className={styles.radio}>
                    <input type="radio" value="public" checked={createForm.type === "public"}
                      onChange={() => setCreateForm({ ...createForm, type: "public" })} />
                    Публичная
                  </label>
                  <label className={styles.radio}>
                    <input type="radio" value="private" checked={createForm.type === "private"}
                      onChange={() => setCreateForm({ ...createForm, type: "private" })} />
                    Приватная
                  </label>
                </div>
                {error && <p className={styles.error}>{error}</p>}
                <div className={styles.panelActions}>
                  <button className={styles.btn} type="submit">Создать</button>
                  <button className={styles.btnGhost} type="button" onClick={() => setShowCreate(false)}>Отмена</button>
                </div>
              </form>
            )}

            {showJoin && (
              <form className={styles.panel} onSubmit={handleJoin}>
                <h3 className={styles.panelTitle}>Войти по коду</h3>
                <input
                  className={styles.input}
                  placeholder="Invite-код (8 символов)"
                  value={joinCode}
                  onChange={e => setJoinCode(e.target.value)}
                  maxLength={8}
                  required
                />
                {error && <p className={styles.error}>{error}</p>}
                <div className={styles.panelActions}>
                  <button className={styles.btn} type="submit">Войти</button>
                  <button className={styles.btnGhost} type="button" onClick={() => setShowJoin(false)}>Отмена</button>
                </div>
              </form>
            )}

            <h2 className={styles.sectionTitle}>Мои комнаты</h2>

            {myRoomsLoading && <p className={styles.hint}>Загрузка...</p>}
            {!myRoomsLoading && myRooms.length === 0 && (
              <p className={styles.hint}>Вы ещё не состоите ни в одной комнате.</p>
            )}

            <div className={styles.roomGrid}>
              {myRooms.map(room => (
                <RoomCard key={room.id} room={room} onDelete={handleDeleteRoom} onLeave={handleLeaveRoom} />
              ))}
            </div>
          </>
        )}

        {activeTab === "admin" && user?.is_superuser && (
          <div className={styles.adminPanel}>
            {adminLoading && <p className={styles.hint}>Загрузка...</p>}
            {adminError && <p className={styles.error}>{adminError}</p>}

            {!adminLoading && (
              <>
                <section className={styles.adminSection}>
                  <div className={styles.adminSectionHeader}>
                    <h2 className={styles.sectionTitle}>Пользователи</h2>
                    <span className={styles.adminCount}>{adminUsers.length}</span>
                  </div>
                  <div className={styles.adminTable}>
                    <div className={styles.adminTableHead}>
                      <span>ID</span>
                      <span>Логин</span>
                      <span>Email</span>
                      <span>Роль</span>
                      <span>Действия</span>
                    </div>
                    {adminUsers.map(u => (
                      <div key={u.id} className={styles.adminTableRow}>
                        <span className={styles.adminId}>#{u.id}</span>
                        <span className={styles.adminUsername}>{u.username}</span>
                        <span className={styles.adminEmail}>{u.email}</span>
                        <span>
                          {u.is_superuser
                            ? <span className={styles.badgeAdmin}>Администратор</span>
                            : <span className={styles.badgeUser}>Пользователь</span>
                          }
                        </span>
                        <span className={styles.adminActions}>
                          {u.id !== user.id && (
                            u.is_superuser
                              ? <button className={styles.btnDemote} onClick={() => handlePromote(u.id, false)}>Разжаловать</button>
                              : <button className={styles.btnPromote} onClick={() => handlePromote(u.id, true)}>Назначить админом</button>
                          )}
                          {u.id === user.id && <span className={styles.adminSelf}>Вы</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className={styles.adminSection}>
                  <div className={styles.adminSectionHeader}>
                    <h2 className={styles.sectionTitle}>Все комнаты</h2>
                    <span className={styles.adminCount}>{adminRooms.length}</span>
                  </div>
                  <div className={styles.adminTable}>
                    <div className={styles.adminTableHead}>
                      <span>ID</span>
                      <span>Название</span>
                      <span>Тип</span>
                      <span>Владелец</span>
                      <span>Действия</span>
                    </div>
                    {adminRooms.map(r => (
                      <div key={r.id} className={styles.adminTableRow}>
                        <span className={styles.adminId}>#{r.id}</span>
                        <span className={styles.adminRoomName}>{r.name}</span>
                        <span>
                          {r.type === "public"
                            ? <span className={styles.badgePublic}>Публичная</span>
                            : <span className={styles.badgePrivate}>Приватная</span>
                          }
                        </span>
                        <span className={styles.adminEmail}>@{r.owner_username}</span>
                        <span className={styles.adminActions}>
                          <button className={styles.btnDemote} onClick={() => handleAdminDeleteRoom(r.id)}>Удалить</button>
                        </span>
                      </div>
                    ))}
                    {adminRooms.length === 0 && (
                      <p className={styles.hint}>Нет комнат</p>
                    )}
                  </div>
                </section>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
