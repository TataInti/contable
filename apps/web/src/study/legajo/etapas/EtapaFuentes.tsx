// Etapa Fuentes del Legajo: cobertura, lotes y libros IVA desde su fila (Foco 2.3b-2).
import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AsyncState, Button, Table } from "@contable/design-system";
import { StatusBadge } from "../../../ui/StatusBadge";
import { WorkpaperSourceReviewAction } from "../../WorkpaperSourceReviewAction";
import { estadoDeLote, ladoDeLibroIva } from "../loteFuente";
import { FilasConErrorDeLote } from "../DetalleFilasLote";
import type { CoberturaLegajo } from "../tipos";
import { WorkpaperActionError } from "../WorkpaperActionError";

export interface EtapaFuentesProps {
  coverageQuery: UseQueryResult<CoberturaLegajo, Error>;
  capabilities: ReadonlySet<string>;
  canEditSources: boolean;
  currentUserId: string | null;
  motivoImportarLibro: string | null;
  onAbrirLibroIva: (lado: "SALE" | "PURCHASE") => void;
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
  motivoImportarLibro,
  onAbrirLibroIva,
  sourceCode,
  setSourceCode,
  sourceFile,
  setSourceFile,
  sourceUploadMutation,
  reviewSourceMutation,
}: EtapaFuentesProps) {
  const navigate = useNavigate();
  const fuentes = coverageQuery.data?.sources ?? [];
  const fuentesLote = fuentes.filter((source) => !ladoDeLibroIva(source.code));
  const fuenteElegida = fuentesLote.find((source) => source.code === sourceCode);
  const motivoLote =
    !sourceCode || !sourceFile ? "Elegí una fuente y un archivo para importar el lote." : null;
  return (
    <div className="workpaper-stage">
      <div className="workpaper-stage__heading">
        <div>
          <strong>Cobertura de fuentes</strong>
          <small>El legajo declara qué llegó y qué todavía bloquea el cálculo.</small>
        </div>
        <span className="workpaper-stage__actions">
          <Button
            size="sm"
            variant="ghost"
            disabled={coverageQuery.isFetching}
            onClick={() => void coverageQuery.refetch()}
          >
            {coverageQuery.isFetching && coverageQuery.isSuccess ? "Actualizando…" : "Actualizar"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => navigate("/bandeja")}>
            Ir a bandeja
          </Button>
        </span>
      </div>
      {coverageQuery.isError ? (
        <AsyncState
          loading={false}
          error
          errorTitle="No se pudo verificar la cobertura"
          errorDescription="Reintentá la lectura. Hasta que responda, la etapa no muestra fuentes ni lotes."
          onRetry={() => void coverageQuery.refetch()}
          loadingLabel="Verificando cobertura…"
        />
      ) : !coverageQuery.isSuccess ? (
        <AsyncState
          loading
          error={false}
          errorTitle=""
          errorDescription=""
          onRetry={() => void coverageQuery.refetch()}
          loadingLabel="Verificando cobertura…"
        />
      ) : (
        <>
          {coverageQuery.isFetching ? (
            <small className="muted-copy">Dato del último corte; se está actualizando.</small>
          ) : null}
          {canEditSources && capabilities.has("tax.vouchers.prepare") && fuentesLote.length > 0 ? (
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
                  {fuentesLote.map((source) => (
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
              {motivoLote && !sourceUploadMutation.isPending ? (
                <small className="muted-copy">{motivoLote}</small>
              ) : null}
              <WorkpaperActionError error={sourceUploadMutation.error} />
              {sourceCode ? (
                <small>Columnas esperadas: {fuenteElegida?.expectedColumns.join(", ")}</small>
              ) : null}
            </div>
          ) : null}
          <Table
            rows={fuentes}
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
                          <StatusBadge {...estadoDeLote(batch)} />
                          {ladoDeLibroIva(source.code) !== null && batch.errorRows > 0 ? (
                            <FilasConErrorDeLote batchId={batch.id} />
                          ) : null}
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
              {
                key: "accion",
                header: "Acción",
                render: (source) => {
                  const lado = ladoDeLibroIva(source.code);
                  if (!lado) return null;
                  return (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={Boolean(motivoImportarLibro)}
                        onClick={() => onAbrirLibroIva(lado)}
                      >
                        Importar libro
                      </Button>
                      {motivoImportarLibro ? (
                        <small className="muted-copy">{motivoImportarLibro}</small>
                      ) : null}
                    </>
                  );
                },
              },
            ]}
          />
          {fuentes.some((source) => source.required && !source.present && source.count === 0) ? (
            <p className="workpaper-stage__note">
              La cobertura cuenta solo lotes revisados. Los lotes pendientes de revisión mantienen
              el conteo en 0 registros.
            </p>
          ) : null}
          <WorkpaperActionError
            error={
              fuentes.some((source) =>
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
