// Etapa Saldos del Legajo: saldos a favor y arrastres, con carga, error y vacío (Foco 2.3b-2).
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { AsyncState, Button, Table } from "@contable/design-system";
import { formatMoney } from "../formato";
import { formatearFechaHora, formatearMes } from "../../../lib/formatoFechas";
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
  /** Abre el mes anterior (si el cliente lo tiene como período fiscal); sin él no se ofrece el enlace. */
  onIrAlMesAnterior?: () => void;
}

const CIERRE_CON_ID = /^Cierre [0-9a-f]{8}-[0-9a-f-]{27} · versión (\d+)$/i;

/** «Cierre de septiembre de 2026 · v1» en lugar del identificador interno del cierre. */
function respaldoDeCierre(lot: CreditLot): { texto: string; titulo: string } | null {
  if (typeof lot.reference !== "string") return null;
  const version = CIERRE_CON_ID.exec(lot.reference)?.[1];
  if (version && lot.period) {
    const mes = formatearMes(lot.period.startDate.slice(0, 10));
    return { texto: `Cierre de ${mes} · v${version}`, titulo: lot.reference };
  }
  return { texto: identificadorCorto(lot.reference), titulo: lot.reference };
}

const esSinImporte = (lot: CreditLot) =>
  Number(lot.available) === 0 &&
  Number(lot.importeVigente ?? lot.originalAmount) === 0 &&
  lot.movements.length === 0 &&
  (lot.history ?? []).length === 0;

/** Mes anterior al del legajo, en palabras («septiembre de 2026»). */
function nombreMesAnterior(periodoInicio: string | undefined): string {
  if (!periodoInicio) return "el mes anterior";
  const anterior = new Date(
    Date.UTC(Number(periodoInicio.slice(0, 4)), Number(periodoInicio.slice(5, 7)) - 2, 1),
  );
  return formatearMes(anterior.toISOString().slice(0, 10));
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
  onIrAlMesAnterior,
}: EtapaSaldosProps) {
  const puedeCargarSaldo = capabilities.has("tax.settlements.calculate");
  const arrastrados =
    periodoInicio && ledgerQuery.isSuccess
      ? saldosDeMesesAnteriores(ledgerQuery.data, periodoInicio)
      : [];
  const lotes = ledgerQuery.data ?? [];
  const lotesConImporte = lotes.filter((lot) => !esSinImporte(lot));
  const lotesSinImporte = lotes.filter(esSinImporte);
  const hayHistorial = lotes.some((lot) => (lot.history ?? []).length > 0);

  // Un solo aviso de estado: un mes finalizado ya no admite cambios, así que no habla del mes anterior.
  let avisoDeEstado: ReactNode = null;
  if (legajoFinalizado) {
    avisoDeEstado = "Este mes está finalizado: para cambiar un saldo, rectificá la liquidación.";
  } else if (mesAnteriorCerrado === false) {
    avisoDeEstado = (
      <>
        El mes anterior no está cerrado: cargá el saldo a mano o cerralo primero.
        {onIrAlMesAnterior ? (
          <>
            {" "}
            <Button size="sm" variant="text" onClick={onIrAlMesAnterior}>
              Ir al cierre de {nombreMesAnterior(periodoInicio)}
            </Button>
          </>
        ) : null}
      </>
    );
  } else if (mesAnteriorCerrado === true && arrastrados.length === 0) {
    avisoDeEstado = "Sin saldo a favor del mes anterior.";
  }

  const tabla = (rows: CreditLot[]) => (
    <Table<CreditLot>
      rows={rows}
      rowKey={(lot) => lot.id}
      empty="No hay saldos a favor disponibles para este cliente."
      columns={[
        {
          key: "kind",
          header: "Impuesto",
          render: (lot) => (
            <>
              <strong>{lot.taxType?.name ?? lot.kind.replaceAll("_", " ")}</strong>
              {lot.taxType ? (
                <>
                  <br />
                  <small>{lot.kind.replaceAll("_", " ").toLocaleLowerCase("es-AR")}</small>
                </>
              ) : null}
              {lot.movements.length > 0 ? (
                <details className="workpaper-credit-movements">
                  <summary>{pluralizar(lot.movements.length, "movimiento", "movimientos")}</summary>
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
              ) : null}
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
          key: "evidence",
          header: "Respaldo",
          render: (lot) => {
            const cierre = respaldoDeCierre(lot);
            return cierre ? (
              <span title={cierre.titulo}>{cierre.texto}</span>
            ) : lot.evidenceDocumentId ? (
              "Documentado"
            ) : lot.createdBy ? (
              `Carga manual · ${lot.createdBy.name}`
            ) : (
              "Cierre de liquidación"
            );
          },
        },
        ...(hayHistorial
          ? [
              {
                key: "log",
                header: "Historial",
                render: (lot: CreditLot) =>
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
            ]
          : []),
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
  );

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
          {arrastrados.length > 0 ? (
            <ul className="workpaper-carry" aria-label="Saldos que vienen de meses anteriores">
              {arrastrados.map((lot) => (
                <li key={lot.id}>{fraseDeArrastre(lot)}</li>
              ))}
            </ul>
          ) : null}
          {avisoDeEstado ? <p className="muted-copy">{avisoDeEstado}</p> : null}
          {lotesConImporte.length > 0 || lotes.length === 0 ? tabla(lotesConImporte) : null}
          {lotesSinImporte.length > 0 ? (
            <details className="workpaper-credit-empty">
              <summary>
                {lotesConImporte.length === 0
                  ? `${pluralizar(lotesSinImporte.length, "saldo", "saldos")} sin importe`
                  : `Ver ${pluralizar(lotesSinImporte.length, "saldo", "saldos")} sin importe`}
              </summary>
              {tabla(lotesSinImporte)}
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}
