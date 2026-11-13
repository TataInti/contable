import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, EmptyState, Notice, Table } from "@contable/design-system";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { Icon } from "../ui/Icon";
import { StatusBadge } from "../ui/StatusBadge";
import {
  formatPortalDate,
  formatPortalMoney,
  PortalLoading,
  PortalPageHeader,
  PortalRetryButton,
} from "./PortalUI";
import { SectionIndex } from "../ui/SectionIndex";
import "./portal.css";

interface Obligation {
  id: string;
  periodLabel: string;
  dueDate: string;
  status: string;
  obligation: { name: string; jurisdiction?: string | null };
}

interface TimelineEntry {
  obligation: {
    id: string;
    status: string;
    dueDate: string;
    period: { label: string | null; startDate: string; endDate: string } | null;
  };
  filings: { id: string; externalId: string | null; amount: string; filedAt: string }[];
  payments: { id: string; amount: string; paidAt: string; status: string }[];
  messages: { id: string; body: string; createdAt: string }[];
}

export function PortalObligaciones() {
  const { clientId, capabilities } = useClientContext();
  const query = useQuery({
    queryKey: ["portal-obligations", clientId],
    queryFn: () => api.get<Obligation[]>(`/portal/clients/${clientId}/obligations`),
    enabled: Boolean(clientId),
  });
  const rows = query.data ?? [];
  const actionable = rows.filter(
    (row) => !["PAID", "FILED", "NOT_APPLICABLE"].includes(row.status),
  ).length;
  const nextObligation = rows
    .filter((row) => !["PAID", "FILED", "NOT_APPLICABLE"].includes(row.status))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];

  return (
    <div className="portal-page">
      <PortalPageHeader
        eyebrow="Calendario"
        title="Impuestos y obligaciones"
        description="Consultá las fechas y el estado que informó tu estudio."
        actions={capabilities.has("message.shared") ? (
          <Link className="portal-secondary-link" to="/portal/mensajes">
            <Icon name="message" size={18} />
            <span>Hacer una consulta</span>
          </Link>
        ) : undefined}
      />

      {!clientId ? (
        <EmptyState
          title="Sin empresa seleccionada"
          description="Elegí una empresa para consultar sus vencimientos."
        />
      ) : query.isLoading ? (
        <PortalLoading label="Cargando impuestos y obligaciones…" />
      ) : query.isError ? (
        <Notice
          tone="error"
          title="No pudimos cargar los vencimientos"
          action={<PortalRetryButton onRetry={() => void query.refetch()} />}
        >
          Reintentá en unos minutos.
        </Notice>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Sin vencimientos informados"
          description="Cuando tu estudio publique una obligación, aparecerá acá."
          action={
            capabilities.has("message.shared") ? (
              <Link className="portal-text-link" to="/portal/mensajes">
                Consultar al estudio
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <SectionIndex
            items={[
              { id: "obligations-status-title", label: "Resumen", meta: `${actionable} requieren seguimiento` },
              { id: "obligations-title", label: "Calendario", meta: String(rows.length) },
            ]}
          />
          <section className="portal-guidance" aria-labelledby="obligations-next-step-title">
            <div className="portal-guidance__context">
              <span className="portal-guidance__icon" aria-hidden="true">
                <Icon name="calendar" size={19} />
              </span>
              <div>
                <p className="portal-guidance__eyebrow" id="obligations-status-title">Calendario informado</p>
                <p>
                  {nextObligation
                    ? `Próximo vencimiento: ${nextObligation.obligation.name} · ${formatPortalDate(nextObligation.dueDate, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}.`
                    : "No hay obligaciones que requieran seguimiento en este momento."}
                </p>
              </div>
            </div>
            <div className="portal-guidance__next">
              <div>
                <p className="portal-guidance__eyebrow">Próximo paso</p>
                <h2 id="obligations-next-step-title">
                  {nextObligation ? "Revisá su seguimiento antes del vencimiento" : "Consultá el detalle de tus obligaciones"}
                </h2>
              </div>
              {nextObligation && capabilities.has("message.shared") ? (
                <Link className="portal-secondary-link" to="/portal/mensajes">
                  Hacer una consulta
                </Link>
              ) : null}
            </div>
          </section>
          <section className="portal-page__section" aria-labelledby="obligations-title">
          <div className="portal-section-bar">
            <div>
              <h2 id="obligations-title">Calendario informado</h2>
              <p>
                {actionable === 0
                  ? "No hay obligaciones que requieran seguimiento"
                  : `${actionable} ${actionable === 1 ? "obligación requiere" : "obligaciones requieren"} seguimiento`}
              </p>
            </div>
          </div>
          <Table<Obligation>
            className="portal-data-table portal-data-table--obligations"
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "name",
                header: "Obligación",
                render: (row) => (
                  <div className="portal-table-primary">
                    <strong>{row.obligation.name}</strong>
                    {row.obligation.jurisdiction ? (
                      <span>{row.obligation.jurisdiction}</span>
                    ) : null}
                  </div>
                ),
              },
              { key: "period", header: "Período", render: (row) => row.periodLabel },
              {
                key: "due",
                header: "Vence",
                render: (row) =>
                  formatPortalDate(row.dueDate, {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    timeZone: "UTC",
                  }),
              },
              {
                key: "status",
                header: "Estado",
                render: (row) => <StatusBadge status={row.status} />,
              },
              {
                key: "timeline",
                header: "Seguimiento",
                render: (row) => <ObligationTimeline clientId={clientId} obligationId={row.id} />,
              },
            ]}
          />
          <p className="portal-page__footnote">
            <Icon name="shield" size={16} />
            <span>
              La información publicada es orientativa. Ante una duda, confirmala con tu estudio.
            </span>
          </p>
          </section>
        </>
      )}
    </div>
  );
}

