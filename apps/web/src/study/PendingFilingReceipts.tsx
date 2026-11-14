import { useQuery } from "@tanstack/react-query";
import { Button } from "@contable/design-system";
import { api } from "../lib/api";
import { DenseFooter, DenseTable, type DenseColumn } from "../ui/Dense";

/**
 * Recordatorio de Inicio: liquidaciones finalizadas que todavía no tienen
 * registrada la presentación con su constancia. El organismo recibe la
 * presentación pero la constancia se baja aparte, y entre muchos clientes
 * se pierde de vista. Sólo se dibuja cuando hay alguna pendiente.
 */

export interface PendingReceipt {
  settlementId: string;
  clientId: string;
  clientName: string;
  taxName: string;
  regimeName: string;
  periodStart: string;
  periodEnd: string;
  finalizedAt: string | null;
  dueDate: string | null;
}

const MONTH = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

function daysSince(value: string | null, now: number): number | null {
  if (!value) return null;
  return Math.max(0, Math.floor((now - new Date(value).getTime()) / 86_400_000));
}

export function PendingFilingReceipts({
  firmId,
  canOpen,
  onOpen,
  now = Date.now(),
}: {
  firmId: string;
  canOpen: (clientId: string) => boolean;
  onOpen: (clientId: string) => void;
  now?: number;
}) {
  const query = useQuery({
    queryKey: ["pending-filing-receipts", firmId],
    queryFn: () => api.get<PendingReceipt[]>(`/firms/${firmId}/portfolio/tax-worklist/pending-receipts`),
  });
  const rows = query.data ?? [];
  if (rows.length === 0) return null;

  const columns: DenseColumn<PendingReceipt>[] = [
    {
      key: "client",
      header: "Cliente",
      sortValue: (row) => row.clientName,
      render: (row) => <strong>{row.clientName}</strong>,
    },
    {
      key: "tax",
      header: "Impuesto",
      sortValue: (row) => row.taxName,
      render: (row) => row.taxName,
    },
    {
      key: "period",
      header: "Período",
      sortValue: (row) => row.periodStart,
      render: (row) => MONTH.format(new Date(row.periodStart)),
    },
    {
      key: "due",
      header: "Vencimiento",
      sortValue: (row) => row.dueDate ?? "",
      render: (row) =>
        row.dueDate ? <span className="tabular-copy">{DAY.format(new Date(row.dueDate))}</span> : "—",
    },
    {
      key: "waiting",
      header: "Finalizada hace",
      align: "right",
      sortValue: (row) => daysSince(row.finalizedAt, now) ?? -1,
      render: (row) => {
        const days = daysSince(row.finalizedAt, now);
        if (days === null) return "—";
        return <span className="tabular-copy">{days === 0 ? "hoy" : days === 1 ? "1 día" : `${days} días`}</span>;
      },
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) =>
        canOpen(row.clientId) ? (
          <Button size="sm" variant="ghost" onClick={() => onOpen(row.clientId)}>
            Abrir legajo
          </Button>
        ) : null,
    },
  ];

  return (
    <section className="dense-block" aria-labelledby="pending-receipts-title">
      <header className="dense-block__head">
        <div className="dense-block__title">
          <h2 id="pending-receipts-title">Falta la constancia de presentación</h2>
          <span className="dense-count dense-count--warn">{rows.length}</span>
        </div>
        <p>Liquidaciones finalizadas sin la presentación registrada con su constancia.</p>
      </header>
      <DenseTable<PendingReceipt>
        label="Constancias de presentación pendientes"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.settlementId}
        footer={
          <DenseFooter
            count={rows.length}
            noun={rows.length === 1 ? "constancia pendiente" : "constancias pendientes"}
            hint="La más antigua primero. Registrá la presentación desde el Legajo del cliente."
            newShortcut={false}
          />
        }
      />
    </section>
  );
}
