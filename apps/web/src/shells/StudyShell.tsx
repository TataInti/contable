import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ContextBar } from "./ContextBar";
import { logout } from "../lib/auth";
import { useSession } from "../session/SessionContext";
import { useClientContext } from "../context/ClientContext";
import { Icon, type IconName } from "../ui/Icon";
import "./StudyShell.css";

interface NavigationItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
  capability?: string;
}

const NAV_GROUPS: { label: string; items: NavigationItem[] }[] = [
  {
    label: "General",
    items: [
      { to: "/", label: "Inicio", icon: "home", end: true },
      { to: "/clientes", label: "Clientes", icon: "users" },
    ],
  },
  {
    label: "Operación",
    items: [
      { to: "/bandeja", label: "Bandeja documental", icon: "inbox" },
      { to: "/trabajo", label: "Trabajo", icon: "tasks" },
      { to: "/liquidaciones", label: "Liquidaciones", icon: "reports", capability: "tax.settlements.read" },
      { to: "/clientes/:clientId/rentabilidad", label: "Rentabilidad", icon: "trending", capability: "profitability.read" },
      { to: "/clientes/:clientId/configuracion-fiscal", label: "Configuración fiscal", icon: "settings", capability: "tax.profile.read" },
    ],
  },
];

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
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter(
              (item) => !item.capability || capabilities.has(item.capability),
            );
            if (items.length === 0) return null;
            return (
              <div className="study__nav-group" key={group.label}>
                <p className="study__nav-label">{group.label}</p>
                {items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
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
          {capabilities.has("firm.manage") ? (
            <div className="study__nav-group study__nav-group--admin">
              <p className="study__nav-label">Configuración</p>
              <NavLink
                to="/administracion"
                className={({ isActive }) =>
                  `study__nav-link${isActive ? " study__nav-link--active" : ""}`
                }
              >
                <Icon name="settings" size={18} />
                <span>Administración</span>
                <Icon name="chevron" size={14} className="study__nav-chevron" />
              </NavLink>
            </div>
          ) : null}
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
