// Etapa Fuentes del Legajo (Foco 2.3b-1): extraída de renderEtapa sin cambio de marcado.
import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button, Table } from "@contable/design-system";
import { StatusBadge } from "../../../ui/StatusBadge";
import { WorkpaperSourceReviewAction } from "../../WorkpaperSourceReviewAction";
import type { CoberturaLegajo } from "../tipos";
import { WorkpaperActionError } from "../WorkpaperActionError";

export interface EtapaFuentesProps {
  coverageQuery: UseQueryResult<CoberturaLegajo, Error>;
  capabilities: ReadonlySet<string>;
  canEditSources: boolean;
  currentUserId: string | null;
  sourceCode: string;
  setSourceCode: Dispatch<SetStateAction<string>>;
  sourceFile: File | null;
  setSourceFile: Dispatch<SetStateAction<File | null>>;
  sourceUploadMutation: UseMutationResult<void, Error, void>;
  reviewSourceMutation: UseMutationResult<unknown, Error, string>;
}

export function EtapaFuentes({
  coverageQuery,
  capabilities,
  canEditSources,
  currentUserId,
  sourceCode,
  setSourceCode,
  sourceFile,
  setSourceFile,
  sourceUploadMutation,
  reviewSourceMutation,
}: EtapaFuentesProps) {
  const navigate = useNavigate();
  return (
    <div className="workpaper-stage">
      <div className="workpaper-stage__heading">
        <div>
          <strong>Cobertura de fuentes</strong>
          <small>El legajo declara qué llegó y qué todavía bloquea el cálculo.</small>
        </div>
        <span className="workpaper-stage__actions">
          <Button size="sm" variant="ghost" onClick={() => void coverageQuery.refetch()}>
            Actualizar
          </Button>
          <Button size="sm" variant="secondary" onClick={() => navigate("/bandeja")}>
            Ir a bandeja
          </Button>
        </span>
      </div>
      {coverageQuery.isLoading ? (
        <p className="muted-copy">Verificando cobertura…</p>
      ) : (
        <>
          {canEditSources &&
          capabilities.has("tax.vouchers.prepare") &&
          (coverageQuery.data?.sources.length ?? 0) > 0 ? (
            <div className="workpaper-source-import">
              <label>
                <span>Fuente</span>
                <select
                  value={sourceCode}
                  onChange={(event) => {
                    setSourceCode(event.target.value);
                    setSourceFile(null);
                  }}
                >
                  <option value="">Seleccionar…</option>
                  {(coverageQuery.data?.sources ?? []).map((source) => (
                    <option key={source.code} value={source.code}>
                      {source.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Archivo CSV, TXT o JSON</span>
                <input
                  type="file"
                  accept=".csv,.txt,.json,text/csv,text/plain,application/json"
                  onChange={(event) => setSourceFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <Button
                size="sm"
                variant="secondary"
                disabled={!sourceCode || !sourceFile || sourceUploadMutation.isPending}
                onClick={() => sourceUploadMutation.mutate()}
              >
                {sourceUploadMutation.isPending ? "Procesando…" : "Importar lote"}
              </Button>
              <WorkpaperActionError error={sourceUploadMutation.error} />
              {sourceCode ? (
                <small>
                  Columnas esperadas:{" "}
                  {coverageQuery.data?.sources
                    .find((source) => source.code === sourceCode)
                    ?.expectedColumns.join(", ")}
                </small>
              ) : null}
            </div>
          ) : null}
          <Table
            rows={coverageQuery.data?.sources ?? []}
            rowKey={(source) => source.code}
            empty="No hay fuentes definidas para el legajo."
            columns={[
              {
                key: "source",
                header: "Fuente",
                render: (source) => (
                  <>
                    <strong>{source.label}</strong>
                    <br />
                    <small>{source.code}</small>
                  </>
                ),
              },
              {
                key: "records",
                header: "Registros",
                align: "right",
                render: (source) => source.count,
              },
              {
                key: "required",
                header: "Tipo",
                render: (source) => (source.required ? "Obligatoria" : "Opcional"),
              },
              {
                key: "batches",
                header: "Lotes",
                render: (source) =>
                  source.batches.length === 0 ? (
                    "Sin lotes"
                  ) : (
                    <div className="workpaper-source-batches">
                      {source.batches.map((batch) => (
                        <div key={batch.id}>
                          <span>
                            {batch.fileName ?? "Lote sin nombre"} · {batch.validRows}/
                            {batch.totalRows} filas
                          </span>
                          <StatusBadge
                            status={batch.reviewStatus === "REVIEWED" ? "READY" : batch.batchStatus}
                          />
                          <WorkpaperSourceReviewAction
                            batch={batch}
                            currentUserId={currentUserId}
                            allowSelfReview={coverageQuery.data?.allowSelfReview === true}
                            canEditSources={canEditSources}
                            canReview={capabilities.has("tax.vouchers.review")}
                            pending={reviewSourceMutation.isPending}
                            error={
                              reviewSourceMutation.variables === batch.id
                                ? reviewSourceMutation.error
                                : null
                            }
                            onReview={(sourceLinkId) => reviewSourceMutation.mutate(sourceLinkId)}
                          />
                        </div>
                      ))}
                    </div>
                  ),
              },
              {
                key: "state",
                header: "Estado",
                render: (source) => (
                  <StatusBadge
                    status={
                      source.present ? "READY" : source.required ? "WAITING_INPUTS" : "PENDING"
                    }
                  />
                ),
              },
            ]}
          />
          {coverageQuery.data?.sources.some(
            (source) => source.required && !source.present && source.count === 0,
          ) ? (
            <p className="workpaper-stage__note" role="status">
              La cobertura cuenta solo lotes revisados. Los lotes pendientes de revisión mantienen
              el conteo en 0 registros.
            </p>
          ) : null}
          <WorkpaperActionError
            error={
              coverageQuery.data?.sources.some((source) =>
                source.batches.some((batch) => batch.id === reviewSourceMutation.variables),
              )
                ? reviewSourceMutation.error
                : null
            }
          />
          <Table
            rows={coverageQuery.data?.components ?? []}
            rowKey={(component) => component.obligationId}
            empty="No hay obligaciones vinculadas."
            columns={[
              {
                key: "regime",
                header: "Componente",
                render: (component) => `${component.taxTypeCode} · ${component.regimeCode}`,
              },
              {
                key: "required",
                header: "Requerido",
                render: (component) => (component.required ? "Sí" : "No"),
              },
              {
                key: "state",
                header: "Liquidación",
                render: (component) =>
                  component.settlementStatus ? (
                    <StatusBadge status={component.settlementStatus} />
                  ) : (
                    "Sin liquidación calculada"
                  ),
              },
            ]}
          />
        </>
      )}
    </div>
  );
}
