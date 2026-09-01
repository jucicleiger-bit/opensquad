import { Link, Outlet } from "react-router-dom";
import styles from "./RootLayout.module.css";

export function RootLayout() {
  return (
    <div>
      <header className={styles.topbar}>
        <Link to="/" className={styles.brand}>
          <div className={styles.brandMark}>CC</div>
          <span className={styles.brandName}>Central de Conteúdo</span>
        </Link>
        <div style={{ marginLeft: "auto" }}>
          <Link to="/conta" className="muted" style={{ fontSize: 13 }}>
            Conta / MFA
          </Link>
        </div>
      </header>
      <div className={styles.content}>
        <Outlet />
      </div>
    </div>
  );
}
