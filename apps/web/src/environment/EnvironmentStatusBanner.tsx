import { useEffect, useMemo, useState } from "react";
import { Button } from "@contable/design-system";
import { Icon } from "../ui/Icon";

type DependencyName = "postgres" | "valkey" | "minio" | "ai";
type DependencyStatus = Partial<Record<DependencyName, boolean>>;

interface ReadyPayload {
  data?: {
    status?: string;
    dependencies?: DependencyStatus;
  };
  error?: {
    message?: string;
    dependencies?: DependencyStatus;
  };
}

const DEPENDENCY_LABELS: Record<DependencyName, string> = {
  postgres: "PostgreSQL",
  valkey: "Valkey",
  minio: "MinIO",
  ai: "AI service",
};

function listMissingDependencies(dependencies: DependencyStatus | null): string[] {
  if (!dependencies) return [];
  return (Object.keys(DEPENDENCY_LABELS) as DependencyName[])
    .filter((name) => dependencies[name] === false)
    .map((name) => DEPENDENCY_LABELS[name]);
}

export function EnvironmentStatusBanner() {
  const [refreshTick, setRefreshTick] = useState(0);
  const [state, setState] = useState<{
    ready: boolean;
    message: string | null;
    dependencies: DependencyStatus | null;
  }>({
    ready: true,
    message: null,
    dependencies: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/v1/system/ready", {
          credentials: "same-origin",
        });
        const payload = (await response.json().catch(() => null)) as ReadyPayload | null;
        if (cancelled) return;

        if (response.ok) {
          setState({
            ready: true,
            message: null,
            dependencies: payload?.data?.dependencies ?? null,
          });
          setLoading(false);
          return;
        }

        setState({
          ready: false,
          message: payload?.error?.message ?? "No pudimos verificar el entorno de trabajo.",
          dependencies: payload?.error?.dependencies ?? null,
        });
      } catch {
        if (cancelled) return;
        setState({
          ready: false,
          message: "No pudimos verificar el entorno de trabajo.",
          dependencies: null,
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void check();
    const intervalId = window.setInterval(() => void check(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [refreshTick]);

  const missing = useMemo(
    () => listMissingDependencies(state.dependencies),
    [state.dependencies],
  );

  if (state.ready || (loading && !state.message && !state.dependencies)) return null;

  return (
    <div className="app-banner" role="status" aria-live="polite">
      <div className="app-banner__copy">
        <span className="app-banner__icon" aria-hidden="true">
          <Icon name="alert" size={16} />
        </span>
        <span>
          <strong>Entorno incompleto</strong>
          <small>
            {missing.length > 0
              ? `Faltan ${missing.join(", ")}. Algunas pantallas no van a poder ejecutar acciones reales.`
              : state.message ?? "No pudimos verificar el entorno de trabajo."}
          </small>
        </span>
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => setRefreshTick((value) => value + 1)}
      >
        Reintentar
      </Button>
    </div>
  );
}
