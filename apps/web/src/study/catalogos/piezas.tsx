import { Notice } from "@contable/design-system";
import { FieldErrorsFromDetails } from "../../components/forms/FieldErrorsFromDetails";
import { ApiError } from "../../lib/api";
import { StatusBadge } from "../../ui/StatusBadge";
import { codeConflict } from "./utilidades";

export function ActivityStateBadge({ isActive }: { isActive: boolean }) {
  return (
    <StatusBadge
      status={isActive ? "ACTIVE" : "INACTIVE"}
      label={isActive ? undefined : "Oculto"}
    />
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <StatusBadge
      status={active ? "ACTIVE" : "INACTIVE"}
      label={active ? "Activo" : "Oculto"}
    />
  );
}

export function OriginBadge({ origin }: { origin?: "REFERENCE" | "UI" }) {
  if (!origin) return <span className="muted-copy">—</span>;
  return (
    <StatusBadge
      status={origin === "UI" ? "INFO" : "REFERENCE"}
      label={origin === "UI" ? "Del estudio" : "Referencia"}
    />
  );
}

export function MutationError({ error }: { error: unknown }) {
  if (!error || codeConflict(error)) return null;
  if (error instanceof ApiError) return <FieldErrorsFromDetails error={error} />;
  return (
    <Notice tone="error">
      {error instanceof Error ? error.message : "Ocurrió un error inesperado."}
    </Notice>
  );
}
