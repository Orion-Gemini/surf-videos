import { useState } from "react";
import { PRIVACY_TEXT, LICENSE_TEXT } from "../legal";
import styles from "./LegalFooter.module.css";

export default function LegalFooter() {
  const [modal, setModal] = useState(null); // "privacy" | "license" | null

  return (
    <>
      <footer className={styles.footer}>
        <span className={styles.footerText}>© 2025 Surf Videos</span>
        <span className={styles.footerDot}>·</span>
        <button className={styles.footerLink} onClick={() => setModal("privacy")}>
          Политика персональных данных
        </button>
        <span className={styles.footerDot}>·</span>
        <button className={styles.footerLink} onClick={() => setModal("license")}>
          Лицензионное соглашение
        </button>
      </footer>

      {modal && (
        <div className={styles.overlay} onClick={() => setModal(null)}>
          <div className={styles.modalBox} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>
                {modal === "license" ? "Лицензионное соглашение" : "Политика обработки персональных данных"}
              </h3>
              <button className={styles.modalClose} onClick={() => setModal(null)}>✕</button>
            </div>
            <pre className={styles.modalBody}>
              {modal === "license" ? LICENSE_TEXT : PRIVACY_TEXT}
            </pre>
            <button className={styles.modalDone} onClick={() => setModal(null)}>Закрыть</button>
          </div>
        </div>
      )}
    </>
  );
}
