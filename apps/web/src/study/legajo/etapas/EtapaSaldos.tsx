// Etapa Saldos del Legajo (Foco 2.3b-1): extraída de renderEtapa sin cambio de marcado.
import type { Dispatch, SetStateAction } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button, Table } from "@contable/design-system";
import { Icon } from "../../../ui/Icon";
import { formatDateTime, formatMoney } from "../formato";
import type { CreditLot } from "../tipos";

export interface FormularioEditarSaldo {
  reference: string;
  evidenceDocumentId: string;
  originalAmount: string;
}

export interface EtapaSaldosProps {
  capabilities: ReadonlySet<string>;
  ledgerQuery: UseQueryResult<CreditLot[], Error>;
  setShowOpening: Dispatch<SetStateAction<boolean>>;
  setEditingLot: Dispatch<SetStateAction<CreditLot | null>>;
  setEditForm: Dispatch<SetStateAction<FormularioEditarSaldo>>;
}

export function EtapaSaldos({
  capabilities,
  ledgerQuery,
  setShowOpening,
  setEditingLot,
  setEditForm,
}: EtapaSaldosProps) {
  return (
    <div className="workpaper-stage">
      <div className="workpaper-stage__heading">
        <div>
          <strong>Saldos a favor y arrastres</strong>
          <small>
            Disponibles por impuesto, régimen y jurisdicción. Cada saldo conserva su respaldo.
          </small>
        </div>
        <span className="workpaper-stage__actions">
          <Button size="sm" variant="ghost" onClick={() => void ledgerQuery.refetch()}>
            Actualizar
          </Button>
          {capabilities.has("tax.settlements.calculate") ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowOpening((visible) => !visible)}
            >
              <Icon name="plus" size={15} /> Cargar saldo inicial
            </Button>
          ) : null}
        </span>
      </div>
      {ledgerQuery.isLoading ? (
        <p className="muted-copy">Cargando saldos…</p>
      ) : (
        <Table<CreditLot>
          rows={ledgerQuery.data ?? []}
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
                  <small>{lot.movements.length} movimiento(s)</small>
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
                    <summary>{lot.movements.length} movimiento(s)</summary>
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
                lot.reference ??
                (lot.evidenceDocumentId
                  ? "Documentado"
                  : lot.createdBy
                    ? `Carga manual · ${lot.createdBy.name}`
                    : "Cierre de liquidación"),
            },
            {
              key: "log",
              header: "Log",
              render: (lot) =>
                !lot.history || lot.history.length === 0 ? (
                  <span className="muted-copy">Sin cambios</span>
                ) : (
                  <details className="workpaper-credit-log">
                    <summary>{lot.history.length} cambio(s)</summary>
                    <ul>
                      {lot.history.map((entry) => (
                        <li key={entry.id}>
                          <span>
                            {entry.createdBy?.name ?? "Usuario"} · {formatDateTime(entry.createdAt)}
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
                capabilities.has("tax.settlements.calculate") ? (
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
      )}
    </div>
  );
}
