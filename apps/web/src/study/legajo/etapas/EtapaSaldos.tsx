// Etapa Saldos del Legajo: saldos a favor y arrastres, con carga, error y vacío (Foco 2.3b-2).
import type { Dispatch, SetStateAction } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { AsyncState, Button, Table } from "@contable/design-system";
import { formatMoney } from "../formato";
import { formatearFechaHora } from "../../../lib/formatoFechas";
import type { CreditLot } from "../tipos";
import { identificadorCorto, pluralizar } from "../textos";
import { fraseDeArrastre, saldosDeMesesAnteriores } from "../saldosArrastre";

export interface FormularioEditarSaldo {
  reference: string;
  evidenceDocumentId: string;
  originalAmount: string;
  /** Motivo del cambio de importe: obligatorio cuando el importe cambia; queda en el historial. */
  motivo: string;
}

export interface EtapaSaldosProps {
  capabilities: ReadonlySet<string>;
  ledgerQuery: UseQueryResult<CreditLot[], Error>;
  setEditingLot: Dispatch<SetStateAction<CreditLot | null>>;
  setEditForm: Dispatch<SetStateAction<FormularioEditarSaldo>>;
  /** Frase de guía de una revisión anterior: va en el mismo párrafo que la de Saldos (Barra 2e). */
  fraseRevision?: string;
  /** Inicio del mes del legajo (ISO): los saldos de meses anteriores se muestran como arrastre. */
  periodoInicio?: string;
  /** Si el mes anterior tiene legajo finalizado. undefined mientras se consulta. */
  mesAnteriorCerrado?: boolean;
  /** El legajo del mes está finalizado: un saldo de ese mes se cambia rectificando la liquidación. */
  legajoFinalizado?: boolean;
}

export function EtapaSaldos({
  capabilities,
  ledgerQuery,
  setEditingLot,
  setEditForm,
  fraseRevision,
  periodoInicio,
  mesAnteriorCerrado,
  legajoFinalizado = false,
}: EtapaSaldosProps) {
  const puedeCargarSaldo = capabilities.has("tax.settlements.calculate");
  const arrastrados =
    periodoInicio && ledgerQuery.isSuccess
      ? saldosDeMesesAnteriores(ledgerQuery.data, periodoInicio)
      : [];
  return (
    <div className="workpaper-stage">
      <p className="muted-copy">
        {fraseRevision ? `${fraseRevision} ` : null}
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
          {legajoFinalizado ? (
            <p className="muted-copy">
              Este mes está finalizado: para cambiar un saldo, rectificá la liquidación.
            </p>
          ) : null}
          {arrastrados.length > 0 ? (
            <ul className="workpaper-carry" aria-label="Saldos que vienen de meses anteriores">
              {arrastrados.map((lot) => (
                <li key={lot.id}>{fraseDeArrastre(lot)}</li>
              ))}
            </ul>
          ) : null}
          {mesAnteriorCerrado === false ? (
            <p className="muted-copy">
              El mes anterior no está cerrado: cargá el saldo a mano o cerralo primero.
            </p>
          ) : mesAnteriorCerrado === true && arrastrados.length === 0 ? (
            <p className="muted-copy">Sin saldo a favor del mes anterior.</p>
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
                header: "Monto vigente",
                align: "right",
                render: (lot) => formatMoney(lot.importeVigente ?? lot.originalAmount),
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
                header: "Historial",
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
                      disabled={legajoFinalizado}
                      onClick={() => {
                        setEditingLot(lot);
                        setEditForm({
                          reference: lot.reference ?? "",
                          evidenceDocumentId: lot.evidenceDocumentId ?? "",
                          originalAmount: lot.importeVigente ?? lot.originalAmount ?? "",
                          motivo: "",
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
