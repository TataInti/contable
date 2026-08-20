import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, EmptyState } from "@contable/design-system";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { formatPortalMoney, PortalLoading, PortalPageHeader, PortalRetryButton } from "./PortalUI";
import "./portal.css";

/**
 * Rentabilidad publicada (Puerta 5, G5-07).
 *
 * El portal sólo ve snapshots PUBLISHED (nunca borradores ni SUPERSEDED).
 * Devengado y caja se muestran separados, con la definición de cada subtotal.
 * G5-10: cada publicación tiene un recibo persistente (hashes + fecha).
 */

interface PublishedSnapshot {
  id: string;
  basis: "DEVENGADO" | "CAJA";
  version: number;
  status: string;
  cutoff: string;
  totals: Record<string, string> | null;
  lines: Array<{ concept: string; formula: string; result: string }> | null;
  publishedAt: string | null;
  period?: { label: string | null; startDate: string; endDate: string } | null;
}

interface Receipt {
  id: string;
  basis: string;
  version: number;
  publishedAt: string | null;
  outputHash: string;
  inputHash: string;
  period?: { label: string | null } | null;
}

const SUBTOTAL_LABELS: Record<string, string> = {
  VENTAS: "Ventas netas del período",
  VENTAS_EXENTAS: "Ventas exentas / no gravadas (informativas)",
  GASTO_FISCAL: "Gastos con respaldo fiscal",
  GASTO_GESTION: "Gastos de gestión sin respaldo fiscal",
  IMPUESTOS: "Impuestos del período",
  POSICION_IVA: "Posición IVA (informativa, no es gasto)",
  RESULTADO_ANTES_IMPUESTOS: "Resultado antes de impuestos",
  RESULTADO_POST_IMPUESTOS: "Resultado gerencial luego de impuestos",
  COBROS: "Cobros del período",
  PAGOS_FISCALES: "Pagos con respaldo fiscal",
  PAGOS_GESTION: "Pagos de gestión",
  PAGOS_IMPUESTOS: "Pagos impositivos",
  FLUJO_NETO: "Flujo neto luego de impuestos",
};

function basisLabel(basis: string): string {
  return basis === "CAJA" ? "Caja (flujo real)" : "Devengado (acumulado)";
}

function SnapshotCard({ snapshot }: { snapshot: PublishedSnapshot }) {
  const { clientId } = useClientContext();
  const [copied, setCopied] = useState(false);
  const receiptQuery = useQuery({
    queryKey: ["portal-profitability-receipt", clientId, snapshot.id],
    queryFn: () =>
      api.get<Receipt>(`/portal/clients/${clientId}/profitability/${snapshot.id}/receipt`),
    enabled: Boolean(clientId),
  });
  const receipt = receiptQuery.data;
  const totals = snapshot.totals ?? {};
  const totalKey = snapshot.basis === "CAJA" ? "FLUJO_NETO" : "RESULTADO_POST_IMPUESTOS";
  return (
    <section className="portal-profitability-card" aria-labelledby={`portal-profitability-${snapshot.basis.toLowerCase()}`}>
      <div className="portal-profitability-card__header">
        <div>
          <p className="portal-page__eyebrow">{basisLabel(snapshot.basis)}</p>
          <h2 id={`portal-profitability-${snapshot.basis.toLowerCase()}`}>
            {snapshot.basis === "CAJA" ? "Flujo neto" : "Resultado gerencial"}
          </h2>
        </div>
        <span className="portal-profitability-card__version">v{snapshot.version}</span>
      </div>

      <p className="portal-profitability-card__total">
        {formatPortalMoney(totals[totalKey])}
        <small>
          {snapshot.basis === "CAJA"
            ? "luego de impuestos y del efecto de caja del IVA"
            : "luego de impuestos del período"}
        </small>
      </p>

      <dl className="portal-profitability-card__rows">
        {(Object.entries(totals) as [string, string][]).map(([key, value]) => (
          <div key={key} data-total={key === totalKey || undefined}>
            <dt>{SUBTOTAL_LABELS[key] ?? key.replaceAll("_", " ").toLowerCase()}</dt>
            <dd>{formatPortalMoney(value)}</dd>
          </div>
        ))}
      </dl>

      {snapshot.lines && snapshot.lines.length > 0 ? (
        <details className="portal-profitability-card__detail">
          <summary>Ver cómo se calculó</summary>
          <ul>
            {snapshot.lines.map((line, index) => (
              <li key={`${line.concept}-${index}`}>
                <strong>{line.concept}</strong>
                <span>{line.formula}</span>
                <b>{formatPortalMoney(line.result)}</b>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {receipt ? (
        <div className="portal-profitability-card__receipt" role="status">
          <p>
            <strong>Recibo de publicación</strong>
            {receipt.publishedAt
              ? ` · ${new Date(receipt.publishedAt).toLocaleString("es-AR")}`
              : ""}
          </p>
          <code>hash {receipt.outputHash.slice(0, 20)}…</code>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(receipt.outputHash)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {copied ? "Identificador copiado" : "Copiar identificador"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export function PortalRentabilidad() {
  const { clientId, periodId } = useClientContext();
  const query = useQuery({
    queryKey: ["portal-profitability", clientId, periodId],
    queryFn: () =>
      api.get<PublishedSnapshot[]>(
        `/portal/clients/${clientId}/profitability${periodId ? `?periodId=${encodeURIComponent(periodId)}` : ""}`,
      ),
    enabled: Boolean(clientId),
  });
  const rows = query.data ?? [];
  const devengado = rows.find((s) => s.basis === "DEVENGADO");
  const caja = rows.find((s) => s.basis === "CAJA");

  return (
    <div className="portal-page">
      <PortalPageHeader
        eyebrow="Gerencia"
        title="Rentabilidad"
        description="Resultados publicados para el período seleccionado, separados por devengado y caja."
        actions={
          <Link className="portal-secondary-link" to="/portal/reportes">
            Ver estados y reportes
          </Link>
        }
      />

      {!clientId ? (
        <EmptyState
          title="Sin empresa seleccionada"
          description="Elegí una empresa para consultar su rentabilidad."
        />
      ) : query.isLoading ? (
        <PortalLoading label="Cargando rentabilidad…" />
      ) : query.isError ? (
        <EmptyState
          title="No pudimos cargar la rentabilidad"
          description="Reintentá en unos minutos."
          action={<PortalRetryButton onRetry={() => void query.refetch()} />}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Sin rentabilidad publicada"
          description="Cuando tu estudio publique el período seleccionado, aparecerá acá."
          action={
            <Link className="portal-text-link" to="/portal/reportes">
              Ver estados y reportes disponibles
            </Link>
          }
        />
      ) : (
        <div className="portal-profitability-grid">
          {devengado ? <SnapshotCard snapshot={devengado} /> : null}
          {caja ? <SnapshotCard snapshot={caja} /> : null}
        </div>
      )}
    </div>
  );
}
