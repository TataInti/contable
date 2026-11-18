// Etapa Saldos del Legajo: saldos a favor y arrastres, con carga, error y vacío (Foco 2.3b-2).
import type { Dispatch, SetStateAction } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { AsyncState, Button, Table } from "@contable/design-system";
import { formatMoney } from "../formato";
import { formatearFechaHora } from "../../../lib/formatoFechas";
import type { CreditLot } from "../tipos";
import { identificadorCorto, pluralizar } from "../textos";

export interface FormularioEditarSaldo {
  reference: string;
  evidenceDocumentId: string;
  originalAmount: string;
}

export interface EtapaSaldosProps {
  capabilities: ReadonlySet<string>;
  ledgerQuery: UseQueryResult<CreditLot[], Error>;
  setEditingLot: Dispatch<SetStateAction<CreditLot | null>>;
  setEditForm: Dispatch<SetStateAction<FormularioEditarSaldo>>;
}

export function EtapaSaldos({
  capabilities,
  ledgerQuery,
  setEditingLot,
  setEditForm,
}: EtapaSaldosProps) {
  const puedeCargarSaldo = capabilities.has("tax.settlements.calculate");
  return (
    <div className="workpaper-stage">
      <p className="muted-copy">
        Disponibles por impuesto, régimen y jurisdicción. Cada saldo conserva su respaldo.
      </p>
      {ledgerQuery.isError ? (
        <AsyncState
          loading={false}
          error
          errorTitle="No se pudieron leer los saldos"
          errorDescription="Reintentá la lectura. Hasta que responda, la etapa no muestra saldos."
          onRetry={() => void ledgerQuery.refetch()}
          loadingLabel="Cargando saldos…"
        />
      ) : !ledgerQuery.isSuccess ? (
        <AsyncState
          loading
          error={false}
          errorTitle=""
          errorDescription=""
          onRetry={() => void ledgerQuery.refetch()}
          loadingLabel="Cargando saldos…"
        />
      ) : (
        <>
          {ledgerQuery.isFetching ? (
            <small className="muted-copy">Dato del último corte; se está actualizando.</small>
          ) : null}
          <Table<CreditLot>
            rows={ledgerQuery.data}
            rowKey={(lot) => lot.id}
            empty="No hay saldos a favor disponibles para este cliente."
            columns={[
              {
                key: "kind",
                header: "Saldo",
                render: (lot) => (
                  <>
                    <strong>{lot.kind.replaceAll("_", " ")}</strong>
                    <br />
                    <small>{pluralizar(lot.movements.length, "movimiento", "movimientos")}</small>
                  </>
                ),
              },
              {
                key: "scope",
                header: "Alcance",
                render: (lot) => (lot.regimeId ? "Régimen específico" : "Impuesto"),
              },
              {
                key: "original",
                header: "Original",
                align: "right",
                render: (lot) => formatMoney(lot.originalAmount),
              },
              {
                key: "available",
                header: "Disponible",
                align: "right",
                render: (lot) => <strong>{formatMoney(lot.available)}</strong>,
              },
              {
                key: "movements",
                header: "Movimientos",
                render: (lot) =>
                  lot.movements.length === 0 ? (
                    "Sin aplicaciones"
                  ) : (
                    <details className="workpaper-credit-movements">
                      <summary>
                        {pluralizar(lot.movements.length, "movimiento", "movimientos")}
                      </summary>
                      <ul>
                        {lot.movements.map((movement) => (
                          <li key={movement.id}>
                            <span>{movement.kind.replaceAll("_", " ")}</span>
                            <strong>{formatMoney(movement.amount)}</strong>
                            {movement.reference ? <small>{movement.reference}</small> : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ),
              },
              {
                key: "evidence",
                header: "Respaldo",
                render: (lot) =>
                  typeof lot.reference === "string" ? (
                    <span title={lot.reference}>{identificadorCorto(lot.reference)}</span>
                  ) : lot.evidenceDocumentId ? (
                    "Documentado"
                  ) : lot.createdBy ? (
                    `Carga manual · ${lot.createdBy.name}`
                  ) : (
                    "Cierre de liquidación"
                  ),
              },
              {
                key: "log",
                header: "Log",
                render: (lot) =>
                  !lot.history || lot.history.length === 0 ? (
                    <span className="muted-copy">Sin cambios</span>
                  ) : (
                    <details className="workpaper-credit-log">
                      <summary>{pluralizar(lot.history.length, "cambio", "cambios")}</summary>
                      <ul>
                        {lot.history.map((entry) => (
                          <li key={entry.id}>
                            <span>
                              {entry.createdBy?.name ?? "Usuario"} ·{" "}
                              {formatearFechaHora(entry.createdAt)}
                            </span>
                            <ul className="workpaper-credit-log__changes">
                              {Object.entries(entry.changes ?? {}).map(([field, diff]) => (
                                <li key={field}>
                                  <strong>{field}</strong>: {diff?.from ?? "—"} → {diff?.to ?? "—"}
                                </li>
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ),
              },
              {
                key: "actions",
                header: "",
                align: "right",
                render: (lot) =>
                  puedeCargarSaldo ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingLot(lot);
                        setEditForm({
                          reference: lot.reference ?? "",
                          evidenceDocumentId: lot.evidenceDocumentId ?? "",
                          originalAmount: lot.originalAmount ?? "",
                        });
                      }}
                    >
                      Editar
                    </Button>
                  ) : null,
              },
            ]}
          />
        </>
      )}
    </div>
  );
}
