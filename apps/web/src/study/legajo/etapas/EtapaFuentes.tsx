import { useState, type Dispatch, type SetStateAction } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { AsyncState, Button, Table } from "@contable/design-system";
import { StatusBadge } from "../../../ui/StatusBadge";

import { PanelGestionarFuente } from "../paneles/PanelGestionarFuente";
import type { CoberturaLegajo } from "../tipos";
import type { ResultadoImportacionLote } from "../loteFuente";

export interface EtapaFuentesProps {
  coverageQuery: UseQueryResult<CoberturaLegajo, Error>;
  workpaperId: string | null;
  capabilities: ReadonlySet<string>;
  canEditSources: boolean;
  currentUserId: string | null;
  soloLectura?: boolean;
  motivoImportarLibro: string | null;
  onAbrirLibroIva: (lado: "SALE" | "PURCHASE", replacesBatchId?: string) => void;
  sourceCode: string;
  setSourceCode: Dispatch<SetStateAction<string>>;
  sourceFile: File | null;
  setSourceFile: Dispatch<SetStateAction<File | null>>;
  sourceUploadMutation: UseMutationResult<ResultadoImportacionLote, Error, { replacesBatchId?: string }>;
  reviewSourceMutation: UseMutationResult<unknown, Error, string>;
  noMovementsMutation: UseMutationResult<unknown, Error, { sourceCode: string; marcar: boolean }>;
  /** Motivo por el que no se puede marcar «Sin movimientos»; null si se puede (corte 2A). */
  motivoSinMovimientos: string | null;
  /** El mes está calculado: se reemplazan o retiran archivos vigentes, pero no se cargan nuevos. */
  calculado?: boolean;
}

function nombreFuente(source: CoberturaLegajo["sources"][number]) {
  if (source.origin === "ARCA") {
    return source.expectedColumns.includes("nonTaxed") ? "Ventas del período" : "Compras del período";
  }
  if (source.origin === "DGR_RPI_TUC") return "Retenciones y percepciones IIBB Tucumán";
  if (source.origin === "DGR_IIBB") return "Ingresos Brutos Tucumán";
  return source.label;
}

function estadoFuente(source: CoberturaLegajo["sources"][number]) {
  if (source.batches.some((batch) => batch.errorRows > 0)) return { status: "ERROR", label: "Con errores" };
  if (source.present) return { status: "READY", label: `Cargada · ${source.count} filas` };
  if (source.status === "NO_MOVEMENTS") return { status: "NO_MOVEMENTS", label: "Sin movimientos" };
  return source.required
    ? { status: "WAITING_INPUTS", label: "Pendiente" }
    : { status: "PENDING", label: "Opcional" };
}

export function EtapaFuentes({
  coverageQuery,
  workpaperId,
  canEditSources,
  capabilities,
  currentUserId,
  soloLectura = false,
  motivoImportarLibro,
  onAbrirLibroIva,
  sourceCode,
  setSourceCode,
  sourceFile,
  setSourceFile,
  sourceUploadMutation,
  reviewSourceMutation,
  noMovementsMutation,
  motivoSinMovimientos,
  calculado = false,
}: EtapaFuentesProps) {
  const [fuenteAbierta, setFuenteAbierta] = useState<string | null>(null);
  const fuentes = coverageQuery.data?.sources ?? [];
  const fuenteSeleccionada = fuentes.find((source) => source.code === fuenteAbierta) ?? null;
  const faltantes = fuentes.filter((source) => source.required && !source.present && source.status !== "NO_MOVEMENTS").map(nombreFuente);
  const puedeCargar = canEditSources && !soloLectura && capabilities.has("tax.vouchers.prepare");

  return (
    <div className="workpaper-stage">
      {coverageQuery.isError ? (
        <AsyncState loading={false} error errorTitle="No se pudo verificar la cobertura" errorDescription="Reintentá la lectura. Hasta que responda, la etapa no muestra fuentes ni lotes." onRetry={() => void coverageQuery.refetch()} loadingLabel="Verificando cobertura…" />
      ) : !coverageQuery.isSuccess ? (
        <AsyncState loading error={false} errorTitle="" errorDescription="" onRetry={() => void coverageQuery.refetch()} loadingLabel="Verificando cobertura…" />
      ) : (
        <>
          <p className="workpaper-source-readiness" role="status">
            {faltantes.length ? <>Para calcular falta: <strong>{faltantes.join(", ")}</strong></> : "Todo listo para calcular"}
          </p>
          {coverageQuery.isFetching ? <small className="muted-copy">Dato del último corte; se está actualizando.</small> : null}
          <Table
            rows={fuentes}
            rowKey={(source) => source.code}
            empty="No hay fuentes definidas para el legajo."
            columns={[
              { key: "source", header: "Fuente", render: (source) => <strong>{nombreFuente(source)}</strong> },
              { key: "state", header: "Estado", render: (source) => <StatusBadge status={estadoFuente(source).status} label={estadoFuente(source).label} /> },
              {
                key: "manage",
                header: "",
                align: "right",
                render: (source) => (
                  <Button size="sm" variant="secondary" aria-label={`Gestionar ${nombreFuente(source)}`} onClick={() => {
                    setSourceCode(source.code);
                    setSourceFile(null);
                    setFuenteAbierta(source.code);
                  }}>
                    Gestionar
                  </Button>
                ),
              },
            ]}
          />
          <PanelGestionarFuente
            source={fuenteSeleccionada}
            workpaperId={workpaperId}
            isOpen={Boolean(fuenteSeleccionada)}
            onClose={() => setFuenteAbierta(null)}
            onAbrirLibroIva={onAbrirLibroIva}
            sourceFile={sourceCode === fuenteAbierta ? sourceFile : null}
            setSourceFile={setSourceFile}
            sourceUploadMutation={sourceUploadMutation}
            sources={fuentes}
            canEdit={puedeCargar && !motivoImportarLibro}
            calculado={calculado}
            currentUserId={currentUserId}
            allowSelfReview={coverageQuery.data.allowSelfReview}
            canReview={capabilities.has("tax.vouchers.review")}
            canEditSources={puedeCargar}
            reviewSourceMutation={reviewSourceMutation}
            editReason={soloLectura ? "Esta revisión se consulta en solo lectura." : motivoImportarLibro ?? (!capabilities.has("tax.vouchers.prepare") ? "No tenés permiso para cargar archivos." : !canEditSources ? "El legajo no admite cambios en su estado actual." : null)}
            noMovementsMutation={noMovementsMutation}
            puedeMarcarSinMovimientos={!motivoSinMovimientos}
            motivoSinMovimientos={motivoSinMovimientos}
            onCambiarFuente={(codigo) => {
              setSourceCode(codigo);
              setSourceFile(null);
              setFuenteAbierta(codigo);
            }}
          />
        </>
      )}
    </div>
  );
}
