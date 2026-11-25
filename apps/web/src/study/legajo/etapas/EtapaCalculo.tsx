// Etapa Cálculo del Legajo: determinación por obligación y posición fiscal del período, con sus acciones (Foco 2.3c).
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { AsyncState, Button, EmptyState, MoneyField, Table } from "@contable/design-system";
import { StatusBadge } from "../../../ui/StatusBadge";
import { formatMoney, esPedidoDeCambios } from "../formato";
import { formatearFecha } from "../../../lib/formatoFechas";
import type { TaxPosition, WorkpaperCalculationComponent } from "../tipos";
import { WorkpaperActionError } from "../WorkpaperActionError";

import {
  alternarImpuesto,
  errorMinimo,
  lineasDeFormula,
  seleccionDeImpuesto,
  type SeleccionCalculo,
} from "./seleccionCalculo";

export interface EtapaCalculoProps {
  capabilities: ReadonlySet<string>;
  workpaperId: string;
  calculationQuery: UseQueryResult<WorkpaperCalculationComponent[], Error>;
  positionQuery: UseQueryResult<TaxPosition[], Error>;
  calculateInterestMutation: UseMutationResult<
    unknown,
    Error,
    { workpaperId: string; obligationId: string }
  >;
  /** Impuestos marcados para liquidar este mes y mínimos cargados. */
  seleccion: SeleccionCalculo;
  onSeleccionChange: (seleccion: SeleccionCalculo) => void;
  /** 4K: motivo por el que la selección no puede cambiar (p. ej. en revisión); deshabilita los campos. */
  bloqueoSeleccion?: string | null;
}

