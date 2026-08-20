import { Link, useLocation } from "react-router-dom";
import styles from "./ComercialTabs.module.css";

const TABS = [
  { to: "/comercial/catalogo", label: "Catálogo" },
  { to: "/comercial/agencia", label: "Minha Agência" },
  { to: "/comercial/propostas", label: "Propostas" },
];

export function ComercialTabs() {
  const location = useLocation();
  return (
    <nav className={styles.tabs}>
      {TABS.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          className={`${styles.tab} ${location.pathname.startsWith(tab.to) ? styles.active : ""}`.trim()}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
