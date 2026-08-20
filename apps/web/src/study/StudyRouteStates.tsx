import { useEffect, useState, type ReactNode } from "react";
import { Button, EmptyState } from "@contable/design-system";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useClientContext } from "../context/ClientContext";
import { Icon } from "../ui/Icon";
import type { StudyModule } from "./moduleRegistry";
import "./study.css";

function focusContext() {
  document.querySelector<HTMLSelectElement>("#context-bar select:not(:disabled)")?.focus();
}

function ContextRequired({
  title,
  description,
  actionLabel,
}: {
  title: string;
  description: string;
  actionLabel: string;
}) {
  return (
    <div className="study-page study-route-state">
      <EmptyState
        title={title}
        description={description}
        action={
          <Button type="button" onClick={focusContext}>
            <Icon name="settings" size={17} /> {actionLabel}
          </Button>
        }
      />
    </div>
  );
}

export function StudyModuleGuard({ module, children }: { module: StudyModule; children: ReactNode }) {
  const { isReady, firmId, clientId, periodId, capabilities } = useClientContext();
  const navigate = useNavigate();

  if (!isReady) {
    return (
      <div className="study-page study-route-state" role="status" aria-live="polite">
        Preparando el contexto de trabajo…
      </div>
    );
  }

  if (module.status !== "released") {
    return (
      <div className="study-page study-route-state">
        <EmptyState
          title="Esta sección todavía no está disponible"
          description="La función no forma parte de esta versión operativa."
          action={
            <Button type="button" variant="secondary" onClick={() => navigate("/")}>
              Volver al inicio
            </Button>
          }
        />
      </div>
    );
  }

  if (module.requiredCapability && !capabilities.has(module.requiredCapability)) {
    return (
      <div className="study-page study-route-state">
        <EmptyState
          title="No tenés acceso a esta sección"
          description={`Tu rol no incluye la capacidad necesaria para usar ${module.label.toLocaleLowerCase("es-AR")}. Si necesitás acceso, pedíselo a una persona administradora del estudio.`}
          action={
            <Button type="button" variant="secondary" onClick={() => navigate("/")}>
              Ver módulos disponibles
            </Button>
          }
        />
      </div>
    );
  }

  if (module.requirements.firm && !firmId) {
    return (
      <ContextRequired
        title="Elegí un estudio"
        description="Primero definí el estudio con el que vas a trabajar."
        actionLabel="Elegir estudio"
      />
    );
  }

  if (module.requirements.client && !clientId) {
    return (
      <ContextRequired
        title="Elegí un cliente"
        description={`${module.label} se organiza dentro de un cliente explícito.`}
        actionLabel="Elegir cliente"
      />
    );
  }

  if (module.requirements.period && !periodId) {
    return (
      <ContextRequired
        title="Elegí un período"
        description={`${module.label} usa el período activo para mantener los resultados trazables.`}
        actionLabel="Elegir período"
      />
    );
  }

  return <>{children}</>;
}

export function LegacyClientModuleRoute({ to }: { to: string }) {
  const { clientId: legacyClientId } = useParams<{ clientId: string }>();
  const { isReady, firmId, hasClientAccess, setClientId } = useClientContext();
  const [resolvedClientId, setResolvedClientId] = useState<string | null>(null);

  useEffect(() => {
    if (!isReady || !firmId || !legacyClientId || !hasClientAccess(legacyClientId)) {
      setResolvedClientId(null);
      return;
    }
    setClientId(legacyClientId);
    setResolvedClientId(legacyClientId);
  }, [firmId, hasClientAccess, isReady, legacyClientId, setClientId]);

  if (!isReady) {
    return (
      <div className="study-page study-route-state" role="status" aria-live="polite">
        Verificando el acceso al cliente…
      </div>
    );
  }

  if (!firmId) {
    return (
      <ContextRequired
        title="Elegí un estudio"
        description="No podemos abrir un enlace de cliente sin conocer el estudio activo."
        actionLabel="Elegir estudio"
      />
    );
  }

  if (!legacyClientId || !hasClientAccess(legacyClientId)) {
    return (
      <div className="study-page study-route-state">
        <EmptyState
          title="No tenés acceso a este cliente"
          description="El enlace no pertenece al estudio activo o tu rol no tiene asignación sobre ese cliente."
        />
      </div>
    );
  }

  if (resolvedClientId !== legacyClientId) {
    return (
      <div className="study-page study-route-state" role="status" aria-live="polite">
        Actualizando el contexto del cliente…
      </div>
    );
  }

  return <Navigate to={to} replace />;
}

export function StudyNotFound() {
  const navigate = useNavigate();
  return (
    <div className="study-page study-route-state">
      <EmptyState
        title="Esta sección no existe"
        description="El enlace puede estar desactualizado o no formar parte de tu espacio de trabajo."
        action={
          <Button type="button" onClick={() => navigate("/")}>
            Ir al inicio
          </Button>
        }
      />
    </div>
  );
}

export function PortalNotFound() {
  const navigate = useNavigate();
  return (
    <div className="portal-page">
      <EmptyState
        title="Esta sección no existe"
        description="El enlace puede estar desactualizado o no estar disponible en el portal."
        action={
          <Button type="button" onClick={() => navigate("/portal")}>
            Volver al inicio del portal
          </Button>
        }
      />
    </div>
  );
}
