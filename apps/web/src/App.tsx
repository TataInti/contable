import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { Button, ToastProvider } from "@contable/design-system";
import { ClientContextProvider } from "./context/ClientContext";
import { SessionProvider, useSession } from "./session/SessionContext";
import { StudyShell } from "./shells/StudyShell";
import { PortalShell } from "./shells/PortalShell";
import { LoginPage } from "./auth/LoginPage";
import { ChangePasswordPage } from "./auth/ChangePasswordPage";
import { AcceptPortalInvitation } from "./auth/AcceptPortalInvitation";
import { RecoverAccessPage } from "./auth/RecoverAccessPage";
import { logout } from "./lib/auth";
import { EnvironmentStatusBanner } from "./environment/EnvironmentStatusBanner";
import { Icon } from "./ui/Icon";
import { STUDY_MODULES, type StudyModule } from "./study/moduleRegistry";
import {
  LegacyClientModuleRoute,
  PortalNotFound,
  StudyModuleGuard,
  StudyNotFound,
} from "./study/StudyRouteStates";
import "./App.css";

const PortalDashboard = lazy(() =>
  import("./portal/PortalDashboard").then((m) => ({ default: m.PortalDashboard })),
);
const PortalPendientes = lazy(() =>
  import("./portal/PortalPendientes").then((m) => ({ default: m.PortalPendientes })),
);
const PortalUpload = lazy(() =>
  import("./portal/PortalUpload").then((m) => ({ default: m.PortalUpload })),
);
const PortalObligaciones = lazy(() =>
  import("./portal/PortalObligaciones").then((m) => ({ default: m.PortalObligaciones })),
);

