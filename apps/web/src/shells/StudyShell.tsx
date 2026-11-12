import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@contable/design-system";
import { ContextBar } from "./ContextBar";
import { logout } from "../lib/auth";
import { useSession } from "../session/SessionContext";
import { useClientContext } from "../context/ClientContext";
import { Icon } from "../ui/Icon";
import { GuidedTour } from "../ui/GuidedTour";
import {
  modulesForNavigation,
  type StudyModule,
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

const NAV_ITEM_TOUR_IDS: Partial<Record<StudyModule["id"], string>> = {
  bandeja: "nav-preparacion",
  trabajo: "nav-ejecucion",
  rentabilidad: "nav-analisis",
};

const STUDY_NAVIGATION_IDS = [
  "inicio",
  "clientes",
  "bandeja",
  "trabajo",
  "liquidaciones",
  "expediente-mensual",
  "rentabilidad",
] as const;
const CLIENT_NAVIGATION_IDS = ["configuracion-fiscal"] as const;
const STUDY_SETTINGS_NAVIGATION_IDS = [
  "usuarios",
  "administracion-plataforma",
  "reglas-fiscales",
  "catalogos-fiscales",
] as const;
const STUDY_SETTINGS_PATHS = new Set([
  "/administracion",
  "/administracion-plataforma",
  "/reglas-fiscales",
  "/catalogos-fiscales",
]);

const CLIENT_INDEPENDENT_SECTIONS = new Set([
  "/catalogos-fiscales",
  "/reglas-fiscales",
  "/administracion",
  "/administracion-plataforma",
]);

function modulesInOrder(modules: readonly StudyModule[], ids: readonly string[]) {
  const modulesById = new Map(modules.map((module) => [module.id, module]));
  return ids.flatMap((id) => {
    const module = modulesById.get(id);
    return module ? [module] : [];
  });
}

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
      data-tour={NAV_ITEM_TOUR_IDS[item.id]}
      className={({ isActive }) =>
        `study__nav-link${isActive ? " study__nav-link--active" : ""}`
      }
    >
      <span>{item.label}</span>
    </NavLink>
  );
}

export function StudyShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const session = useSession();
  const { firmId, clientId, capabilities } = useClientContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(() =>
    STUDY_SETTINGS_PATHS.has(location.pathname),
  );
  const firm = session.me?.firms.find((item) => item.firmId === firmId);
  const selectedClient = firm?.clients.find((item) => item.clientId === clientId);
  const navigationModules = modulesForNavigation(capabilities);
  const studyModules = modulesInOrder(navigationModules, STUDY_NAVIGATION_IDS);
  const clientModules = modulesInOrder(navigationModules, CLIENT_NAVIGATION_IDS);
  const settingsModules = modulesInOrder(navigationModules, STUDY_SETTINGS_NAVIGATION_IDS);
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMenuOpen(false);
    if (STUDY_SETTINGS_PATHS.has(location.pathname)) setSettingsOpen(true);
  }, [location.pathname]);

  // En escritorio el menú puede superar la altura del viewport: al navegar,
  // el ítem activo (p.ej. Ajustes del estudio) queda a la vista sin que
  // el pie de Ayuda lo tape. En móvil no aplica (el menú se abre cerrado).
  useEffect(() => {
    const activeLink = navRef.current?.querySelector<HTMLAnchorElement>(
      ".study__nav-link--active",
    );
    activeLink?.scrollIntoView?.({ block: "nearest" });
  }, [location.pathname, settingsOpen]);

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
        <Button
          type="button"
          className="study__menu-button"
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={menuOpen ? "Cerrar navegación" : "Abrir navegación"}
          aria-expanded={menuOpen}
          aria-controls="study-navigation"
          onClick={() => setMenuOpen((current) => !current)}
        >
          <Icon name={menuOpen ? "close" : "menu"} size={21} />
        </Button>
      </header>

      {menuOpen ? (
        <Button
          type="button"
          className="study__scrim"
          variant="ghost"
          iconOnly
          aria-label="Cerrar navegación"
          onClick={() => setMenuOpen(false)}
        >
          <span aria-hidden="true" />
        </Button>
      ) : null}

      <aside className="study__sidebar" id="study-navigation">
        <Brand />
        <nav className="study__nav" aria-label="Navegación del estudio" ref={navRef}>
          <div className="study__scope-line">
            <span>En contexto</span>
            <strong>{selectedClient?.clientName ?? "Sin elegir"}</strong>
          </div>

          <div
            className="study__nav-group"
            role="group"
            aria-labelledby="study-navigation-study-label"
            data-tour="nav-general"
          >
            <p className="study__nav-label" id="study-navigation-study-label">
              Estudio
            </p>
            {studyModules.map((item) => (
              <StudyNavLink item={item} key={item.id} />
            ))}
          </div>

          <div
            className="study__nav-group"
            role="group"
            aria-labelledby="study-navigation-client-label"
          >
            <p className="study__nav-label" id="study-navigation-client-label">
              Del cliente
            </p>
            {clientId ? (
              clientModules.map((item) => <StudyNavLink item={item} key={item.id} />)
            ) : (
              <div className="study__client-empty">
                <strong>Elegí un cliente</strong>
                {capabilities.has("client.read") ? (
                  <NavLink to="/clientes">Elegir cliente</NavLink>
                ) : null}
              </div>
            )}
          </div>

          {settingsModules.length > 0 ? (
            <div
              className="study__nav-group"
              role="group"
              aria-labelledby="study-navigation-settings-label"
            >
              <Button
                type="button"
                className="study__nav-toggle"
                variant="ghost"
                id="study-navigation-settings-label"
                aria-expanded={settingsOpen}
                aria-controls="study-settings-items"
                data-tour="nav-configuracion"
                onClick={() => setSettingsOpen((current) => !current)}
              >
                <span>Ajustes del estudio</span>
                <span className="study__settings-chevron" aria-hidden="true">
                  ▾
                </span>
              </Button>
              <div id="study-settings-items" hidden={!settingsOpen}>
                {settingsModules.map((item) => (
                  <StudyNavLink item={item} key={item.id} />
                ))}
              </div>
            </div>
          ) : null}
        </nav>

        <div className="study__sidebar-footer">
          <details className="study__help">
            <summary className="study__tour-trigger">
              <span className="study__tour-trigger-mark" aria-hidden="true">
                ?
              </span>
              <strong>Ayuda y tour</strong>
              <Icon name="chevron" size={15} className="study__help-chevron" />
            </summary>
            <div className="study__help-menu">
              <a
                className="study__help-action"
                href={helpHrefForPath(location.pathname)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Ayuda paso a paso
              </a>
              <GuidedTour onNavigationRequired={openNavigationForTour}>
                {({ startTour }) => (
                  <Button type="button" className="study__help-action" variant="ghost" size="row" onClick={startTour}>
                    Recorrer el estudio
                  </Button>
                )}
              </GuidedTour>
            </div>
          </details>
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
            <Button
              type="button"
              className="study__logout"
              variant="ghost"
              size="row"
              onClick={signOut}
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
            >
              Salir
            </Button>
          </div>
        </div>
      </aside>

      <div className="study__main">
        {CLIENT_INDEPENDENT_SECTIONS.has(location.pathname) ? null : <ContextBar />}
        <main className="study__content" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