export function EtapaCalculo({
  capabilities,
  workpaperId,
  calculationQuery,
  positionQuery,
  calculateInterestMutation,
  seleccion,
  onSeleccionChange,
  bloqueoSeleccion = null,
}: EtapaCalculoProps) {
  const determinacion = calculationQuery.data ?? [];
  const conceptos = [
    { label: "Base imponible", keys: ["BASE_TOTAL", "BASE_PAIS", "BASE_IMPONIBLE"] },
    { label: "Impuesto por actividad", keys: ["IMPUESTO_POR_ACTIVIDAD", "IMPUESTO_POR_JURISDICCION"] },
    { label: "Mínimo aplicado", keys: ["MINIMO_APLICADO"] },
    { label: "Impuesto determinado", keys: ["IMPUESTO_DETERMINADO"] },
    { label: "Percepciones", keys: ["PERCEPCIONES", "PERCEPCIONES_SUFRIDAS"] },
    { label: "Retenciones", keys: ["RETENCIONES", "RETENCIONES_SUFRIDAS"] },
    { label: "Recaudaciones bancarias", keys: ["RECAUDACIONES"] },
    { label: "Saldo a favor anterior", keys: ["SALDO_ANTERIOR", "SALDO_TECNICO_ANTERIOR", "SALDO_LIBRE_ANTERIOR"] },
    { label: "Otros créditos", keys: ["OTROS_CREDITOS", "CREDITO_DTO_814", "CREDITOS_SEGUNDO_PARRAFO"] },
    { label: "Total a ingresar", keys: ["TOTAL_A_INGRESAR"] },
  ];
  const filasDeterminacion = conceptos.map((concepto) => ({
    label: concepto.label,
    amounts: Object.fromEntries(determinacion.map((component) => {
      const totals = component.settlement?.totals ?? {};
      const key = concepto.keys.find((candidate) => Object.hasOwn(totals, candidate))
        ?? (concepto.label === "Total a ingresar" ? Object.keys(totals).find((candidate) => candidate.startsWith("TOTAL_A_INGRESAR")) : undefined);
      return [component.obligationId, component.settlement ? key ? totals[key] ?? "0" : "0" : null];
    })),
  }));

  return (
    <div className="workpaper-stage">
      {calculationQuery.isSuccess && determinacion.length > 0 ? (
        <section className="workpaper-calculation-selection">
          <div className="workpaper-stage__heading workpaper-stage__heading--subsection">
            <div>
              <strong>Impuestos a liquidar este mes</strong>
              <small>
                Por defecto, los que liquidaste el mes anterior. Los no marcados quedan sin calcular.
              </small>
            </div>
          </div>
          {bloqueoSeleccion ? (
            <small className="muted-copy" role="status">
              {bloqueoSeleccion}
            </small>
          ) : null}
          {determinacion.map((component) => {
            const marcado = seleccionDeImpuesto(seleccion, component.obligationId);
            const valor = seleccion.minimums[component.obligationId] ?? "";
            const error = marcado ? errorMinimo(valor) : null;
            return (
              <div className="workpaper-calculation-selection__row" key={`sel-${component.obligationId}`}>
                <label>
                  <input
                    type="checkbox"
                    disabled={Boolean(bloqueoSeleccion)}
                    checked={marcado}
                    onChange={(event) =>
                      onSeleccionChange(
                        alternarImpuesto(seleccion, component.obligationId, event.target.checked),
                      )
                    }
                  />
                  <span>
                    {component.obligation.taxTypeName} · {component.obligation.regimeName} ·{" "}
                    {component.obligation.jurisdictionName}
                  </span>
                </label>
                {!marcado ? <small className="muted-copy">No liquidado este mes.</small> : null}
                {marcado && component.usaMinimoDeclarado ? (
                  <div className="workpaper-calculation-minimum">
                    <MoneyField
                      label="Mínimo del mes"
                      name={`minimo-${component.obligationId}`}
                      disabled={Boolean(bloqueoSeleccion)}
                      value={valor}
                      error={error ?? undefined}
                      hint={component.minimoAnterior ? `El mes anterior usaste ${formatMoney(component.minimoAnterior.amount)}. No se aplica solo.` : undefined}
                      onChange={(nuevo) =>
                        onSeleccionChange({
                          ...seleccion,
                          minimums: { ...seleccion.minimums, [component.obligationId]: nuevo },
                        })
                      }
                    />
                    <span className="workpaper-help-mark" title="Dejalo vacío si no corresponde mínimo: en ese caso no se aplica ninguno." aria-label="Ayuda sobre el mínimo del mes">?</span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}
      <div className="workpaper-calculation-breakdown">
        <div className="workpaper-stage__heading workpaper-stage__heading--subsection">
          <div>
            <strong>Determinación</strong>
            <small>
              Totales, fórmulas, alícuotas y versión de reglas congeladas por obligación.
            </small>
          </div>
        </div>
        {calculationQuery.isError ? (
          <AsyncState
            loading={false}
            error
            errorTitle="No se pudo leer la determinación"
            errorDescription="Reintentá la lectura. Hasta que responda, la etapa no muestra cálculos por obligación."
            onRetry={() => void calculationQuery.refetch()}
            loadingLabel="Cargando determinación…"
          />
        ) : !calculationQuery.isSuccess ? (
          <AsyncState
            loading
            error={false}
            errorTitle=""
            errorDescription=""
            onRetry={() => void calculationQuery.refetch()}
            loadingLabel="Cargando determinación…"
          />
        ) : determinacion.length === 0 ? (
          <EmptyState size="inline" title="No hay obligaciones vinculadas al legajo." />
        ) : (
          <>
            {calculationQuery.isFetching ? (
              <small className="muted-copy">Dato del último corte; se está actualizando.</small>
            ) : null}
            <Table<(typeof filasDeterminacion)[number]>
              rows={filasDeterminacion}
              rowKey={(row) => row.label}
              empty={<EmptyState size="inline" title="No hay conceptos para mostrar." />}
              columns={[
                { key: "concept", header: "Concepto", render: (row) => row.label === "Total a ingresar" ? <strong>{row.label}</strong> : row.label },
                ...determinacion.map((component) => ({
                  key: component.obligationId,
                  header: <span>{component.obligation.taxTypeName}<small className="muted-copy"> · {component.obligation.jurisdictionName}</small><small><StatusBadge status={component.settlement?.status ?? "PENDING"} /></small></span>,
                  align: "right" as const,
                  render: (row: (typeof filasDeterminacion)[number]) => {
                    const amount = row.amounts[component.obligationId];
                    if (!seleccionDeImpuesto(seleccion, component.obligationId) || amount === null) return <span className="muted-copy">—</span>;
                    const importe = formatMoney(amount ?? "0");
                    return row.label === "Total a ingresar" ? <strong>{importe}</strong> : <span className={`workpaper-calculation__amount${Number(amount) === 0 ? " workpaper-calculation__amount--zero" : ""}`}>{importe}</span>;
                  },
                })),
              ]}
            />
            {determinacion.map((component) => component.settlement ? (
              <details className="workpaper-calculation__trace" key={`formula-${component.obligationId}`}>
                <summary>Ver cómo se calculó · {component.obligation.taxTypeName}</summary>
                <small className="muted-copy">Versión de reglas {component.settlement.engineVersion}</small>
                <ul className="workpaper-calculation__formula">
                  {lineasDeFormula(component).map((linea) => <li key={linea}>{linea}</li>)}
                </ul>
                {component.settlement.f931Inputs.length ? <p className="workpaper-calculation__source-note">F.931 revisado · remuneración neta {formatMoney(String(component.settlement.f931Inputs[0]?.snapshot["netRemuneration"] ?? 0))}</p> : null}
                {component.settlement.differences.some((difference) => !esPedidoDeCambios(difference)) ? <div className="workpaper-calculation__differences">
                  {component.settlement.differences.filter((difference) => !esPedidoDeCambios(difference)).map((difference) => <p key={difference.id}><StatusBadge status={difference.severity} /><span><strong>{difference.code}</strong> · {difference.message}</span></p>)}
                </div> : null}
                {component.settlement.lines.length ? <Table<(typeof component.settlement.lines)[number]>
                  rows={component.settlement.lines}
                  rowKey={(line) => line.id}
                  empty={<EmptyState size="inline" title="La liquidación no generó líneas." />}
                  columns={[
                    { key: "concept", header: "Concepto", render: (line) => line.concept.replaceAll("_", " ") },
                    { key: "formula", header: "Fórmula / fuente", render: (line) => line.formula ?? "—" },
                    { key: "amount", header: "Importe", align: "right", render: (line) => <strong>{formatMoney(line.amount)}</strong> },
                  ]}
                /> : null}
              </details>
            ) : null)}
          </>
        )}
      </div>
      {positionQuery.isError ? (
        <AsyncState
          loading={false}
          error
          errorTitle="No se pudo leer la posición fiscal"
          errorDescription="Reintentá la lectura. Hasta que responda, la etapa no muestra importes ni acciones."
          onRetry={() => void positionQuery.refetch()}
          loadingLabel="Calculando posición…"
        />
      ) : !positionQuery.isSuccess ? (
        <AsyncState
          loading
          error={false}
          errorTitle=""
          errorDescription=""
          onRetry={() => void positionQuery.refetch()}
          loadingLabel="Calculando posición…"
        />
      ) : (
        <>
          {positionQuery.isFetching ? (
            <small className="muted-copy">Dato del último corte; se está actualizando.</small>
          ) : null}
          <Table<TaxPosition>
            className="workpaper-position-table"
            rows={positionQuery.data ?? []}
            rowKey={(position) => position.obligationId}
            empty={
              <EmptyState
                size="inline"
                title="No hay obligaciones fiscales para el período seleccionado."
              />
            }
            columns={[
              {
                key: "tax",
                header: "Impuesto",
                render: (position) => (
                  <>
                    <strong>
                      {position.regime.taxType.name}
                      {!position.regime.taxType.isActive ? " (oculto)" : ""}
                    </strong>
                    <br />
                    <small>
                      {position.regime.name}
                      {!position.regime.isActive ? " (oculto)" : ""} ·{" "}
                      {position.regime.jurisdiction.name}
                      {!position.regime.jurisdiction.isActive ? " (oculto)" : ""}
                    </small>
                  </>
                ),
              },
              {
                key: "dueDate",
                header: "Vencimiento",
                render: (position) => formatearFecha(position.dueDate, "Sin vencimiento"),
              },
              {
                key: "accrued",
                header: "Devengado",
                align: "right",
                render: (position) => formatMoney(position.accrued),
              },
              {
                key: "interest",
                header: "Interés",
                align: "right",
                render: (position) => formatMoney(position.interest),
              },
              {
                key: "paid",
                header: "Pagado",
                align: "right",
                render: (position) => formatMoney(position.paid),
              },
              {
                key: "pending",
                header: "Pendiente",
                align: "right",
                render: (position) => <strong>{formatMoney(position.pending)}</strong>,
              },
              {
                key: "totalPayable",
                header: "Total a pagar",
                align: "right",
                render: (position) => <strong>{formatMoney(position.totalPayable)}</strong>,
              },
              {
                key: "credit",
                header: "Disponible",
                align: "right",
                render: (position) => formatMoney(position.availableCredit),
              },
              {
                key: "status",
                header: "Estado",
                render: (position) => <StatusBadge status={position.status} />,
              },
              {
                key: "actions",
                header: "Acciones",
                render: (position) => (
                  <span className="study-table__actions">
                    {position.filedAt ? (
                      <span className="muted-copy">
                        Presentada el {formatearFecha(position.filedAt, "Sin vencimiento")}
                      </span>
                    ) : null}
                    {Number(position.pending) > 0 &&
                    position.dueDate &&
                    new Date(position.dueDate) < new Date() &&
                    position.settlement?.status === "FINALIZED" &&
                    capabilities.has("tax.payments.record") ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={calculateInterestMutation.isPending}
                          onClick={() =>
                            calculateInterestMutation.mutate({
                              workpaperId,
                              obligationId: position.obligationId,
                            })
                          }
                        >
                          Calcular mora
                        </Button>
                        <WorkpaperActionError
                          error={
                            calculateInterestMutation.variables?.obligationId ===
                            position.obligationId
                              ? calculateInterestMutation.error
                              : null
                          }
                        />
                      </>
                    ) : null}
                  </span>
                ),
              },
            ]}
          />
        </>
      )}
    </div>
  );
}
