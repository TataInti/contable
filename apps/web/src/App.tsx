import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { Button } from "@contable/design-system";
import { ClientContextProvider } from "./context/ClientContext";
import { SessionProvider, useSession } from "./session/SessionContext";
import { StudyShell } from "./shells/StudyShell";
import { PortalShell } from "./shells/PortalShell";
import { LoginPage } from "./auth/LoginPage";
import { AcceptPortalInvitation } from "./auth/AcceptPortalInvitation";
import { logout } from "./lib/auth";
import { Icon } from "./ui/Icon";
import "./App.css";

const StudyDashboard = lazy(() =>
  import("./study/StudyDashboard").then((m) => ({ default: m.StudyDashboard })),
);
const StudyClientes = lazy(() =>
  import("./study/StudyClientes").then((m) => ({ default: m.StudyClientes })),
);
const StudyBandeja = lazy(() =>
  import("./study/StudyBandeja").then((m) => ({ default: m.StudyBandeja })),
);
const StudyTrabajo = lazy(() =>
  import("./study/StudyTrabajo").then((m) => ({ default: m.StudyTrabajo })),
);
const StudyAdministracion = lazy(() =>
  import("./study/StudyAdministracion").then((m) => ({ default: m.StudyAdministracion })),
);
const StudyOnboardingFiscal = lazy(() =>
  import("./study/StudyOnboardingFiscal").then((m) => ({ default: m.StudyOnboardingFiscal })),
);
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
const PortalReportes = lazy(() =>
  import("./portal/PortalReportes").then((m) => ({ default: m.PortalReportes })),
);
const PortalMensajes = lazy(() =>
  import("./portal/PortalMensajes").then((m) => ({ default: m.PortalMensajes })),
);
const PortalPerfil = lazy(() =>
  import("./portal/PortalPerfil").then((m) => ({ default: m.PortalPerfil })),
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

function Protected({ portal = false }: { portal?: boolean }) {
  const session = useSession();
  const location = useLocation();
  if (session.status === "loading") return <LoadingScreen />;
  if (session.status === "unauthenticated")
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (portal && session.portalContexts.length === 0) {
    return <Navigate to={(session.me?.firms.length ?? 0) > 0 ? "/" : "/sin-acceso"} replace />;
  }
  if (!portal && (session.me?.firms.length ?? 0) === 0) {
    return <Navigate to={session.portalContexts.length > 0 ? "/portal" : "/sin-acceso"} replace />;
  }
  return <Outlet />;
}

function NoWorkspace() {
  const session = useSession();
  if (session.status === "loading") return <LoadingScreen />;
  if (session.status === "unauthenticated") return <Navigate to="/login" replace />;
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
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/aceptar-invitacion" element={<AcceptPortalInvitation />} />
          <Route path="/sin-acceso" element={<NoWorkspace />} />
          <Route element={<Protected />}>
            <Route element={<StudyShell />}>
              <Route index element={<StudyDashboard />} />
              <Route path="clientes" element={<StudyClientes />} />
              <Route path="clientes/:clientId/configuracion-fiscal" element={<StudyOnboardingFiscal />} />
              <Route path="bandeja" element={<StudyBandeja />} />
              <Route path="trabajo" element={<StudyTrabajo />} />
              <Route path="administracion" element={<StudyAdministracion />} />
            </Route>
          </Route>
          <Route element={<Protected portal />}>
            <Route path="portal" element={<PortalShell />}>
              <Route index element={<PortalDashboard />} />
              <Route path="pendientes" element={<PortalPendientes />} />
              <Route path="upload" element={<PortalUpload />} />
              <Route path="impuestos" element={<PortalObligaciones />} />
              <Route path="reportes" element={<PortalReportes />} />
              <Route path="mensajes" element={<PortalMensajes />} />
              <Route path="perfil" element={<PortalPerfil />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ClientContextProvider>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionProvider>
          <AppRoutes />
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
