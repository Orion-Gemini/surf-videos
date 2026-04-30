import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import { useAuthStore } from "../store/auth";
import { useThemeStore } from "../store/theme";
import styles from "./ProfilePage.module.css";

export default function ProfilePage() {
  const { user, logout } = useAuthStore();
  const { theme, toggle } = useThemeStore();
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState("");

  const [showPassForm, setShowPassForm] = useState(false);
  const [passForm, setPassForm] = useState({ old_password: "", new_password: "", confirm: "" });
  const [passError, setPassError] = useState("");
  const [passSuccess, setPassSuccess] = useState("");
  const [passLoading, setPassLoading] = useState(false);

  function goTo(path) {
    setLeaving(true);
    setTimeout(() => navigate(path), 220);
  }

  useEffect(() => {
    let mounted = true;
    api.get("/users/me")
      .then(({ data }) => { if (mounted) setProfile(data); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  async function handlePasswordChange(e) {
    e.preventDefault();
    setPassError("");
    setPassSuccess("");
    if (passForm.new_password !== passForm.confirm) {
      setPassError("Пароли не совпадают");
      return;
    }
    setPassLoading(true);
    try {
      await api.patch("/users/me/password", {
        old_password: passForm.old_password,
        new_password: passForm.new_password,
      });
      setPassSuccess("Пароль успешно изменён");
      setPassForm({ old_password: "", new_password: "", confirm: "" });
      setShowPassForm(false);
    } catch (err) {
      setPassError(err.response?.data?.detail || "Ошибка");
    } finally {
      setPassLoading(false);
    }
  }

  function resizeToBase64(file, size = 128) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          const min = Math.min(img.width, img.height);
          const sx = (img.width - min) / 2;
          const sy = (img.height - min) / 2;
          ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL("image/jpeg", 0.85));
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Не удалось прочитать изображение"));
      };
      img.src = url;
    });
  }

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    setAvatarError("");
    try {
      const base64 = await resizeToBase64(file);
      await api.post("/users/me/avatar", { avatar: base64 });
      setProfile(prev => ({ ...prev, avatar: base64 }));
    } catch (err) {
      setAvatarError(err.response?.data?.detail || err.message || "Ошибка загрузки");
    } finally {
      setAvatarUploading(false);
      e.target.value = "";
    }
  }

  function handleLogout() {
    logout();
    goTo("/auth");
  }

  const initials = user?.username?.slice(0, 2).toUpperCase() || "??";

  const formatDate = (iso) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  };

  return (
    <div className={`${styles.page}${leaving ? ` ${styles.pageFadeOut}` : ""}`}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => goTo("/")}>← Лобби</button>
        <span className={styles.headerTitle}>Профиль</span>
        <div className={styles.headerRight}>
          <button className={styles.btnTheme} onClick={(e) => toggle(e)} title="Сменить тему">
            {theme === "dark" ? "☀" : "🌙"}
          </button>
        </div>
      </header>

      <main className={styles.main}>
        {loading ? (
          <p className={styles.hint}>Загрузка...</p>
        ) : (
          <>
            {/* Карточка пользователя */}
            <div className={styles.card}>
              <label className={styles.avatarWrap} title="Сменить аватар">
                <input
                  type="file"
                  accept="image/*"
                  className={styles.avatarInput}
                  onChange={handleAvatarChange}
                />
                {profile?.avatar ? (
                  <img src={profile.avatar} className={styles.avatarImg} alt="avatar" />
                ) : (
                  <div className={styles.avatar}>{initials}</div>
                )}
                <div className={styles.avatarOverlay}>
                  {avatarUploading ? "..." : "📷"}
                </div>
              </label>
              {avatarError && <p className={styles.error}>{avatarError}</p>}
              <div className={styles.userInfo}>
                <div className={styles.usernameRow}>
                  <h2 className={styles.username}>{profile?.username}</h2>
                  {profile?.is_superuser && (
                    <span className={styles.badgeAdmin}>Администратор</span>
                  )}
                </div>
                <p className={styles.email}>{profile?.email}</p>
                <p className={styles.since}>На платформе с {formatDate(profile?.created_at)}</p>
              </div>
            </div>

            {/* Статистика */}
            <div className={styles.statsRow}>
              <div className={styles.statCard}>
                <span className={styles.statNumber}>{profile?.rooms_created ?? "—"}</span>
                <span className={styles.statLabel}>комнат создано</span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.statNumber}>{profile?.rooms_joined ?? "—"}</span>
                <span className={styles.statLabel}>комнат посещено</span>
              </div>
            </div>

            {/* Смена пароля */}
            <div className={styles.section}>
              <button
                className={styles.sectionToggle}
                onClick={() => { setShowPassForm(v => !v); setPassError(""); setPassSuccess(""); }}
              >
                <span>Сменить пароль</span>
                <span className={styles.toggleIcon}>{showPassForm ? "▲" : "▼"}</span>
              </button>

              {showPassForm && (
                <form className={styles.passForm} onSubmit={handlePasswordChange}>
                  <input
                    className={styles.input}
                    type="password"
                    placeholder="Текущий пароль"
                    value={passForm.old_password}
                    onChange={e => setPassForm({ ...passForm, old_password: e.target.value })}
                    required
                  />
                  <input
                    className={styles.input}
                    type="password"
                    placeholder="Новый пароль"
                    value={passForm.new_password}
                    onChange={e => setPassForm({ ...passForm, new_password: e.target.value })}
                    required
                  />
                  <input
                    className={styles.input}
                    type="password"
                    placeholder="Повторите новый пароль"
                    value={passForm.confirm}
                    onChange={e => setPassForm({ ...passForm, confirm: e.target.value })}
                    required
                  />
                  {passError && <p className={styles.error}>{passError}</p>}
                  {passSuccess && <p className={styles.success}>{passSuccess}</p>}
                  <button className={styles.btn} type="submit" disabled={passLoading}>
                    {passLoading ? "..." : "Сохранить"}
                  </button>
                </form>
              )}
            </div>

            {/* Выход */}
            <button className={styles.btnLogout} onClick={handleLogout}>
              Выйти из аккаунта
            </button>
          </>
        )}
      </main>
    </div>
  );
}
