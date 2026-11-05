import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ContextBar } from "./ContextBar";
import { logout } from "../lib/auth";
import { useSession } from "../session/SessionContext";
import { useClientContext } from "../context/ClientContext";
import { Icon } from "../ui/Icon";
import { GuidedTour } from "../ui/GuidedTour";
import {
  STUDY_NAVIGATION_GROUPS,
  modulesForNavigation,
  type StudyModule,
  type StudyNavigationGroup,
} from "../study/moduleRegistry";
import { helpHrefForPath } from "../study/helpAnchors";
import "./StudyShell.css";

const ROLE_LABELS: Record<string, string> = {
  OWNER: "Titular",
  ADMIN: "Administrador",
  ACCOUNTANT: "Contador",
  PREPARER: "Preparador",
  REVIEWER: "Revisor",
  AUDITOR: "Auditor",
};

const NAV_TOUR_IDS: Record<StudyNavigationGroup, string> = {
  General: "nav-general",
  Preparación: "nav-preparacion",
  Ejecución: "nav-ejecucion",
  Análisis: "nav-analisis",
  Configuración: "nav-configuracion",
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

function StudyNavLink({ item }: { item: StudyModule }) {
  return (
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
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  // En escritorio el menú puede superar la altura del viewport: al navegar,
  // el ítem activo (p.ej. la sección Configuración) queda a la vista sin que
  // el pie de Ayuda lo tape. En móvil no aplica (el menú se abre cerrado).
  useEffect(() => {
    const activeLink = navRef.current?.querySelector<HTMLAnchorElement>(
      ".study__nav-link--active",
    );
    activeLink?.scrollIntoView?.({ block: "nearest" });
  }, [location.pathname]);

  const openNavigationForTour = useCallback(() => {
    if (window.matchMedia?.("(max-width: 1024px)").matches) {
      setMenuOpen(true);
    }
  }, []);

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
        <nav className="study__nav" aria-label="Navegación del estudio" ref={navRef}>
          {STUDY_NAVIGATION_GROUPS.map((group) => {
            const items = navigationModules.filter((item) => item.navigationGroup === group);
            if (items.length === 0) return null;
            const admin = group === "Configuración";
            return (
              <div
                className={[
                  "study__nav-group",
                  admin ? "study__nav-group--admin" : "",
                  admin ? "study__nav-group--in-scroll" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={group}
                data-tour={NAV_TOUR_IDS[group]}
              >
                <p className="study__nav-label">{group}</p>
                {items.map((item) => (
                  <StudyNavLink item={item} key={item.id} />
                ))}
              </div>
            );
          })}
        </nav>

        {/* En escritorio la sección Configuración queda fija sobre el pie de
            Ayuda, siempre visible; en móvil se sigue mostrando dentro del
            scroll del menú (misma navegación que antes). */}
        <div className="study__nav-admin" aria-label="Configuración del estudio">
          <p className="study__nav-label">Configuración</p>
          {navigationModules
            .filter((item) => item.navigationGroup === "Configuración")
            .map((item) => (
              <StudyNavLink item={item} key={item.id} />
            ))}
        </div>

        <div className="study__sidebar-footer">
          <a
            className="study__tour-trigger"
            href={helpHrefForPath(location.pathname)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Ayuda paso a paso, se abre en una pestaña nueva"
          >
            <span className="study__tour-trigger-mark" aria-hidden="true">
              <Icon name="file" size={16} />
            </span>
            <span>
              <strong>Ayuda paso a paso</strong>
              <small>Manual del estudio</small>
            </span>
            <Icon name="arrow-right" size={15} />
          </a>
          <GuidedTour onNavigationRequired={openNavigationForTour}>
            {({ startTour }) => (
              <button type="button" className="study__tour-trigger" onClick={startTour}>
                <span className="study__tour-trigger-mark" aria-hidden="true">
                  ?
                </span>
                <span>
                  <strong>Recorrer el estudio</strong>
                  <small>Volver a ver el tour</small>
                </span>
                <Icon name="arrow-right" size={15} />
              </button>
            )}
          </GuidedTour>
          {session.portalContexts.length > 0 ? (
            <NavLink to="/portal" className="study__portal-link" data-tour="portal-link">
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
