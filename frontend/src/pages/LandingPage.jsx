import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useThemeStore } from "../store/theme";
import LegalFooter from "../components/LegalFooter";
import styles from "./LandingPage.module.css";

const STEPS = [
  { icon: "🏄", title: "Создай комнату", desc: "Выбери название, приватность и пригласи друзей по ссылке" },
  { icon: "🎬", title: "Добавь видео", desc: "Вставь ссылку на Rutube — видео попадёт в общую очередь" },
  { icon: "🎉", title: "Смотрите вместе", desc: "Плеер синхронизируется у всех в реальном времени" },
];

const FEATURES = [
  { icon: "⚡", title: "Синхронизация", desc: "Пауза, перемотка и смена видео мгновенно применяются у всех зрителей" },
  { icon: "💬", title: "Чат", desc: "Обсуждайте происходящее не выходя из плеера" },
  { icon: "😄", title: "Реакции", desc: "Летящие эмодзи в нужный момент видео сохраняются в таймлайне" },
  { icon: "📋", title: "Очередь видео", desc: "Добавляйте видео в очередь — никаких споров что смотреть дальше" },
  { icon: "✋", title: "Зал ожидания", desc: "Кнопка «Готов» — все должны подтвердить перед стартом" },
  { icon: "🛡️", title: "Модерация", desc: "Ведущий может замутить или выгнать участника" },
];

// Волны сверху секции (вода «стекает» сверху)
function WaveTop({ fill = "var(--c-wave)" }) {
  return (
    <div className={styles.waveTopWrap}>
      <svg className={styles.waveTopSvg} viewBox="0 0 1440 70" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M0,0 L1440,0 L1440,35 C1260,70 1080,0 900,35 C720,70 540,0 360,35 C180,70 0,0 0,35 Z" fill={fill} />
      </svg>
      <svg className={`${styles.waveTopSvg} ${styles.waveTopSvg2}`} viewBox="0 0 1440 50" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M0,0 L1440,0 L1440,25 C1200,50 960,0 720,25 C480,50 240,0 0,25 Z" fill={fill} opacity="0.45" />
      </svg>
    </div>
  );
}

// Волны снизу секции
function WaveBottom({ fill = "var(--c-wave)" }) {
  return (
    <div className={styles.waveBottomWrap}>
      <svg className={styles.waveBottomSvg} viewBox="0 0 1440 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M0,40 C180,80 360,0 540,40 C720,80 900,0 1080,40 C1260,80 1440,0 1440,40 L1440,80 L0,80 Z" fill={fill} />
      </svg>
      <svg className={`${styles.waveBottomSvg} ${styles.waveBottomSvg2}`} viewBox="0 0 1440 60" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M0,30 C200,60 400,0 600,30 C800,60 1000,0 1200,30 C1320,48 1400,18 1440,30 L1440,60 L0,60 Z" fill={fill} opacity="0.5" />
      </svg>
    </div>
  );
}

function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { el.classList.add(styles.visible); observer.disconnect(); } },
      { threshold: 0.12 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return ref;
}