/** G5-08: timeline de comunicación por obligación (filings, pagos y mensajes SHARED). */
function ObligationTimeline({ clientId, obligationId }: { clientId: string; obligationId: string }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["portal-obligation-timeline", clientId, obligationId],
    queryFn: () =>
      api.get<TimelineEntry>(`/portal/clients/${clientId}/obligations/${obligationId}/timeline`),
    enabled: open && Boolean(clientId && obligationId),
  });

  if (!open) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Ver seguimiento
      </Button>
    );
  }

  if (query.isLoading) return <span className="portal-timeline__loading">Cargando…</span>;
  if (query.isError || !query.data) {
    return (
      <Notice
        tone="error"
        action={
          <Button type="button" size="sm" variant="ghost" onClick={() => void query.refetch()}>
            Reintentar
          </Button>
        }
      >
        La consulta de novedades encontró un problema.
      </Notice>
    );
  }

  const { filings, payments, messages } = query.data;
  const events: { date: string; label: string; detail?: string }[] = [
    ...filings.map((f) => ({
      date: f.filedAt,
      label: "Presentación registrada",
      detail: f.externalId ? `Acuse ${f.externalId}` : undefined,
    })),
    ...payments.map((p) => ({
      date: p.paidAt,
      label: p.status === "REVERSED" ? "Pago revertido" : "Pago registrado",
      detail: formatPortalMoney(p.amount),
    })),
    ...messages.map((m) => ({ date: m.createdAt, label: "Mensaje del estudio", detail: m.body })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  if (events.length === 0) {
    return (
      <EmptyState
        size="compact"
        kind="no-data"
        title="Sin novedades"
        description="Las presentaciones, pagos y mensajes del estudio aparecerán acá."
      />
    );
  }

  return (
    <details className="portal-timeline" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="portal-timeline__summary">
        {events.length} {events.length === 1 ? "novedad" : "novedades"}
      </summary>
      <ol className="portal-timeline__list">
        {events.map((event, i) => (
          <li key={i} className="portal-timeline__item">
            <span className="portal-timeline__date">
              {formatPortalDate(event.date, {
                day: "2-digit",
                month: "short",
                year: "numeric",
                timeZone: "UTC",
              })}
            </span>
            <span className="portal-timeline__label">{event.label}</span>
            {event.detail ? <span className="portal-timeline__detail">{event.detail}</span> : null}
          </li>
        ))}
      </ol>
    </details>
  );
}