const PortalLiquidaciones = lazy(() =>
  import("./portal/PortalLiquidaciones").then((m) => ({ default: m.PortalLiquidaciones })),
);
const PortalRentabilidad = lazy(() =>
  import("./portal/PortalRentabilidad").then((m) => ({ default: m.PortalRentabilidad })),
);
const PortalReportes = lazy(() =>
  import("./portal/PortalReportes").then((m) => ({ default: m.PortalReportes })),
);
const PortalMensajes = lazy(() =>
  import("./portal/PortalMensajes").then((m) => ({ default: m.PortalMensajes })),
);
const PortalPerfil = lazy(() =>
  import("./portal/PortalPerfil").then((m) => ({ default: m.PortalPerfil })),
);
const StudyAyuda = lazy(() =>
  import("./study/StudyAyuda").then((m) => ({ default: m.StudyAyuda })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

function LoadingScreen() {
  return (
    <div className="app-loading" role="status" aria-live="polite">
      <span className="app-loading__mark" aria-hidden="true">
        C
      </span>
      <span className="app-loading__indicator" aria-hidden="true" />
      <span>Cargando tu espacio de trabajo…</span>
    </div>
  );
}

function SessionUnavailable() {
  const session = useSession();
  return (
    <main className="no-workspace">
      <div className="no-workspace__mark" aria-hidden="true">
        <Icon name="alert" size={28} />
      </div>
      <p className="no-workspace__eyebrow">Conexión no disponible</p>
      <h1>No pudimos validar tu sesión</h1>
      <p>
        {session.error?.message ??
          "La conexión con el servidor no está disponible en este momento. Tu sesión no fue cerrada."}
      </p>
      <div className="no-workspace__actions">
        <Button variant="secondary" onClick={() => void session.refresh().catch(() => undefined)}>
          Reintentar
        </Button>
      </div>
    </main>
  );
}

function Protected({ portal = false }: { portal?: boolean }) {
  const session = useSession();
  const location = useLocation();
  if (session.status === "loading") return <LoadingScreen />;
  if (session.status === "unavailable") return <SessionUnavailable />;
  if (session.status === "unauthenticated") {
    const from = `${location.pathname}${location.search}${location.hash}`;
    const safeFrom = from.startsWith("/") && !from.startsWith("//") ? from : "/";
    return <Navigate to="/login" replace state={{ from: safeFrom }} />;
  }
  if (session.me?.mustChangePassword) return <Navigate to="/cambiar-contrasena" replace />;
  if (portal && session.portalContexts.length === 0) {
    return <Navigate to={(session.me?.firms.length ?? 0) > 0 ? "/" : "/sin-acceso"} replace />;
  }
  if (!portal && (session.me?.firms.length ?? 0) === 0) {
    return <Navigate to={session.portalContexts.length > 0 ? "/portal" : "/sin-acceso"} replace />;
  }
  return <Outlet />;
}

function StudyModuleRoute({ module }: { module: StudyModule }) {
  const Component = module.component;
  return (
    <StudyModuleGuard module={module}>
      <Component />
    </StudyModuleGuard>
  );
}

function NoWorkspace() {
  const session = useSession();
  if (session.status === "loading") return <LoadingScreen />;
  if (session.status === "unavailable") return <SessionUnavailable />;
  if (session.status === "unauthenticated") return <Navigate to="/login" replace />;
  if (session.me?.mustChangePassword) return <Navigate to="/cambiar-contrasena" replace />;
  if ((session.me?.firms.length ?? 0) > 0) return <Navigate to="/" replace />;
  if (session.portalContexts.length > 0) return <Navigate to="/portal" replace />;

  return (
    <main className="no-workspace">
      <div className="no-workspace__mark" aria-hidden="true">
        <Icon name="building" size={28} />
      </div>
      <p className="no-workspace__eyebrow">Cuenta activa</p>
      <h1>Todavía no tenés un espacio asignado</h1>
      <p>
        Tu acceso está listo, pero aún no pertenece a un estudio ni a una empresa del portal. Pedile
        a un administrador que complete la asignación.
      </p>
      <div className="no-workspace__actions">
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Volver a comprobar
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            void logout().then(() => {
              window.location.href = "/login";
            })
          }
        >
          Cerrar sesión
        </Button>
      </div>
    </main>
  );
}

function AppRoutes() {
  return (
    <ClientContextProvider>
      <Suspense fallback={<LoadingScreen />}>
        <>
          <EnvironmentStatusBanner />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/cambiar-contrasena" element={<ChangePasswordPage />} />
            <Route path="/aceptar-invitacion" element={<AcceptPortalInvitation />} />
            <Route path="/recuperar-acceso" element={<RecoverAccessPage />} />
            <Route path="/sin-acceso" element={<NoWorkspace />} />
            <Route element={<Protected />}>
              <Route element={<StudyShell />}>
                <Route path="ayuda" element={<StudyAyuda />} />
                {STUDY_MODULES.map((module) =>
                  module.path === "/" ? (
                    <Route key={module.id} index element={<StudyModuleRoute module={module} />} />
                  ) : (
                    <Route
                      key={module.id}
                      path={module.path.slice(1)}
                      element={<StudyModuleRoute module={module} />}
                    />
                  ),
                )}
                <Route
                  path="clientes/:clientId/rentabilidad"
                  element={<LegacyClientModuleRoute to="/rentabilidad" />}
                />
                <Route
                  path="clientes/:clientId/configuracion-fiscal"
                  element={<LegacyClientModuleRoute to="/configuracion-fiscal" />}
                />
                <Route path="*" element={<StudyNotFound />} />
              </Route>
            </Route>
            <Route element={<Protected portal />}>
              <Route path="portal" element={<PortalShell />}>
                <Route index element={<PortalDashboard />} />
                <Route path="pendientes" element={<PortalPendientes />} />
                <Route path="upload" element={<PortalUpload />} />
                <Route path="impuestos" element={<PortalObligaciones />} />
                <Route path="liquidaciones" element={<PortalLiquidaciones />} />
                <Route path="rentabilidad" element={<PortalRentabilidad />} />
                <Route path="reportes" element={<PortalReportes />} />
                <Route path="mensajes" element={<PortalMensajes />} />
                <Route path="perfil" element={<PortalPerfil />} />
                <Route path="*" element={<PortalNotFound />} />
              </Route>
            </Route>
            <Route element={<Protected />}>
              <Route path="*" element={<StudyNotFound />} />
            </Route>
          </Routes>
        </>
      </Suspense>
    </ClientContextProvider>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <SessionProvider>
            <AppRoutes />
          </SessionProvider>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
