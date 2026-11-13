import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, EmptyState, Notice, Table } from "@contable/design-system";
import { Link } from "react-router-dom";
import { api, downloadFile } from "../lib/api";
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

/**
 * Liquidaciones publicadas (Puerta 3, G3-11).
 *
 * El portal sólo ve liquidaciones FINALIZED (publicadas por el estudio).
 * Puede descargar el papel de trabajo (artifact) cuando existe.
 */

interface PublishedSettlement {
  id: string;
  version: number;
  status: string;
  cutoff: string;
  totals: Record<string, string> | null;
  period?: { label: string | null; startDate: string; endDate: string };
  taxType?: { code: string; name: string };
  jurisdiction?: { code: string; name: string };
  regime?: { code: string; name: string };
  filings?: Array<{ filedAt: string; amountFiled: string; externalId: string | null }>;
  payments?: Array<{ paidAt: string; amount: string; method: string }>;
  artifacts?: PublishedArtifact[];
}

interface PublishedArtifact {
  id: string;
  kind: string;
  format: "pdf" | "csv";
  generatedAt: string;
}

export function PortalLiquidaciones() {
  const { clientId, capabilities } = useClientContext();
  const [downloadingArtifact, setDownloadingArtifact] = useState<string | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [failedArtifact, setFailedArtifact] = useState<{
    settlementId: string;
    artifact: PublishedArtifact;
  } | null>(null);
  const query = useQuery({
    queryKey: ["portal-tax-settlements", clientId],
    queryFn: () => api.get<PublishedSettlement[]>(`/portal/clients/${clientId}/tax-settlements`),
    enabled: Boolean(clientId),
  });
  const rows = query.data ?? [];
  const latestSettlement = [...rows].sort((a, b) => b.cutoff.localeCompare(a.cutoff))[0];
  const latestArtifact = latestSettlement?.artifacts?.[0];
  const downloadArtifact = async (settlementId: string, artifact: PublishedArtifact) => {
    const key = `${settlementId}-${artifact.id}`;
    setDownloadingArtifact(key);
    setArtifactError(null);
    setFailedArtifact(null);
    try {
      await downloadFile(
        `/portal/clients/${clientId}/tax-settlements/${settlementId}/artifacts/${artifact.id}/download`,
      );
    } catch {
      setArtifactError("No pudimos descargar el archivo. Reintentá en unos minutos.");
      setFailedArtifact({ settlementId, artifact });
    } finally {
      setDownloadingArtifact(null);
    }
  };

  return (
    <div className="portal-page">
      <PortalPageHeader
        eyebrow="Impuestos"
        title="Liquidaciones publicadas"
        description="Resultados finalizados que tu estudio compartió con vos, con su presentación y pago informados."
        actions={
          <Link className="portal-secondary-link" to="/portal/impuestos">
            <Icon name="calendar" size={18} />
            <span>Ver obligaciones</span>
          </Link>
        }
      />

      {!clientId ? (
        <EmptyState
          title="Sin empresa seleccionada"
          description="Elegí una empresa para consultar sus liquidaciones."
        />
      ) : query.isLoading ? (
        <PortalLoading label="Cargando liquidaciones…" />
      ) : query.isError ? (
        <Notice
          tone="error"
          title="No pudimos cargar las liquidaciones"
          action={<PortalRetryButton onRetry={() => void query.refetch()} />}
        >
          Reintentá en unos minutos.
        </Notice>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Sin liquidaciones publicadas"
          description="Cuando tu estudio finalice una liquidación, aparecerá acá."
          action={
            <Link className="portal-text-link" to="/portal/impuestos">
              Ver obligaciones informadas
            </Link>
          }
        />
      ) : (
        <>
          <SectionIndex
            items={[
              { id: "published-settlements-status-title", label: "Resumen" },
              { id: "settlements-title", label: "Resultados", meta: String(rows.length) },
            ]}
          />
          <section className="portal-guidance" aria-labelledby="settlements-next-step-title">
            <div className="portal-guidance__context">
              <span className="portal-guidance__icon" aria-hidden="true">
                <Icon name="file" size={19} />
              </span>
              <div>
                <p className="portal-guidance__eyebrow" id="published-settlements-status-title">Última liquidación publicada</p>
                <p>
                  {latestSettlement
                    ? `${latestSettlement.taxType?.name ?? latestSettlement.regime?.name ?? latestSettlement.regime?.code ?? "Impuesto"} · ${latestSettlement.period?.label ?? formatPortalDate(latestSettlement.cutoff)} · v${latestSettlement.version}`
                    : "Consultá los resultados publicados por tu estudio."}
                </p>
              </div>
            </div>
            <div className="portal-guidance__next">
              <div>
                <p className="portal-guidance__eyebrow">Próximo paso</p>
                <h2 id="settlements-next-step-title">
                  {latestArtifact ? "Descargá el archivo de la última liquidación" : "Revisá el detalle de la liquidación publicada"}
                </h2>
              </div>
              {latestSettlement && latestArtifact ? (
                <Button
                  type="button"
                  variant="secondary"
                  loading={downloadingArtifact === `${latestSettlement.id}-${latestArtifact.id}`}
                  disabled={downloadingArtifact !== null}
                  onClick={() => void downloadArtifact(latestSettlement.id, latestArtifact)}
                >
                  Descargar {latestArtifact.format.toUpperCase()}
                </Button>
              ) : null}
            </div>
          </section>
          <section className="portal-page__section" aria-labelledby="settlements-title">
          <div className="portal-section-bar">
            <div>
              <h2 id="settlements-title">Resultados finalizados</h2>
              <p>Consultá el detalle informado por período, los movimientos y los archivos publicados.</p>
            </div>
          </div>
          {artifactError ? (
            <Notice
              tone="error"
              action={
                failedArtifact ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void downloadArtifact(failedArtifact.settlementId, failedArtifact.artifact)}
                  >
                    Reintentar descarga
                  </Button>
                ) : undefined
              }
            >
              {artifactError}
            </Notice>
          ) : null}
          <Table<PublishedSettlement>
            className="portal-data-table portal-data-table--settlements"
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "periodo",
                header: "Período",
                render: (row) => row.period?.startDate ?? "—",
              },
              {
                key: "impuesto",
                header: "Impuesto",
                render: (row) => row.taxType?.name ?? row.regime?.name ?? row.regime?.code ?? "—",
              },
              {
                key: "version",
                header: "Versión",
                render: (row) => `v${row.version}`,
              },
              {
                key: "estado",
                header: "Estado",
                render: (row) => <StatusBadge status={row.status} />,
              },
              {
                key: "total",
                header: "Total a ingresar",
                align: "right",
                render: (row) =>
                  formatPortalMoney(row.totals?.["TOTAL_A_INGRESAR"] ?? row.totals?.["totalDue"]),
              },
              {
                key: "presentacion",
                header: "Presentación",
                render: (row) => {
                  const filing = row.filings?.[0];
                  return filing ? formatPortalDate(filing.filedAt) : "—";
                },
              },
              {
                key: "pago",
                header: "Pago",
                render: (row) => {
                  const payment = row.payments?.[0];
                  return payment ? formatPortalMoney(payment.amount) : "—";
                },
              },
              {
                key: "detail",
                header: "Detalle",
                render: (row) => (
                  <details>
                    <summary>Ver movimientos</summary>
                    <div>
                      <p>
                        <strong>Corte:</strong> {formatPortalDate(row.cutoff)}
                      </p>
                      <p>
                        <strong>Presentación:</strong>{" "}
                        {row.filings?.[0]
                          ? `${formatPortalDate(row.filings[0].filedAt)}${row.filings[0].externalId ? ` · Acuse ${row.filings[0].externalId}` : ""}`
                          : "Aún no informada"}
                      </p>
                      <p>
                        <strong>Pagos:</strong>{" "}
                        {row.payments && row.payments.length > 0
                          ? row.payments
                              .map((payment) => `${formatPortalMoney(payment.amount)} · ${formatPortalDate(payment.paidAt)}`)
                              .join(" · ")
                          : "Aún no informados"}
                      </p>
                      {capabilities.has("message.shared") ? (
                        <Link className="portal-text-link" to="/portal/mensajes">
                          Consultar al estudio
                        </Link>
                      ) : null}
                    </div>
                  </details>
                ),
              },
              {
                key: "artifacts",
                header: "Archivos",
                render: (row) => {
                  const artifacts = row.artifacts ?? [];
                  if (artifacts.length === 0) return <span>Sin archivos publicados</span>;
                  return (
                    <div>
                      {artifacts.map((artifact) => {
                        const key = `${row.id}-${artifact.id}`;
                        return (
                          <Button
                            key={artifact.id}
                            type="button"
                            size="sm"
                            variant="ghost"
                            loading={downloadingArtifact === key}
                            disabled={downloadingArtifact !== null}
                            onClick={() => void downloadArtifact(row.id, artifact)}
                            aria-label={`Descargar ${artifact.format.toUpperCase()} de ${artifact.kind}`}
                            title={`Generado ${formatPortalDate(artifact.generatedAt)}`}
                          >
                            {artifact.format.toUpperCase()}
                          </Button>
                        );
                      })}
                    </div>
                  );
                },
              },
            ]}
            empty="Sin liquidaciones publicadas."
          />
          </section>
        </>
      )}
    </div>
  );
}
