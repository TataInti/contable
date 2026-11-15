// Etapa Controles del Legajo: hallazgos, resolución y evidencia por control (Foco 2.3d).
import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { Button, getStatusBadgeMeta } from "@contable/design-system";
import { StatusBadge } from "../../../ui/StatusBadge";
import { CONTROL_LABELS, CONTROL_SEVERITY_LABELS } from "../etiquetas";
import { formatMoney } from "../formato";
import type { EvidenceDocument, Workpaper } from "../tipos";
import { WorkpaperActionError } from "../WorkpaperActionError";

export interface ResolverControlVariables {
  workpaperId: string;
  findingId: string;
  status: "RESOLVED" | "WAIVED";
  evidenceDocumentId?: string;
}

export interface EtapaControlesProps {
  capabilities: ReadonlySet<string>;
  wp: Workpaper;
  controlResolutions: Record<string, string>;
  setControlResolutions: Dispatch<SetStateAction<Record<string, string>>>;
  controlEvidence: Record<string, string>;
  setControlEvidence: Dispatch<SetStateAction<Record<string, string>>>;
  documentsQuery: UseQueryResult<EvidenceDocument[], Error>;
  resolveControlMutation: UseMutationResult<unknown, Error, ResolverControlVariables>;
}

export function EtapaControles({
  capabilities,
  wp,
  controlResolutions,
  setControlResolutions,
  controlEvidence,
  setControlEvidence,
  documentsQuery,
  resolveControlMutation,
}: EtapaControlesProps) {
  const eligibleEvidenceDocuments = (documentsQuery.data ?? []).filter((document) =>
    ["READY", "APPLIED", "REVIEWED"].includes(document.status),
  );

  return (
    <div className="workpaper-controls">
      {wp.controls.length === 0 ? (
        <p>No hay controles registrados para este legajo.</p>
      ) : (
        wp.controls.map((control) => (
          <div className="workpaper-control" key={control.id}>
            <span>
              <strong>{CONTROL_LABELS[control.code] ?? control.code}</strong>
              {control.message ? <small>{control.message}</small> : null}
              {control.expected !== null ? (
                <small>
                  Esperado: {formatMoney(control.expected)}
                  {control.actual !== null
                    ? ` · Actual: ${formatMoney(control.actual)}`
                    : control.status === "OPEN"
                      ? " · Pendiente de respaldo"
                      : ""}
                  {control.tolerance !== null
                    ? ` · Tolerancia: ${formatMoney(control.tolerance)}`
                    : ""}
                </small>
              ) : null}
              {control.resolution ? <small>{control.resolution}</small> : null}
            </span>
            <StatusBadge status={control.status} />
            <span className="muted-copy">
              {control.severity === "BLOCKING" && control.status !== "OPEN"
                ? "Bloqueaba el cierre"
                : (CONTROL_SEVERITY_LABELS[control.severity] ?? control.severity)}
            </span>
            {control.status === "OPEN" && capabilities.has("tax.settlements.review") ? (
              <span className="workpaper-control__resolution">
                <input
                  aria-label={`Resolución ${control.code}`}
                  value={controlResolutions[control.id] ?? ""}
                  placeholder="Explicá cómo se resolvió…"
                  onChange={(event) =>
                    setControlResolutions((values) => ({
                      ...values,
                      [control.id]: event.target.value,
                    }))
                  }
                />
                {control.severity === "BLOCKING" ? (
                  <>
                    <select
                      aria-label={`Evidencia ${control.code}`}
                      value={controlEvidence[control.id] ?? ""}
                      onChange={(event) =>
                        setControlEvidence((values) => ({
                          ...values,
                          [control.id]: event.target.value,
                        }))
                      }
                    >
                      <option value="">Sin documento de respaldo</option>
                      {eligibleEvidenceDocuments.map((document) => (
                        <option key={document.id} value={document.id}>
                          {document.fileVersions?.[0]?.originalName ??
                            document.category ??
                            "Documento"}{" "}
                          · {getStatusBadgeMeta(document.status).label}
                        </option>
                      ))}
                    </select>
                    {documentsQuery.isSuccess && eligibleEvidenceDocuments.length === 0 ? (
                      <small className="muted-copy">
                        El respaldo es opcional. Para adjuntar uno, aprobá la extracción del
                        documento en Bandeja.
                      </small>
                    ) : null}
                  </>
                ) : null}
                <Button
                  size="sm"
                  disabled={!controlResolutions[control.id]?.trim()}
                  loading={resolveControlMutation.isPending}
                  onClick={() =>
                    resolveControlMutation.mutate({
                      workpaperId: wp.id,
                      findingId: control.id,
                      status: "RESOLVED",
                      ...(controlEvidence[control.id]
                        ? { evidenceDocumentId: controlEvidence[control.id] }
                        : {}),
                    })
                  }
                >
                  Resolver
                </Button>
                {control.severity !== "BLOCKING" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!controlResolutions[control.id]?.trim()}
                    onClick={() =>
                      resolveControlMutation.mutate({
                        workpaperId: wp.id,
                        findingId: control.id,
                        status: "WAIVED",
                      })
                    }
                  >
                    Eximir
                  </Button>
                ) : null}
                <WorkpaperActionError
                  error={
                    resolveControlMutation.variables?.findingId === control.id
                      ? resolveControlMutation.error
                      : null
                  }
                />
              </span>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}
