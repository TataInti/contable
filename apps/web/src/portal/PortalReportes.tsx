import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, Table } from "@contable/design-system";
import { api, downloadFile, type ReportPublication } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { Icon } from "../ui/Icon";
import { formatPortalDate, PortalLoading, PortalPageHeader } from "./PortalUI";
import "./portal.css";

export function PortalReportes() {
  const { clientId } = useClientContext();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const reports = useQuery({
    queryKey: ["portal-reports", clientId],
    queryFn: () => api.get<ReportPublication[]>(`/portal/clients/${clientId}/report-publications`),
    enabled: Boolean(clientId),
  });
  const publications = reports.data ?? [];

  const downloadReport = async (report: ReportPublication, format: "pdf" | "xlsx" | "csv") => {
    const key = `${report.id}-${format}`;
    setDownloading(key);
    setDownloadError(null);
    try {
      await downloadFile(
        `/portal/clients/${clientId}/report-publications/${report.id}/export?format=${format}`,
      );
    } catch {
      setDownloadError("No pudimos descargar el archivo. Reintentá en unos minutos.");
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
          />
        ) : publications.length === 0 ? (
          <EmptyState
            title="Todavía no hay reportes publicados"
            description="Cuando tu estudio publique una versión, aparecerá acá."
          />
        ) : (
          <>
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
              <p className="portal-inline-alert portal-inline-alert--error" role="alert">
                {downloadError}
              </p>
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
                          <button
                            className="portal-download"
                            type="button"
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
                          </button>
                        );
                      })}
                    </div>
                  ),
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
