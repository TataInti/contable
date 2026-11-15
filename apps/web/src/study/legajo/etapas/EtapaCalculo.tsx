// Etapa Cálculo del Legajo: determinación por obligación y posición fiscal del período, con sus acciones (Foco 2.3c).
import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { Button, Table } from "@contable/design-system";
import { StatusBadge } from "../../../ui/StatusBadge";
import { calculationLabel } from "../etiquetas";
import { formatDate, formatMoney } from "../formato";
import type { PositionAction, TaxPosition, WorkpaperCalculationComponent } from "../tipos";
import { WorkpaperActionError } from "../WorkpaperActionError";

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
}

export function EtapaCalculo({
  capabilities,
  workpaperId,
  calculationQuery,
  positionQuery,
  calculateInterestMutation,
  setPositionAction,
}: EtapaCalculoProps) {
  return (
    <div className="workpaper-stage">
      <div className="workpaper-stage__heading">
        <div>
          <strong>Posición fiscal del período</strong>
          <small>
            Devengado fiscal, pagos e intereses sin mezclarlo con el resultado gerencial.
          </small>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void positionQuery.refetch()}>
          Actualizar posición
        </Button>
      </div>
      <div className="workpaper-calculation-breakdown">
        <div className="workpaper-stage__heading workpaper-stage__heading--subsection">
          <div>
            <strong>Determinación y trazabilidad del cálculo</strong>
            <small>
              Totales, fórmulas, alícuotas y versión de reglas congeladas por obligación.
            </small>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void calculationQuery.refetch()}>
            Actualizar cálculo
          </Button>
        </div>
        {calculationQuery.isLoading ? (
          <p className="muted-copy">Cargando determinación…</p>
        ) : (
          (calculationQuery.data ?? []).map((component) => (
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
              {component.settlement ? (
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
                    <summary>Ver {component.settlement.lines.length} línea(s) de cálculo</summary>
                    <Table<(typeof component.settlement.lines)[number]>
                      rows={component.settlement.lines}
                      rowKey={(line) => line.id}
                      empty="La liquidación no generó líneas."
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
                  {component.settlement.differences.length > 0 ? (
                    <div className="workpaper-calculation__differences">
                      {component.settlement.differences.map((difference) => (
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
          ))
        )}
      </div>
      {positionQuery.isLoading ? (
        <p className="muted-copy">Calculando posición…</p>
      ) : (
        <>
          <Table<TaxPosition>
            rows={positionQuery.data ?? []}
            rowKey={(position) => position.obligationId}
            empty="No hay obligaciones fiscales para el período seleccionado."
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
                render: (position) => formatDate(position.dueDate),
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
                header: "A favor",
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
                        Presentada el {formatDate(position.filedAt)}
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
