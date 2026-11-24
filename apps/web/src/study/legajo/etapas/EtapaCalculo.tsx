// Etapa Cálculo del Legajo: determinación por obligación y posición fiscal del período, con sus acciones (Foco 2.3c).
import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { AsyncState, Button, EmptyState, MoneyField, Table } from "@contable/design-system";
import { StatusBadge } from "../../../ui/StatusBadge";
import { calculationLabel } from "../etiquetas";
import { esPedidoDeCambios, formatMoney } from "../formato";
import { formatearFecha } from "../../../lib/formatoFechas";
import type { PositionAction, TaxPosition, WorkpaperCalculationComponent } from "../tipos";
import { WorkpaperActionError } from "../WorkpaperActionError";
import { pluralizar } from "../textos";
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
  setPositionAction: Dispatch<SetStateAction<PositionAction>>;
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
  setPositionAction,
  seleccion,
  onSeleccionChange,
  bloqueoSeleccion = null,
}: EtapaCalculoProps) {
  const determinacion = calculationQuery.data ?? [];

  return (
    <div className="workpaper-stage">
      <p className="muted-copy">
        Devengado fiscal, pagos e intereses sin mezclarlo con el resultado gerencial.
      </p>
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
                {marcado && component.usaMinimoDeclarado ? (
                  <MoneyField
                    label="Mínimo del mes"
                    name={`minimo-${component.obligationId}`}
                    disabled={Boolean(bloqueoSeleccion)}
                    value={valor}
                    error={error ?? undefined}
                    hint={
                      component.minimoAnterior
                        ? `El mes anterior usaste ${formatMoney(component.minimoAnterior.amount)}. No se aplica solo.`
                        : "Dejalo vacío si no corresponde mínimo: en ese caso no se aplica ninguno."
                    }
                    onChange={(nuevo) =>
                      onSeleccionChange({
                        ...seleccion,
                        minimums: { ...seleccion.minimums, [component.obligationId]: nuevo },
                      })
                    }
                  />
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}
      <div className="workpaper-calculation-breakdown">
        <div className="workpaper-stage__heading workpaper-stage__heading--subsection">
          <div>
            <strong>Determinación y trazabilidad del cálculo</strong>
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
            {determinacion.map((component) => (
              <article className="workpaper-calculation" key={component.obligationId}>
                <div className="workpaper-calculation__header">
                  <span>
                    <strong>
                      {component.obligation.taxTypeName} · {component.obligation.regimeName}
                    </strong>
                    <small>{component.obligation.jurisdictionName}</small>
                  </span>
                  {component.settlement ? (
                    <span>
                      <StatusBadge status={component.settlement.status} />
                    </span>
                  ) : (
                    <StatusBadge status="PENDING" />
                  )}
                </div>
                {!seleccionDeImpuesto(seleccion, component.obligationId) ? (
                  <p className="muted-copy">No liquidado este mes.</p>
                ) : component.settlement ? (
                  <>
                    <dl className="workpaper-calculation__totals">
                      {Object.entries(component.settlement.totals ?? {})
                        .filter(([concept]) => calculationLabel(concept) !== null)
                        .map(([concept, amount]) => (
                          <div
                            className={concept === "TOTAL_A_INGRESAR" ? "is-total" : ""}
                            key={concept}
                          >
                            <dt>{calculationLabel(concept)}</dt>
                            <dd>{formatMoney(amount)}</dd>
                          </div>
                        ))}
                    </dl>
                    <ul className="workpaper-calculation__formula">
                      {lineasDeFormula(component).map((linea) => (
                        <li key={linea}>{linea}</li>
                      ))}
                    </ul>
                    {component.settlement.f931Inputs.length > 0 ? (
                      <p className="workpaper-calculation__source-note">
                        F.931 revisado · remuneración neta{" "}
                        {formatMoney(
                          String(
                            component.settlement.f931Inputs[0]?.snapshot["netRemuneration"] ?? 0,
                          ),
                        )}
                      </p>
                    ) : null}
                    <details className="workpaper-calculation__trace">
                      <summary>
                        Ver{" "}
                        {pluralizar(
                          component.settlement.lines.length,
                          "línea de cálculo",
                          "líneas de cálculo",
                        )}
                      </summary>
                      <Table<(typeof component.settlement.lines)[number]>
                        rows={component.settlement.lines}
                        rowKey={(line) => line.id}
                        empty={
                          <EmptyState size="inline" title="La liquidación no generó líneas." />
                        }
                        columns={[
                          {
                            key: "concept",
                            header: "Concepto",
                            render: (line) => line.concept.replaceAll("_", " "),
                          },
                          {
                            key: "formula",
                            header: "Fórmula / fuente",
                            render: (line) => line.formula ?? "—",
                          },
                          {
                            key: "amount",
                            header: "Importe",
                            align: "right",
                            render: (line) => <strong>{formatMoney(line.amount)}</strong>,
                          },
                        ]}
                      />
                    </details>
                    {component.settlement.differences.some((d) => !esPedidoDeCambios(d)) ? (
                      <div className="workpaper-calculation__differences">
                        {component.settlement.differences
                          .filter((difference) => !esPedidoDeCambios(difference))
                          .map((difference) => (
                            <p key={difference.id}>
                              <StatusBadge status={difference.severity} />
                              <span>
                                <strong>{difference.code}</strong> · {difference.message}
                              </span>
                            </p>
                          ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="muted-copy">El detalle se genera cuando el legajo se calcula.</p>
                )}
              </article>
            ))}
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
                    ) : position.settlement?.status === "FINALIZED" &&
                      capabilities.has("tax.filings.record") ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setPositionAction({ kind: "FILING", position });
                        }}
                      >
                        Registrar presentación
                      </Button>
                    ) : null}
                    {position.filedAt ? (
                      capabilities.has("tax.filings.record") ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setPositionAction({ kind: "DECLARATION", position });
                          }}
                        >
                          {position.hasDeclaration
                            ? "Corregir declaración jurada"
                            : "Cargar declaración jurada"}
                        </Button>
                      ) : (
                        <span className="muted-copy">
                          {position.hasDeclaration
                            ? `Declaración jurada cargada · total a pagar ${formatMoney(position.totalAPagar)}`
                            : "Falta la declaración jurada: la carga el Titular, el Administrador o el Revisor."}
                        </span>
                      )
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
                    {Number(position.totalPayable) > 0 &&
                    capabilities.has("tax.payments.record") ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setPositionAction({ kind: "PAYMENT", position });
                        }}
                      >
                        Registrar pago
                      </Button>
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
