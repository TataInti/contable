// Etapa Controles del Legajo: hallazgos, resolución y evidencia por control (Foco 2.3d).
import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { AsyncState, Button, EmptyState, getStatusBadgeMeta, SearchSelect } from "@contable/design-system";
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
  // La lectura de documentos es una sola para la etapa: su aviso y su carga se muestran una vez, arriba de la lista.
  const pideRespaldo =
    puedeResolver &&
    wp.controls.some((control) => control.status === "OPEN" && control.severity === "BLOCKING");

  return (
    <div className="workpaper-controls">
      {pideRespaldo && documentsQuery.isError ? (
        <AsyncState
          loading={false}
          error
          errorTitle="No se pudieron leer los documentos de respaldo"
          errorDescription="Reintentá la lectura. Mientras tanto, el control puede resolverse sin respaldo."
          onRetry={() => void documentsQuery.refetch()}
          loadingLabel={CARGA_DOCUMENTOS}
        />
      ) : null}
      {pideRespaldo && !documentsQuery.isError && !documentsQuery.isSuccess ? (
        <AsyncState
          loading
          error={false}
          errorTitle=""
          errorDescription=""
          onRetry={() => void documentsQuery.refetch()}
          loadingLabel={CARGA_DOCUMENTOS}
        />
      ) : null}
      {wp.controls.length === 0 ? (
        <EmptyState size="inline" title="No hay controles registrados para este legajo." />
      ) : (
        wp.controls.map((control) => {
          const nombre = CONTROL_LABELS[control.code] ?? control.code;
          const resolucion = controlResolutions[control.id]?.trim() ?? "";
          const motivoId = `${control.id}-motivo`;
          return (
            <div className="workpaper-control" key={control.id}>
              <span>
                <strong>{nombre}</strong>
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
                    placeholder="Escribí el motivo o cómo se resolvió."
                    onChange={(event) =>
                      setControlResolutions((values) => ({
                        ...values,
                        [control.id]: event.target.value,
                      }))
                    }
                  />
                  {control.severity === "BLOCKING" && documentsQuery.isSuccess ? (
                    <SearchSelect
                      label={`Evidencia ${control.code}`}
                      hideLabel
                      value={controlEvidence[control.id] ?? ""}
                      onChange={(value) =>
                        setControlEvidence((values) => ({
                          ...values,
                          [control.id]: value,
                        }))
                      }
                      placeholder="Sin documento de respaldo"
                      options={eligibleEvidenceDocuments.map((document) => ({
                        value: document.id,
                        label: `${document.fileVersions?.[0]?.originalName ?? document.category ?? "Documento"} · ${getStatusBadgeMeta(document.status).label}`,
                      }))}
                    />
                  ) : null}
                  <span className="workpaper-control__acciones">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!resolucion}
                      loading={resolveControlMutation.isPending}
                      aria-describedby={resolucion ? undefined : motivoId}
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
                        variant="secondary"
                        disabled={!resolucion}
                        aria-describedby={resolucion ? undefined : motivoId}
                        onClick={() =>
                          confirmar({
                            title: "Eximir el control",
                            description: `Vas a eximir el control «${nombre}» con el motivo «${resolucion}». Quedará registrado como eximido.`,
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
                    ) : null}
                    {!resolucion ? (
                      <small id={motivoId} className="form-submit-hint" role="note">
                        Falta escribir el motivo o cómo se resolvió.
                      </small>
                    ) : null}
                  </span>
                  <WorkpaperActionError
                    error={
                      resolveControlMutation.variables?.findingId === control.id
                        ? resolveControlMutation.error
                        : null
                    }
                  />
                  {control.severity === "BLOCKING" &&
                  documentsQuery.isSuccess &&
                  eligibleEvidenceDocuments.length === 0 ? (
                    <small className="muted-copy workpaper-control__ayuda">
                      El respaldo es opcional. Para adjuntar uno, aprobá la extracción del documento
                      en Bandeja.
                    </small>
                  ) : null}
                </span>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}
