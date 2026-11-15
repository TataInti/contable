import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@contable/design-system";
import { api } from "../lib/api";
import { AsyncState } from "../ui/AsyncState";
import { DenseFooter, DenseSection, DenseTable, type DenseColumn } from "../ui/Dense";

/**
 * Recordatorio de Inicio: liquidaciones finalizadas que todavía no tienen
 * registrada la presentación con su constancia. El organismo recibe la
 * presentación pero la constancia se baja aparte, y entre muchos clientes
 * se pierde de vista. Se omite sólo cuando una respuesta confirma que no hay
 * ninguna pendiente: la carga y el error se muestran en su lugar (G05).
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

/** Orden inicial del producto: la más antigua primero (finalizada hace más tiempo). Sin fecha, al final. */
function oldestFirst(rows: PendingReceipt[]): PendingReceipt[] {
  const finished = (row: PendingReceipt) =>
    row.finalizedAt ? new Date(row.finalizedAt).getTime() : Number.MAX_SAFE_INTEGER;
  return [...rows].sort((a, b) => finished(a) - finished(b));
}

const LOADING_LABEL = "Consultando constancias pendientes…";
const ERROR_TITLE = "No se pudo cargar las constancias";
const ERROR_DESCRIPTION = "Reintentá para volver a consultarlas. Las demás fuentes de Inicio siguen disponibles.";

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
  // Vacío confirmado: el bloque se omite, como define #87. Carga y error no son un vacío.
  if (query.isSuccess && query.data.length === 0) return null;

  const rows = query.isSuccess ? oldestFirst(query.data) : [];

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
      render: (row) => <span title={row.taxName}>{row.taxName}</span>,
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

  const section = (count: ReactNode, body: ReactNode) => (
    <DenseSection
      id="pending-receipts"
      title="Falta la constancia de presentación"
      count={count}
      description="Liquidaciones finalizadas sin la presentación registrada con su constancia."
      surface="integrated"
    >
      {body}
    </DenseSection>
  );

  if (query.isError) {
    return section(
      undefined,
      <AsyncState
        loading={false}
        error
        loadingLabel={LOADING_LABEL}
        errorTitle={ERROR_TITLE}
        errorDescription={ERROR_DESCRIPTION}
        onRetry={() => void query.refetch()}
      />,
    );
  }
  if (!query.isSuccess) {
    return section(
      "pendiente",
      <AsyncState
        loading
        error={false}
        loadingLabel={LOADING_LABEL}
        errorTitle={ERROR_TITLE}
        errorDescription={ERROR_DESCRIPTION}
        onRetry={() => void query.refetch()}
      />,
    );
  }
  return section(
    rows.length,
    <DenseTable<PendingReceipt>
      label="Constancias de presentación pendientes"
      columns={columns}
      rows={rows}
      rowKey={(row) => row.settlementId}
      surface="integrated"
      footer={
        <DenseFooter
          count={rows.length}
          noun={rows.length === 1 ? "constancia pendiente" : "constancias pendientes"}
          hint="La más antigua primero. Registrá la presentación desde el Legajo del cliente."
          newShortcut={false}
        />
      }
    />,
  );
}
