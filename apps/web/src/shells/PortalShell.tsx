import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ContextBar } from "./ContextBar";
import { useClientContext } from "../context/ClientContext";
import { useSession } from "../session/SessionContext";
import { logout } from "../lib/auth";
import { Icon, type IconName } from "../ui/Icon";
import "./PortalShell.css";

const NAV_ITEMS: {
  to: string;
  label: string;
  shortLabel: string;
  icon: IconName;
  end?: boolean;
}[] = [
  { to: "/portal", label: "Inicio", shortLabel: "Inicio", icon: "home", end: true },
  { to: "/portal/pendientes", label: "Pendientes", shortLabel: "Pendientes", icon: "tasks" },
  { to: "/portal/upload", label: "Subir documentos", shortLabel: "Subir", icon: "upload" },
  { to: "/portal/impuestos", label: "Impuestos", shortLabel: "Impuestos", icon: "calendar" },
  { to: "/portal/liquidaciones", label: "Liquidaciones", shortLabel: "Liquidaciones", icon: "reports" },
  { to: "/portal/rentabilidad", label: "Rentabilidad", shortLabel: "Rentabilidad", icon: "trending" },
  { to: "/portal/reportes", label: "Estados y reportes", shortLabel: "Reportes", icon: "reports" },
  { to: "/portal/mensajes", label: "Mensajes", shortLabel: "Mensajes", icon: "message" },
  { to: "/portal/perfil", label: "Perfil", shortLabel: "Perfil", icon: "users" },
];

export function PortalShell() {
  const { me, portalContexts } = useSession();
  const { firmId, capabilities } = useClientContext();
  const navigate = useNavigate();
  const location = useLocation();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const firmName =
    portalContexts.find((context) => context.firmId === firmId)?.firmName ??
    portalContexts[0]?.firmName ??
    "Tu estudio";

  // G0-05 + G5: READONLY no ve Subir documentos ni Mensajes (PLAN §4.2).
  const navItems = NAV_ITEMS.filter((item) => {
    if (item.to === "/portal/upload") return capabilities.has("portal.documents.upload");
    if (item.to === "/portal/mensajes") return capabilities.has("message.shared");
    return true;
  });

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeMenu, menuOpen]);

  const signOut = () => {
    setSigningOut(true);
    void logout().finally(() => navigate("/login", { replace: true }));
  };

  return (
    <div className="portal">
      <a className="skip-link" href="#portal-content">
        Saltar al contenido
      </a>
      <header className="portal__header">
        <div className="portal__header-inner">
          <Link className="portal__brand" to="/portal" aria-label="Ir al inicio del portal">
            <span className="portal__brand-mark" aria-hidden="true">
              C
            </span>
            <span className="portal__brand-copy">
              <strong>Portal contable</strong>
              <small>{firmName}</small>
            </span>
          </Link>

          <nav
            className={`portal__nav${menuOpen ? " portal__nav--open" : ""}`}
            id="portal-navigation"
            aria-label="Navegación del portal"
          >
            <div className="portal__nav-heading">
              <span>Menú</span>
              <button
                ref={closeButtonRef}
                className="portal__nav-close"
                type="button"
                onClick={closeMenu}
                aria-label="Cerrar menú"
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="portal__nav-links">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  aria-label={item.label}
                  onClick={() => {
                    if (menuOpen) closeMenu();
                  }}
                  className={({ isActive }) =>
                    `portal__nav-link${isActive ? " portal__nav-link--active" : ""}`
                  }
                >
                  <Icon name={item.icon} size={18} />
                  <span className="portal__nav-label">{item.label}</span>
                  <span className="portal__nav-short-label" aria-hidden="true">
                    {item.shortLabel}
                  </span>
                </NavLink>
              ))}
            </div>
            <div className="portal__nav-actions">
              {(me?.firms.length ?? 0) > 0 ? (
                <NavLink to="/" className="portal__study-link">
                  <Icon name="briefcase" size={18} />
                  <span>Ir al estudio</span>
                </NavLink>
              ) : null}
              <button
                className="portal__logout"
                type="button"
                onClick={signOut}
                disabled={signingOut}
              >
                <Icon name="logout" size={18} />
                <span>{signingOut ? "Saliendo…" : "Salir"}</span>
              </button>
            </div>
          </nav>

          <button
            ref={menuButtonRef}
            className="portal__menu-button"
            type="button"
            aria-label="Abrir menú"
            aria-controls="portal-navigation"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <Icon name="menu" />
          </button>
        </div>
      </header>
      {menuOpen ? (
        <button
          className="portal__backdrop"
          type="button"
          onClick={closeMenu}
          aria-label="Cerrar menú"
        />
      ) : null}
      <ContextBar />
      <main className="portal__content" id="portal-content">
        <Outlet />
      </main>
    </div>
  );
}