// Canvas серфер + волны для hero
function HeroCanvas({ theme }) {
  const waveRef   = useRef(null);
  const surferRef = useRef(null);
  const themeRef  = useRef(theme);
  useEffect(() => { themeRef.current = theme; }, [theme]);

  useEffect(() => {
    const wC = waveRef.current;
    const sC = surferRef.current;
    if (!wC || !sC) return;

    const PERIOD = 420, AMP1 = 16, AMP2 = 9;
    const BASE1 = 0.58, BASE2 = 0.74;
    const WAVE_SPEED = 0.6, SURFER_SPEED = 1.4;
    const H = 210;
    let W = 0;
    let waveOffset = 0, surferX = -120;
    let animId;

    // Акула — прыгает один раз через 3с после старта
    const SHARK_DUR = 100;
    let sharkProgress = -1;
    let sharkX = 0;
    const sharkTimer = setTimeout(() => {
      sharkX = W * 0.65;
      sharkProgress = 0;
    }, 3000);

    // Инициализируем размеры один раз
    function applySize() {
      const newW = wC.parentElement?.clientWidth || 0;
      if (newW === W || newW === 0) return;
      W = newW;
      wC.width  = W; wC.height  = H;
      sC.width  = W; sC.height  = H;
    }
    applySize();
    const ro = new ResizeObserver(() => applySize());
    ro.observe(wC.parentElement);

    function waveY(x, offset, amp, base, phase = 0) {
      return H * base - amp * Math.sin((x + offset + phase) * (2 * Math.PI / PERIOD));
    }

    function drawWaves() {
      if (W <= 0) return;
      const ctx = wC.getContext('2d');
      ctx.clearRect(0, 0, W, H);

      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x++) ctx.lineTo(x, waveY(x, waveOffset, AMP1, BASE1));
      ctx.lineTo(W, H); ctx.closePath();
      ctx.fillStyle = '#27374D'; ctx.fill();

      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x++) ctx.lineTo(x, waveY(x, waveOffset * 0.65, AMP2, BASE2, 90));
      ctx.lineTo(W, H); ctx.closePath();
      ctx.fillStyle = '#304560'; ctx.fill();

      ctx.beginPath();
      ctx.moveTo(0, waveY(0, waveOffset, AMP1, BASE1));
      for (let x = 1; x <= W; x++) ctx.lineTo(x, waveY(x, waveOffset, AMP1, BASE1));
      ctx.strokeStyle = 'rgba(157,178,191,0.25)';
      ctx.lineWidth = 1.5; ctx.stroke();
    }

    function drawSurfer(ctx) {
      if (W <= 0) return;
      const sy = waveY(surferX, waveOffset, AMP1, BASE1);
      const dy = waveY(surferX + 1, waveOffset, AMP1, BASE1) - sy;
      const angle = Math.atan2(dy, 1);
      const bodyColor = themeRef.current === 'dark' ? '#EBF1F5' : '#27374D';

      ctx.save();
      ctx.translate(surferX, sy);
      ctx.rotate(angle);

      // Доска (отзеркалена: плавник сзади)
      ctx.save();
      ctx.scale(-1, 1);
      ctx.beginPath();
      ctx.ellipse(0, 0, 46, 7, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#DFA06E'; ctx.fill();
      ctx.beginPath();
      ctx.moveTo(32, 4); ctx.lineTo(42, 16); ctx.lineTo(22, 6);
      ctx.closePath(); ctx.fillStyle = '#C98A56'; ctx.fill();
      ctx.restore();

      const bx = -6, by = -8;
      ctx.lineCap = 'round'; ctx.strokeStyle = bodyColor;

      // Ноги
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(bx - 6, by);
      ctx.quadraticCurveTo(bx - 14, by - 14, bx - 6, by - 26); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx + 4, by);
      ctx.quadraticCurveTo(bx + 14, by - 12, bx + 4, by - 24); ctx.stroke();
      // Туловище
      ctx.beginPath(); ctx.moveTo(bx - 1, by - 24); ctx.lineTo(bx, by - 42); ctx.stroke();
      // Руки
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(bx, by - 36); ctx.lineTo(bx - 22, by - 28); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx, by - 36); ctx.lineTo(bx + 20, by - 42); ctx.stroke();
      // Голова
      ctx.beginPath(); ctx.arc(bx, by - 50, 9, 0, Math.PI * 2);
      ctx.fillStyle = '#DFA06E'; ctx.fill();

      // Брызги (координаты относительно серфера после translate)
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(
          -46 - i * 8 + Math.sin(waveOffset * 0.1 + i) * 3,
          -2 + Math.cos(waveOffset * 0.15 + i) * 3,
          2 + i * 0.8, 0, Math.PI * 2
        );
        ctx.fillStyle = `rgba(157,178,191,${0.5 - i * 0.12})`;
        ctx.fill();
      }
      ctx.restore();
    }

    function drawShark(ctx) {
      if (sharkProgress < 0 || sharkProgress >= SHARK_DUR) return;
      const t = sharkProgress / SHARK_DUR;
      const baseY = waveY(sharkX, waveOffset, AMP1, BASE1);
      const jumpH = 88 * Math.sin(Math.PI * t);
      const sharkY = baseY - jumpH;
      const angle = (0.5 - t) * Math.PI * 0.85;

      ctx.save();
      ctx.translate(sharkX, sharkY);
      ctx.rotate(-angle);

      // Тело
      ctx.beginPath();
      ctx.ellipse(0, 0, 30, 10, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#526D82'; ctx.fill();
      // Брюхо
      ctx.beginPath();
      ctx.ellipse(4, 4, 20, 5, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#9DB2BF'; ctx.fill();
      // Спинной плавник
      ctx.beginPath();
      ctx.moveTo(0, -10); ctx.lineTo(10, -26); ctx.lineTo(18, -10);
      ctx.closePath(); ctx.fillStyle = '#445F7D'; ctx.fill();
      // Боковые плавники
      ctx.beginPath();
      ctx.moveTo(4, 6); ctx.lineTo(16, 18); ctx.lineTo(0, 10);
      ctx.closePath(); ctx.fillStyle = '#445F7D'; ctx.fill();
      // Хвост
      ctx.beginPath();
      ctx.moveTo(-28, 0); ctx.lineTo(-44, -12); ctx.lineTo(-36, 0);
      ctx.lineTo(-44, 12); ctx.closePath();
      ctx.fillStyle = '#526D82'; ctx.fill();
      // Пасть
      ctx.beginPath();
      ctx.moveTo(28, 0); ctx.lineTo(28, 7); ctx.lineTo(18, 5);
      ctx.closePath(); ctx.fillStyle = '#EBF1F5'; ctx.fill();
      // Зубы
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(26 - i * 4, 1);
        ctx.lineTo(24 - i * 4, 5);
        ctx.lineTo(22 - i * 4, 1);
        ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill();
      }
      // Глаз
      ctx.beginPath(); ctx.arc(16, -3, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.beginPath(); ctx.arc(17, -3, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = '#1a2a3a'; ctx.fill();

      ctx.restore();

      // Брызги при приземлении
      if (t > 0.82) {
        const sp = (t - 0.82) / 0.18;
        for (let i = 0; i < 6; i++) {
          const ang = -0.5 + i * 0.2;
          const d = sp * 32;
          ctx.beginPath();
          ctx.arc(
            sharkX + Math.sin(ang) * d,
            baseY - Math.cos(ang) * d * 0.35,
            (1 - sp) * 4, 0, Math.PI * 2
          );
          ctx.fillStyle = `rgba(157,178,191,${0.55 * (1 - sp)})`;
          ctx.fill();
        }
      }
      sharkProgress++;
    }

    function loop() {
      if (W <= 0) { applySize(); animId = requestAnimationFrame(loop); return; }
      waveOffset += WAVE_SPEED;
      surferX += SURFER_SPEED;
      if (surferX > W + 120) surferX = -120;
      drawWaves();
      const ctx = sC.getContext('2d');
      ctx.clearRect(0, 0, W, H);
      drawSurfer(ctx);
      drawShark(ctx);
      animId = requestAnimationFrame(loop);
    }
    animId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animId);
      clearTimeout(sharkTimer);
      ro.disconnect();
    };
  }, []);

  return (
    <div className={styles.heroCanvasWrap}>
      <canvas ref={waveRef}   className={styles.heroWaveCanvas} />
      <canvas ref={surferRef} className={styles.heroSurferCanvas} />
      <div className={styles.heroPlayerBar}>
        <span>⏮</span><span>⏸</span><span>⏭</span>
        <div className={styles.heroProgressWrap}>
          <div className={styles.heroProgressFill} />
        </div>
        <span className={styles.heroTime}>12:34 / 45:00</span>
        <span>🔊</span>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const { theme } = useThemeStore();

  const refSteps    = useReveal();
  const refFeatures = useReveal();
  const refPlatform = useReveal();
  const refCta      = useReveal();

  return (
    <div className={styles.page}>
      {/* Nav */}
      <nav className={styles.nav}>
        <div className={styles.navBrand}>
          <img
            src={theme === "dark" ? "/logo-dark.png" : "/logo-light.png"}
            alt="Surf Videos"
            className={styles.navLogo}
          />
          <span className={styles.navTitle}>Surf <span className={styles.navAccent}>Videos</span></span>
        </div>
        <div className={styles.navActions}>
          <button className={styles.navThemeBtn} onClick={(e) => useThemeStore.getState().toggle(e)} title="Сменить тему">
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <button className={styles.navBtn} onClick={() => navigate("/auth")}>Войти</button>
          <button className={`${styles.navBtn} ${styles.navBtnPrimary}`} onClick={() => navigate("/auth?tab=register")}>
            Начать бесплатно
          </button>
        </div>
      </nav>

      {/* ── Слайд 1: Hero ── */}
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <div className={styles.heroBadge}>🌊 Совместный просмотр</div>
          <h1 className={styles.heroTitle}>
            Смотрите видео<br />
            <span className={styles.heroAccent}>вместе с друзьями</span>
          </h1>
          <p className={styles.heroSub}>
            Создайте комнату, пригласите друзей и наслаждайтесь<br />
            синхронным просмотром видео с Rutube
          </p>
          <div className={styles.heroCta}>
            <button className={styles.ctaPrimary} onClick={() => navigate("/auth?tab=register")}>
              Создать комнату
            </button>
            <button className={styles.ctaSecondary} onClick={() => navigate("/auth")}>
              Уже есть аккаунт →
            </button>
          </div>
        </div>
        <HeroCanvas theme={theme} />
      </section>

      {/* ── Слайд 2: Возможности ── */}
      <section className={`${styles.section} ${styles.sectionAlt}`}>
        <WaveTop />
        <div ref={refFeatures} className={`${styles.container} ${styles.reveal}`}>
          <p className={styles.sectionLabel}>Возможности</p>
          <h2 className={styles.sectionTitle}>Всё для комфортного просмотра</h2>
          <div className={styles.features}>
            {FEATURES.map((f, i) => (
              <div key={i} className={styles.featureCard} style={{ transitionDelay: `${i * 60}ms` }}>
                <span className={styles.featureIcon}>{f.icon}</span>
                <h3 className={styles.featureTitle}>{f.title}</h3>
                <p className={styles.featureDesc}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
        <WaveBottom />
      </section>

      {/* ── Слайд 3: Как это работает ── */}
      <section className={`${styles.section} ${styles.sectionSteps}`}>
        <WaveTop />
        <div ref={refSteps} className={`${styles.container} ${styles.reveal}`}>
          <p className={styles.sectionLabel}>Как это работает</p>
          <h2 className={styles.sectionTitle}>Три шага до совместного просмотра</h2>
          <div className={styles.steps}>
            {STEPS.map((s, i) => (
              <div key={i} className={styles.stepCard} style={{ transitionDelay: `${i * 80}ms` }}>
                <div className={styles.stepNumber}>{i + 1}</div>
                <div className={styles.stepIcon}>{s.icon}</div>
                <h3 className={styles.stepTitle}>{s.title}</h3>
                <p className={styles.stepDesc}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
        <WaveBottom />
      </section>

      {/* ── Слайд 4: Платформа ── */}
      <section className={styles.section}>
        <WaveTop />
        <div ref={refPlatform} className={`${styles.container} ${styles.reveal}`}>
          <div className={styles.platformLayout}>
            <div className={styles.platformInfo}>
              <p className={styles.sectionLabel}>Платформа</p>
              <h2 className={styles.platformHeading}>Работает с Rutube</h2>
              <p className={styles.platformDesc}>
                Вставьте ссылку на любое видео — плеер загрузится прямо в комнате и синхронизируется у всех участников
              </p>
              <div className={styles.platformUrlDemo}>
                <span className={styles.platformUrlIcon}>🔗</span>
                <span className={styles.platformUrlText}>rutube.ru/video/...</span>
              </div>
              <button className={styles.ctaPrimary} onClick={() => navigate("/auth?tab=register")}>
                Попробовать
              </button>
            </div>
            <div className={styles.playerMockup}>
              <div className={styles.playerScreen}>
                <div className={styles.playerPlayBtn}>▶</div>
                <div className={styles.playerTitle}>Видео с Rutube</div>
              </div>
              <div className={styles.playerBar}>
                <div className={styles.playerProgress}><div className={styles.playerProgressFill} /></div>
                <div className={styles.playerControls}>
                  <span>⏮</span><span>⏸</span><span>⏭</span>
                  <div className={styles.playerTime}>12:34 / 45:00</div>
                  <span className={styles.playerVolume}>🔊</span>
                </div>
              </div>
              <div className={styles.playerUsers}>
                {["А", "М", "К", "Е"].map((u, i) => (
                  <div key={i} className={styles.playerAvatar}>{u}</div>
                ))}
                <span className={styles.playerOnline}>4 смотрят</span>
              </div>
            </div>
          </div>
        </div>
        <WaveBottom />
      </section>

      {/* ── Слайд 5: CTA ── */}
      <section className={`${styles.section} ${styles.sectionCta}`}>
        <WaveTop />
        <div ref={refCta} className={`${styles.container} ${styles.reveal}`}>
          <h2 className={styles.ctaTitle}>Готовы смотреть вместе?</h2>
          <div className={styles.ctaCards}>
            <div className={styles.ctaCard}>
              <span className={styles.ctaCardIcon}>🆓</span>
              <span className={styles.ctaCardText}>Бесплатно</span>
              <span className={styles.ctaCardSub}>навсегда</span>
            </div>
            <div className={styles.ctaCard}>
              <span className={styles.ctaCardIcon}>🌐</span>
              <span className={styles.ctaCardText}>В браузере</span>
              <span className={styles.ctaCardSub}>без установки</span>
            </div>
            <div className={styles.ctaCard}>
              <span className={styles.ctaCardIcon}>👥</span>
              <span className={styles.ctaCardText}>До 50 чел.</span>
              <span className={styles.ctaCardSub}>в комнате</span>
            </div>
          </div>
          <button className={styles.ctaPrimary} onClick={() => navigate("/auth?tab=register")}>
            Создать аккаунт
          </button>
        </div>
      </section>

      {/* Footer */}
      <div className={styles.footerSlide}>
        <LegalFooter />
      </div>
    </div>
  );
}
