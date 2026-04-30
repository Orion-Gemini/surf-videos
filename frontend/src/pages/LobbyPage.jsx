import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import { useAuthStore } from "../store/auth";
import { useThemeStore } from "../store/theme";
import styles from "./LobbyPage.module.css";

function useCountUp(target, duration = 700) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!target) { setValue(0); return; }
    let raf;
    let start = null;
    const animate = (ts) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

function RoomCard({ room, user, goTo, onDelete, onLeave }) {
  const isOwner = room.owner?.username === user?.username;
  const canDelete = isOwner || user?.is_superuser;
  const canLeave = onLeave && !isOwner;
  return (
    <div className={styles.roomCard} onClick={() => goTo(`/room/${room.id}`)}>
      <div className={styles.roomCardInner}>
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
          <span><span className={styles.onlineDot} />{room.member_count} онлайн</span>
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
    </div>
  );
}

export default function LobbyPage() {
  const { user, logout } = useAuthStore();
  const { theme, toggle } = useThemeStore();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState("rooms");
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const tabRefs = useRef({});
  const [rooms, setRooms] = useState([]);
  const [myRooms, setMyRooms] = useState([]);
  const [myRoomsLoading, setMyRoomsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", type: "public" });
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");
  const [confirmModal, setConfirmModal] = useState(null);
  const [leaving, setLeaving] = useState(false);

  function goTo(path) {
    setLeaving(true);
    setTimeout(() => navigate(path), 220);
  }

  // Admin state
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminRooms, setAdminRooms] = useState([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [roomSearch, setRoomSearch] = useState("");

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
      goTo(`/room/${data.id}`);
    } catch (err) {
      setError(err.response?.data?.detail || "Ошибка");
    }
  }

  async function handleJoin(e) {
    e.preventDefault();
    setError("");
    try {
      const { data } = await api.post("/rooms/join", { invite_code: joinCode.trim().toUpperCase() });
      goTo(`/room/${data.id}`);
    } catch (err) {
      setError(err.response?.data?.detail || "Неверный код");
    }
  }

  function askConfirm({ icon, title, message, confirmLabel, onConfirm }) {
    setConfirmModal({ icon, title, message, confirmLabel, onConfirm });
  }

  function handleDeleteRoom(roomId, e) {
    e.stopPropagation();
    askConfirm({
      icon: "🗑️",
      title: "Удалить комнату?",
      message: "Все участники будут отключены. Это действие нельзя отменить.",
      confirmLabel: "Удалить",
      onConfirm: async () => {
        try {
          await api.delete(`/rooms/${roomId}`);
          setRooms(prev => prev.filter(r => r.id !== roomId));
          setMyRooms(prev => prev.filter(r => r.id !== roomId));
        } catch (err) {
          alert(err.response?.data?.detail || "Ошибка удаления");
        }
      }
    });
  }

  function handleLeaveRoom(roomId, e) {
    e.stopPropagation();
    askConfirm({
      icon: "🚪",
      title: "Покинуть комнату?",
      message: "Ты сможешь войти снова по invite-коду или через публичный список.",
      confirmLabel: "Покинуть",
      onConfirm: async () => {
        try {
          await api.delete(`/rooms/${roomId}/leave`);
          setMyRooms(prev => prev.filter(r => r.id !== roomId));
        } catch (err) {
          alert(err.response?.data?.detail || "Ошибка");
        }
      }
    });
  }

  function handleAdminDeleteRoom(roomId) {
    askConfirm({
      icon: "⚠️",
      title: "Удалить комнату?",
      message: "Комната будет удалена для всех пользователей.",
      confirmLabel: "Удалить",
      onConfirm: async () => {
        try {
          await api.delete(`/admin/rooms/${roomId}`);
          setAdminRooms(prev => prev.filter(r => r.id !== roomId));
        } catch (err) {
          alert(err.response?.data?.detail || "Ошибка удаления");
        }
      }
    });
  }

  async function handlePromote(userId, isSuperuser) {
    try {
      const { data } = await api.patch(`/admin/users/${userId}/promote`, { is_superuser: isSuperuser });
      setAdminUsers(prev => prev.map(u => u.id === userId ? data : u));
    } catch (err) {
      alert(err.response?.data?.detail || "Ошибка");
    }
  }

  function handleBanUser(userId, isActive) {
    const title = isActive ? "Заблокировать пользователя?" : "Разблокировать пользователя?";
    const message = isActive
      ? "Пользователь потеряет доступ к платформе. Все активные сессии будут прерваны."
      : "Пользователь снова сможет входить на платформу.";
    askConfirm({
      icon: isActive ? "🚫" : "✅",
      title,
      message,
      confirmLabel: isActive ? "Заблокировать" : "Разблокировать",
      onConfirm: async () => {
        try {
          const { data } = await api.patch(`/admin/users/${userId}/ban`, { is_active: !isActive });
          setAdminUsers(prev => prev.map(u => u.id === userId ? data : u));
        } catch (err) {
          alert(err.response?.data?.detail || "Ошибка");
        }
      }
    });
  }

  function handleAdminDeleteUser(userId, username) {
    askConfirm({
      icon: "💀",
      title: "Удалить аккаунт?",
      message: `Аккаунт @${username} будет удалён безвозвратно вместе со всеми данными.`,
      confirmLabel: "Удалить",
      onConfirm: async () => {
        try {
          await api.delete(`/admin/users/${userId}`);
          setAdminUsers(prev => prev.filter(u => u.id !== userId));
        } catch (err) {
          alert(err.response?.data?.detail || "Ошибка");
        }
      }
    });
  }

  function handleLogout() {
    logout();
    goTo("/auth");
  }

  // Счётчики для admin-панели
  const adminTotalAdmins = adminUsers.filter(u => u.is_superuser).length;
  const adminTotalOnline = adminRooms.reduce((s, r) => s + (r.online_count || 0), 0);
  const animUsers  = useCountUp(adminLoading ? 0 : adminUsers.length, 1200);
  const animRooms  = useCountUp(adminLoading ? 0 : adminRooms.length, 1200);
  const animAdmins = useCountUp(adminLoading ? 0 : adminTotalAdmins, 1200);
  const animOnline = useCountUp(adminLoading ? 0 : adminTotalOnline, 1200);

  useEffect(() => { loadRooms(); }, []);

  useEffect(() => {
    if (activeTab === "my") loadMyRooms();
    if (activeTab === "admin" && user?.is_superuser) loadAdminData();
  }, [activeTab]);

  useLayoutEffect(() => {
    const btn = tabRefs.current[activeTab];
    if (btn) setIndicator({ left: btn.offsetLeft, width: btn.offsetWidth });
  }, [activeTab, user?.is_superuser]);

  return (
    <div className={`${styles.page}${leaving ? ` ${styles.pageFadeOut}` : ""}`}>
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
          <button className={styles.btnTheme} onClick={(e) => toggle(e)} title="Сменить тему">
            {theme === "dark" ? "☀" : "🌙"}
          </button>
          <button className={styles.btnUsername} onClick={() => goTo("/profile")}>{user?.username}</button>
          <button className={styles.btnGhost} onClick={handleLogout}>Выйти</button>
        </div>
      </header>

      <div className={styles.tabBar}>
        <div
          className={styles.tabIndicator}
          style={{ left: indicator.left, width: indicator.width }}
        />
        <button
          ref={el => tabRefs.current["rooms"] = el}
          className={activeTab === "rooms" ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab("rooms")}
        >
          Публичные комнаты
        </button>
        <button
          ref={el => tabRefs.current["my"] = el}
          className={activeTab === "my" ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab("my")}
        >
          Мои комнаты
        </button>
        {user?.is_superuser && (
          <button
            ref={el => tabRefs.current["admin"] = el}
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
                <RoomCard key={room.id} room={room} user={user} goTo={goTo} onDelete={handleDeleteRoom} />
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
                <RoomCard key={room.id} room={room} user={user} goTo={goTo} onDelete={handleDeleteRoom} onLeave={handleLeaveRoom} />
              ))}
            </div>

            <div className={styles.features}>
              <div className={styles.featureCard}>
                <span className={styles.featureIcon}>🔒</span>
                <h3 className={styles.featureTitle}>Приватные комнаты</h3>
                <p className={styles.featureText}>Создай приватную комнату и поделись invite-кодом только с друзьями. Посторонние не смогут войти без кода.</p>
              </div>
              <div className={styles.featureCard}>
                <span className={styles.featureIcon}>👑</span>
                <h3 className={styles.featureTitle}>Ты — администратор</h3>
                <p className={styles.featureText}>В своей комнате ты управляешь плеером, очередью видео и можешь удалить комнату в любой момент.</p>
              </div>
              <div className={styles.featureCard}>
                <span className={styles.featureIcon}>🚪</span>
                <h3 className={styles.featureTitle}>Гостевые комнаты</h3>
                <p className={styles.featureText}>Вступил в чужую комнату по коду? Она тоже здесь. Можешь покинуть её в любое время — кнопка "Покинуть" на карточке.</p>
              </div>
            </div>
          </>
        )}

        {activeTab === "admin" && user?.is_superuser && (
          <div className={styles.adminPanel}>
            {adminLoading && <p className={styles.hint}>Загрузка...</p>}
            {adminError && <p className={styles.error}>{adminError}</p>}

            {!adminLoading && (() => {
              const filteredUsers = userSearch
                ? adminUsers.filter(u =>
                    u.username.toLowerCase().includes(userSearch.toLowerCase()) ||
                    u.email.toLowerCase().includes(userSearch.toLowerCase()))
                : adminUsers;
              const filteredRooms = roomSearch
                ? adminRooms.filter(r =>
                    r.name.toLowerCase().includes(roomSearch.toLowerCase()) ||
                    r.owner_username.toLowerCase().includes(roomSearch.toLowerCase()))
                : adminRooms;

              return (
                <>
                  <div className={styles.adminStats}>
                    <div className={styles.adminStatCard}>
                      <div className={styles.adminStatValue}>{animUsers}</div>
                      <div className={styles.adminStatLabel}>Пользователей</div>
                    </div>
                    <div className={styles.adminStatCard}>
                      <div className={styles.adminStatValue}>{animRooms}</div>
                      <div className={styles.adminStatLabel}>Комнат</div>
                    </div>
                    <div className={styles.adminStatCard}>
                      <div className={styles.adminStatValue}>{animAdmins}</div>
                      <div className={styles.adminStatLabel}>Администраторов</div>
                    </div>
                    <div className={`${styles.adminStatCard} ${styles.adminStatOnline}`}>
                      <div className={styles.adminStatValue}>
                        <span className={styles.onlineDot} />{animOnline}
                      </div>
                      <div className={styles.adminStatLabel}>Онлайн сейчас</div>
                    </div>
                  </div>

                  <section className={styles.adminSection}>
                    <div className={styles.adminSectionHeader}>
                      <h2 className={styles.sectionTitle}>Пользователи</h2>
                      <span className={styles.adminCount}>{filteredUsers.length} / {adminUsers.length}</span>
                    </div>
                    <input
                      className={styles.adminSearch}
                      placeholder="Поиск по имени или email..."
                      value={userSearch}
                      onChange={e => setUserSearch(e.target.value)}
                    />
                    <div className={styles.adminTable}>
                      <div className={`${styles.adminTableHead} ${styles.adminRowUsers}`}>
                        <span>ID</span>
                        <span>Пользователь</span>
                        <span>Email</span>
                        <span>Роль</span>
                        <span>Действия</span>
                      </div>
                      {filteredUsers.map((u, i) => (
                        <div key={u.id} className={`${styles.adminTableRow} ${styles.adminRowUsers}${!u.is_active ? ` ${styles.adminRowBanned}` : ""}`} style={{ animationDelay: `${i * 45}ms` }}>
                          <span className={styles.adminId}>#{u.id}</span>
                          <span className={styles.adminUserCell}>
                            <span className={styles.adminAvatar}>{u.username.slice(0, 1).toUpperCase()}</span>
                            <span className={styles.adminUsername}>
                              {u.username}
                              {!u.is_active && <span className={styles.badgeBanned}>Бан</span>}
                            </span>
                          </span>
                          <span className={styles.adminEmail}>{u.email}</span>
                          <span>
                            {u.is_superuser
                              ? <span className={styles.badgeAdmin}>Администратор</span>
                              : <span className={styles.badgeUser}>Пользователь</span>
                            }
                          </span>
                          <span className={styles.adminActions}>
                            {u.id === user.id
                              ? <span className={styles.adminSelf}>Вы</span>
                              : <>
                                  {u.is_superuser
                                    ? <button className={styles.btnDemote} onClick={() => handlePromote(u.id, false)}>Разжаловать</button>
                                    : <button className={styles.btnPromote} onClick={() => handlePromote(u.id, true)}>Назначить</button>
                                  }
                                  <button
                                    className={u.is_active ? styles.btnBan : styles.btnUnban}
                                    onClick={() => handleBanUser(u.id, u.is_active)}
                                  >
                                    {u.is_active ? "Бан" : "Разбан"}
                                  </button>
                                  <button className={styles.btnDeleteUser} onClick={() => handleAdminDeleteUser(u.id, u.username)}>
                                    ✕
                                  </button>
                                </>
                            }
                          </span>
                        </div>
                      ))}
                      {filteredUsers.length === 0 && <p className={styles.adminEmpty}>Ничего не найдено</p>}
                    </div>
                  </section>

                  <section className={styles.adminSection}>
                    <div className={styles.adminSectionHeader}>
                      <h2 className={styles.sectionTitle}>Все комнаты</h2>
                      <span className={styles.adminCount}>{filteredRooms.length} / {adminRooms.length}</span>
                    </div>
                    <input
                      className={styles.adminSearch}
                      placeholder="Поиск по названию или владельцу..."
                      value={roomSearch}
                      onChange={e => setRoomSearch(e.target.value)}
                    />
                    <div className={styles.adminTable}>
                      <div className={`${styles.adminTableHead} ${styles.adminRowRooms}`}>
                        <span>ID</span>
                        <span>Название</span>
                        <span>Онлайн</span>
                        <span>Тип</span>
                        <span>Владелец</span>
                        <span>Действия</span>
                      </div>
                      {filteredRooms.map((r, i) => (
                        <div key={r.id} className={`${styles.adminTableRow} ${styles.adminRowRooms}`} style={{ animationDelay: `${i * 45}ms` }}>
                          <span className={styles.adminId}>#{r.id}</span>
                          <span className={styles.adminRoomName}>{r.name}</span>
                          <span className={styles.adminOnlineCell}>
                            {r.online_count > 0
                              ? <><span className={styles.onlineDot} />{r.online_count}</>
                              : <span className={styles.adminDash}>—</span>}
                          </span>
                          <span>
                            {r.type === "public"
                              ? <span className={styles.badgePublic}>Публичная</span>
                              : <span className={styles.badgePrivate}>Приватная</span>
                            }
                          </span>
                          <span className={styles.adminEmail}>@{r.owner_username}</span>
                          <span className={styles.adminActions}>
                            <button className={styles.btnEnter} onClick={() => goTo(`/room/${r.id}`)}>Войти</button>
                            <button className={styles.btnDemote} onClick={() => handleAdminDeleteRoom(r.id)}>Удалить</button>
                          </span>
                        </div>
                      ))}
                      {filteredRooms.length === 0 && <p className={styles.adminEmpty}>Ничего не найдено</p>}
                    </div>
                  </section>
                </>
              );
            })()}
          </div>
        )}
      </main>

      {confirmModal && (
        <div className={styles.modalOverlay} onClick={() => setConfirmModal(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalIcon}>{confirmModal.icon}</div>
            <h3 className={styles.modalTitle}>{confirmModal.title}</h3>
            <p className={styles.modalMessage}>{confirmModal.message}</p>
            <div className={styles.modalActions}>
              <button
                className={styles.btnDanger}
                onClick={() => { confirmModal.onConfirm(); setConfirmModal(null); }}
              >{confirmModal.confirmLabel}</button>
              <button className={styles.modalCancel} onClick={() => setConfirmModal(null)}>Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
