// Etapa Controles del Legajo: hallazgos, resolución y evidencia por control (Foco 2.3d).
import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { AsyncState, Button, EmptyState, getStatusBadgeMeta } from "@contable/design-system";
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

/** Pedido de confirmación que arma la pantalla (ConfirmDialog, C09). */
export interface SolicitudConfirmacion {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
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
  confirmar: (solicitud: SolicitudConfirmacion) => void;
}

const CARGA_DOCUMENTOS = "Cargando documentos de respaldo…";

export function EtapaControles({
  capabilities,
  wp,
  controlResolutions,
  setControlResolutions,
  controlEvidence,
  setControlEvidence,
  documentsQuery,
  resolveControlMutation,
  confirmar,
}: EtapaControlesProps) {
  const eligibleEvidenceDocuments = (documentsQuery.data ?? []).filter((document) =>
    ["READY", "APPLIED", "REVIEWED"].includes(document.status),
  );
  // Los controles vienen dentro del legajo: no tienen consulta propia, así que su vacío sale de la respuesta del legajo.
  const puedeResolver = capabilities.has("tax.settlements.review");

  return (
    <div className="workpaper-controls">
      {wp.controls.length === 0 ? (
        <EmptyState size="inline" title="No hay controles registrados para este legajo." />
      ) : (
        wp.controls.map((control) => {
          const resolucion = controlResolutions[control.id]?.trim() ?? "";
          return (
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
              {control.status === "OPEN" && !puedeResolver ? (
                <small className="muted-copy" role="status">
                  Tu perfil no puede resolver controles de este legajo.
                </small>
              ) : null}
              {control.status === "OPEN" && puedeResolver ? (
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
                    documentsQuery.isError ? (
                      <AsyncState
                        loading={false}
                        error
                        errorTitle="No se pudieron leer los documentos de respaldo"
                        errorDescription="Reintentá la lectura. Mientras tanto, el control puede resolverse sin respaldo."
                        onRetry={() => void documentsQuery.refetch()}
                        loadingLabel={CARGA_DOCUMENTOS}
                      />
                    ) : documentsQuery.isSuccess ? (
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
                        {eligibleEvidenceDocuments.length === 0 ? (
                          <small className="muted-copy">
                            El respaldo es opcional. Para adjuntar uno, aprobá la extracción del
                            documento en Bandeja.
                          </small>
                        ) : null}
                      </>
                    ) : (
                      <AsyncState
                        loading
                        error={false}
                        errorTitle=""
                        errorDescription=""
                        onRetry={() => void documentsQuery.refetch()}
                        loadingLabel={CARGA_DOCUMENTOS}
                      />
                    )
                  ) : null}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!resolucion}
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
                  {!resolucion ? (
                    <small className="muted-copy" role="status">
                      Escribí la resolución para resolver el control.
                    </small>
                  ) : null}
                  {control.severity !== "BLOCKING" ? (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!resolucion}
                        onClick={() =>
                          confirmar({
                            title: "Eximir el control",
                            description:
                              "Vas a eximir este control con el motivo escrito. Quedará registrado como eximido.",
                            confirmLabel: "Sí, eximir",
                            onConfirm: () =>
                              resolveControlMutation.mutate({
                                workpaperId: wp.id,
                                findingId: control.id,
                                status: "WAIVED",
                              }),
                          })
                        }
                      >
                        Eximir
                      </Button>
                      {!resolucion ? (
                        <small className="muted-copy" role="status">
                          Escribí el motivo para eximir el control.
                        </small>
                      ) : null}
                    </>
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
          );
        })
      )}
    </div>
  );
}
