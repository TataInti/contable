import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, EmptyState, Table } from "@contable/design-system";
import { Link } from "react-router-dom";
import { api, downloadFile, type ReportPublication } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { Icon } from "../ui/Icon";
import {
  formatPortalDate,
  PortalLoading,
  PortalPageHeader,
  PortalRetryButton,
} from "./PortalUI";
import { SectionIndex } from "../ui/SectionIndex";
import "./portal.css";

export function PortalReportes() {
  const { clientId } = useClientContext();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [failedDownload, setFailedDownload] = useState<{
    report: ReportPublication;
    format: "pdf" | "xlsx" | "csv";
  } | null>(null);
  const reports = useQuery({
    queryKey: ["portal-reports", clientId],
    queryFn: () => api.get<ReportPublication[]>(`/portal/clients/${clientId}/report-publications`),
    enabled: Boolean(clientId),
  });
  const publications = reports.data ?? [];
  const latestPublication = [...publications].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0];

  const downloadReport = async (report: ReportPublication, format: "pdf" | "xlsx" | "csv") => {
    const key = `${report.id}-${format}`;
    setDownloading(key);
    setDownloadError(null);
    setFailedDownload(null);
    try {
      await downloadFile(
        `/portal/clients/${clientId}/report-publications/${report.id}/export?format=${format}`,
      );
    } catch {
      setDownloadError("No pudimos descargar el archivo. Reintentá en unos minutos.");
      setFailedDownload({ report, format });
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="portal-page">
      <PortalPageHeader
        eyebrow="Publicaciones"
        title="Estados y reportes"
        description="Descargá las versiones que tu estudio preparó y publicó para vos."
        actions={
          <Link className="portal-secondary-link" to="/portal/liquidaciones">
            Ver liquidaciones
          </Link>
        }
      />
      <section className="portal-page__section" aria-label="Reportes publicados">
        {!clientId ? (
          <EmptyState
            title="Sin empresa seleccionada"
            description="Elegí una empresa para consultar sus reportes."
          />
        ) : reports.isLoading ? (
          <PortalLoading label="Cargando reportes…" />
        ) : reports.isError ? (
          <EmptyState
            title="No pudimos cargar los reportes"
            description="Reintentá en unos minutos."
            action={<PortalRetryButton onRetry={() => void reports.refetch()} />}
          />
        ) : publications.length === 0 ? (
          <EmptyState
            title="Todavía no hay reportes publicados"
            description="Cuando tu estudio publique una versión, aparecerá acá."
            action={
              <Link className="portal-text-link" to="/portal/liquidaciones">
                Ver liquidaciones publicadas
              </Link>
            }
          />
        ) : (
          <>
            <SectionIndex
              items={[
                { id: "portal-reports-status-title", label: "Resumen" },
                { id: "reports-title", label: "Documentos", meta: String(publications.length) },
              ]}
            />
            <section className="portal-guidance" aria-labelledby="reports-next-step-title">
              <div className="portal-guidance__context">
                <span className="portal-guidance__icon" aria-hidden="true">
                  <Icon name="reports" size={19} />
                </span>
                <div>
                  <p className="portal-guidance__eyebrow" id="portal-reports-status-title">Último reporte publicado</p>
                  <p>
                    {latestPublication
                      ? `${latestPublication.run?.template?.name ?? latestPublication.run?.result?.templateCode ?? "Estado contable"} · ${formatPortalDate(latestPublication.publishedAt)}`
                      : "Las versiones publicadas por tu estudio están listas para descargar."}
                  </p>
                </div>
              </div>
              <div className="portal-guidance__next">
                <div>
                  <p className="portal-guidance__eyebrow">Próximo paso</p>
                  <h2 id="reports-next-step-title">Descargá la última versión disponible</h2>
                </div>
                {latestPublication ? (
                  <Button
                    type="button"
                    variant="secondary"
                    loading={downloading === `${latestPublication.id}-pdf`}
                    disabled={downloading !== null}
                    onClick={() => void downloadReport(latestPublication, "pdf")}
                  >
                    Descargar PDF
                  </Button>
                ) : null}
              </div>
            </section>
            <div className="portal-section-bar">
              <div>
                <h2 id="reports-title">Documentos disponibles</h2>
                <p>
                  {publications.length}{" "}
                  {publications.length === 1 ? "publicación lista" : "publicaciones listas"} para
                  descargar
                </p>
              </div>
            </div>
            {downloadError ? (
              <div className="portal-inline-alert portal-inline-alert--error" role="alert">
                <span>{downloadError}</span>
                {failedDownload ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void downloadReport(failedDownload.report, failedDownload.format)}
                  >
                    Reintentar {failedDownload.format.toUpperCase()}
                  </Button>
                ) : null}
              </div>
            ) : null}
            <Table<ReportPublication>
              className="portal-data-table portal-data-table--reports"
              rows={publications}
              rowKey={(report) => report.id}
              columns={[
                {
                  key: "report",
                  header: "Reporte",
                  render: (report) => (
                    <div className="portal-report-name">
                      <span className="portal-report-name__icon" aria-hidden="true">
                        <Icon name="file" size={19} />
                      </span>
                      <strong>
                        {report.run?.template?.name ??
                          report.run?.result?.templateCode ??
                          "Estado contable"}
                      </strong>
                    </div>
                  ),
                },
                {
                  key: "cutoff",
                  header: "Fecha de corte",
                  render: (report) =>
                    report.run?.cutoff
                      ? formatPortalDate(report.run.cutoff, {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          timeZone: "UTC",
                        })
                      : "Sin fecha",
                },
                {
                  key: "publishedAt",
                  header: "Publicado",
                  render: (report) => formatPortalDate(report.publishedAt),
                },
                {
                  key: "downloads",
                  header: "Descargar",
                  render: (report) => (
                    <div className="portal-downloads">
                      {(["pdf", "xlsx", "csv"] as const).map((format) => {
                        const key = `${report.id}-${format}`;
                        return (
                          <Button
                            type="button"
                            variant="text"
                            size="row"
                            key={format}
                            aria-label={`Descargar ${format.toUpperCase()}`}
                            aria-busy={downloading === key || undefined}
                            disabled={downloading !== null}
                            onClick={() => void downloadReport(report, format)}
                          >
                            <Icon name="download" size={15} />
                            <span>
                              {downloading === key ? "Descargando…" : format.toUpperCase()}
                            </span>
                          </Button>
                        );
                      })}
                    </div>
                  ),
                },
                {
                  key: "preview",
                  header: "Vista",
                  render: (report) => <ReportPreview report={report} />,
                },
              ]}
            />
            <p className="portal-page__footnote">
              <Icon name="shield" size={16} />
              <span>Sólo ves versiones que tu estudio publicó expresamente.</span>
            </p>
          </>
        )}
      </section>
    </div>
  );
}

function ReportPreview({ report }: { report: ReportPublication }) {
  const lines = report.run?.result?.lines ?? [];
  if (lines.length === 0) return <span>Sin vista previa</span>;

  return (
    <details>
      <summary>Ver resumen</summary>
      <ul>
        {lines.slice(0, 6).map((line) => (
          <li key={line.code}>
            <strong>{line.label}</strong>: {line.value}
          </li>
        ))}
        {lines.length > 6 ? <li>+ {lines.length - 6} líneas más en la descarga</li> : null}
      </ul>
    </details>
  );
}
