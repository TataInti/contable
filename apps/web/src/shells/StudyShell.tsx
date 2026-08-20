import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ContextBar } from "./ContextBar";
import { logout } from "../lib/auth";
import { useSession } from "../session/SessionContext";
import { useClientContext } from "../context/ClientContext";
import { Icon } from "../ui/Icon";
import { STUDY_NAVIGATION_GROUPS, modulesForNavigation } from "../study/moduleRegistry";
import "./StudyShell.css";

const ROLE_LABELS: Record<string, string> = {
  OWNER: "Titular",
  ADMIN: "Administrador",
  ACCOUNTANT: "Contador",
  PREPARER: "Preparador",
  REVIEWER: "Revisor",
  AUDITOR: "Auditor",
};

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`study__brand${compact ? " study__brand--compact" : ""}`} aria-label="Contable">
      <span className="study__brand-mark" aria-hidden="true">
        C
      </span>
      <span className="study__brand-copy">
        <span className="study__brand-name">Contable</span>
        {!compact ? <span className="study__brand-tag">Gestión del estudio</span> : null}
      </span>
    </div>
  );
}

export function StudyShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const session = useSession();
  const { firmId, capabilities } = useClientContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const firm = session.me?.firms.find((item) => item.firmId === firmId);
  const navigationModules = modulesForNavigation(capabilities);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  const signOut = () => void logout().finally(() => navigate("/login", { replace: true }));

  return (
    <div className="study" data-menu-open={menuOpen || undefined}>
      <a className="skip-link" href="#main-content">
        Saltar al contenido
      </a>

      <header className="study__mobile-header">
        <Brand compact />
        <button
          type="button"
          className="study__menu-button"
          aria-label={menuOpen ? "Cerrar navegación" : "Abrir navegación"}
          aria-expanded={menuOpen}
          aria-controls="study-navigation"
          onClick={() => setMenuOpen((current) => !current)}
        >
          <Icon name={menuOpen ? "close" : "menu"} size={21} />
        </button>
      </header>

      {menuOpen ? (
        <button
          type="button"
          className="study__scrim"
          aria-label="Cerrar navegación"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <aside className="study__sidebar" id="study-navigation">
        <Brand />
        <nav className="study__nav" aria-label="Navegación del estudio">
          {STUDY_NAVIGATION_GROUPS.map((group) => {
            const items = navigationModules.filter((item) => item.navigationGroup === group);
            if (items.length === 0) return null;
            return (
              <div
                className={`study__nav-group${group === "Configuración" ? " study__nav-group--admin" : ""}`}
                key={group}
              >
                <p className="study__nav-label">{group}</p>
                {items.map((item) => (
                  <NavLink
                    key={item.id}
                    to={item.path}
                    end={item.end}
                    className={({ isActive }) =>
                      `study__nav-link${isActive ? " study__nav-link--active" : ""}`
                    }
                  >
                    <Icon name={item.icon} size={18} />
                    <span>{item.label}</span>
                    <Icon name="chevron" size={14} className="study__nav-chevron" />
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="study__sidebar-footer">
          {session.portalContexts.length > 0 ? (
            <NavLink to="/portal" className="study__portal-link">
              <span className="study__portal-icon">
                <Icon name="portal" size={17} />
              </span>
              <span>
                <strong>Portal del cliente</strong>
                <small>Cambiar de espacio</small>
              </span>
              <Icon name="arrow-right" size={15} />
            </NavLink>
          ) : null}
          <div className="study__account">
            <span className="study__account-avatar" aria-hidden="true">
              {firm?.firmName.slice(0, 1).toLocaleUpperCase("es-AR") ?? "C"}
            </span>
            <span className="study__account-copy">
              <strong>{firm?.firmName ?? "Estudio contable"}</strong>
              <small>{ROLE_LABELS[firm?.role ?? ""] ?? firm?.role ?? "Sesión segura"}</small>
            </span>
            <button
              type="button"
              className="study__logout"
              onClick={signOut}
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
            >
              <Icon name="logout" size={18} />
            </button>
          </div>
        </div>
      </aside>

      <div className="study__main">
        <ContextBar />
        <main className="study__content" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
