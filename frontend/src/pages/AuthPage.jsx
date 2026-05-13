import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import { useAuthStore } from "../store/auth";
import { useThemeStore } from "../store/theme";
import styles from "./AuthPage.module.css";
import { PRIVACY_TEXT, LICENSE_TEXT } from "../legal";

export default function AuthPage() {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [consent, setConsent] = useState(false);
  const [legalModal, setLegalModal] = useState(null);
  const { login } = useAuthStore();
  const { theme } = useThemeStore();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (mode === "register" && !consent) {
      setError("Необходимо принять лицензионное соглашение и политику обработки персональных данных.");
      return;
    }
    setLoading(true);
    try {
      const url = mode === "login" ? "/auth/login" : "/auth/register";
      const payload = mode === "login"
        ? { username: form.username, password: form.password }
        : { username: form.username, email: form.email, password: form.password };

      const { data } = await api.post(url, payload);
      login(data.access_token, data.user);
      setLeaving(true);
      setTimeout(() => navigate("/"), 220);
    } catch (err) {
      setError(err.response?.data?.detail || "Ошибка. Попробуй снова.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`${styles.wrapper}${leaving ? ` ${styles.wrapperLeave}` : ""}`}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <img
            src={theme === "dark" ? "/logo-dark.png" : "/logo-light.png"}
            alt="Surf Videos"
            className={styles.logoImg}
          />
          <h1 className={styles.logo}>Surf<span> Videos</span></h1>
        </div>
        <p className={styles.subtitle}>Смотри видео вместе с друзьями</p>

        <div className={styles.tabs}>
          <div
            className={styles.tabSlider}
            style={{ transform: mode === "register" ? "translateX(calc(100% + 3px))" : "translateX(0)" }}
          />
          <button
            className={mode === "login" ? styles.tabActive : styles.tab}
            onClick={() => { setMode("login"); setError(""); }}
          >Войти</button>
          <button
            className={mode === "register" ? styles.tabActive : styles.tab}
            onClick={() => { setMode("register"); setError(""); }}
          >Регистрация</button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <input
            className={styles.input}
            placeholder="Имя пользователя"
            value={form.username}
            onChange={e => setForm({ ...form, username: e.target.value })}
            required
          />
          <div className={mode === "register" ? styles.emailField : `${styles.emailField} ${styles.emailFieldHidden}`}>
            <input
              className={styles.input}
              placeholder="Email"
              type="email"
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              required={mode === "register"}
              disabled={mode !== "register"}
              tabIndex={mode === "register" ? undefined : -1}
              style={{ width: "100%", boxSizing: "border-box" }}
            />
          </div>
          <input
            className={styles.input}
            placeholder="Пароль"
            type="password"
            value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
            required
          />
          <div className={mode === "register" ? styles.consentField : `${styles.consentField} ${styles.consentFieldHidden}`}>
            <label className={styles.consentLabel}>
              <input
                type="checkbox"
                className={styles.consentCheck}
                checked={consent}
                onChange={e => setConsent(e.target.checked)}
                disabled={mode !== "register"}
                tabIndex={mode === "register" ? undefined : -1}
              />
              <span className={styles.consentText}>
                Я принимаю{" "}
                <button type="button" className={styles.consentLink} onClick={() => setLegalModal("license")}>
                  Лицензионное соглашение
                </button>
                {" "}и{" "}
                <button type="button" className={styles.consentLink} onClick={() => setLegalModal("privacy")}>
                  Политику обработки персональных данных
                </button>
              </span>
            </label>
          </div>
          {error && <p className={styles.error}>{error}</p>}
          <button className={`${styles.btn} ${styles.btnPulse}`} type="submit" disabled={loading}>
            {loading ? "..." : mode === "login" ? "Войти" : "Зарегистрироваться"}
          </button>
        </form>
      </div>

      {legalModal && (
        <div className={styles.legalOverlay} onClick={() => setLegalModal(null)}>
          <div className={styles.legalModal} onClick={e => e.stopPropagation()}>
            <div className={styles.legalHeader}>
              <h3 className={styles.legalTitle}>
                {legalModal === "license" ? "Лицензионное соглашение" : "Политика обработки персональных данных"}
              </h3>
              <button className={styles.legalClose} onClick={() => setLegalModal(null)}>✕</button>
            </div>
            <pre className={styles.legalBody}>
              {legalModal === "license" ? LICENSE_TEXT : PRIVACY_TEXT}
            </pre>
            <button className={styles.legalAccept} onClick={() => { setConsent(true); setLegalModal(null); }}>
              Принять и закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
