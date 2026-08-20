import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@contable/design-system";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { Icon, type IconName } from "../ui/Icon";
import { PortalLoading, PortalPageHeader, PortalRetryButton } from "./PortalUI";
import "./portal.css";

interface Summary {
  pendingRequests: number;
  upcomingObligations: number;
  publications: number;
  documentsCount: number;
}

const QUICK_LINKS: {
  to: string;
  title: string;
  description: string;
  icon: IconName;
  capability?: string;
}[] = [
  {
    to: "/portal/upload",
    title: "Cargar un archivo",
    description: "Facturas, recibos y otra documentación",
    icon: "upload",
    capability: "portal.documents.upload",
  },
  {
    to: "/portal/mensajes",
    title: "Escribir al estudio",
    description: "Consultas asociadas a tus pedidos",
    icon: "message",
    capability: "message.shared",
  },
  {
    to: "/portal/reportes",
    title: "Ver reportes publicados",
    description: "Descargá las últimas versiones disponibles",
    icon: "reports",
  },
];

export function PortalDashboard() {
  const { clientId, capabilities } = useClientContext();
  const canUpload = capabilities.has("portal.documents.upload");
  const summary = useQuery({
    queryKey: ["portal-summary", clientId],
    queryFn: () => api.get<Summary>(`/portal/clients/${clientId}/summary`),
    enabled: Boolean(clientId),
  });
  return (
    <div className="portal-page portal-page--dashboard">
      <PortalPageHeader
        eyebrow="Resumen"
        title="Tu información contable"
        description="Lo importante de tu empresa, ordenado para que sepas qué requiere atención."
      />

      {!clientId ? (
        <EmptyState
          title="Sin empresa asignada"
          description="Pedile a tu estudio que habilite el acceso a una empresa."
        />
      ) : summary.isLoading ? (
        <PortalLoading label="Cargando tu resumen…" />
      ) : summary.isError ? (
        <EmptyState
          title="No pudimos cargar el resumen"
          description="Reintentá en unos minutos. Si el problema continúa, escribile a tu estudio."
          action={<PortalRetryButton onRetry={() => void summary.refetch()} />}
        />
      ) : summary.data ? (
        <>
          <section className="portal-dashboard__overview" aria-labelledby="next-step-title">
            <div className="portal-dashboard__focus">
              <span className="portal-dashboard__focus-icon" aria-hidden="true">
                <Icon name={summary.data.pendingRequests > 0 ? "tasks" : "check"} size={24} />
              </span>
              <p className="portal-dashboard__kicker">Para resolver</p>
              <h2 id="next-step-title">
                {summary.data.pendingRequests > 0
                  ? `${summary.data.pendingRequests} ${summary.data.pendingRequests === 1 ? "pedido necesita" : "pedidos necesitan"} tu atención`
                  : "No tenés pedidos pendientes"}
              </h2>
              <p>
                {summary.data.pendingRequests > 0
                  ? "Revisá qué documentación pidió tu estudio y qué falta entregar."
                  : canUpload
                    ? "Podés cargar documentación nueva cuando la tengas disponible."
                    : "Consultá los reportes y resultados que tu estudio publicó para vos."}
              </p>
              <Link
                className="portal-action-link"
                to={
                  summary.data.pendingRequests > 0
                    ? "/portal/pendientes"
                    : canUpload
                      ? "/portal/upload"
                      : "/portal/reportes"
                }
              >
                <span>
                  {summary.data.pendingRequests > 0
                    ? "Ver pedidos"
                    : canUpload
                      ? "Cargar un documento"
                      : "Ver reportes"}
                </span>
                <Icon name="arrow-right" size={18} />
              </Link>
            </div>

            <dl className="portal-summary" aria-label="Resumen de actividad">
              <div className="portal-summary__item">
                <dt>Vencimientos informados</dt>
                <dd className="portal-summary__value">{summary.data.upcomingObligations}</dd>
                <dd className="portal-summary__detail">
                  <Link to="/portal/impuestos">Consultar impuestos</Link>
                </dd>
              </div>
              <div className="portal-summary__item">
                <dt>Reportes disponibles</dt>
                <dd className="portal-summary__value">{summary.data.publications}</dd>
                <dd className="portal-summary__detail">
                  <Link to="/portal/reportes">Ver publicaciones</Link>
                </dd>
              </div>
              <div className="portal-summary__item portal-summary__item--static">
                <dt>Documentos cargados</dt>
                <dd className="portal-summary__value">{summary.data.documentsCount}</dd>
                <dd className="portal-summary__detail">Historial total</dd>
                {canUpload ? (
                  <dd className="portal-summary__detail">
                    <Link to="/portal/upload">Ver cargas recientes</Link>
                  </dd>
                ) : null}
              </div>
            </dl>
          </section>

          <section className="portal-dashboard__quick" aria-labelledby="quick-title">
            <div className="portal-section-heading">
              <p className="portal-page__eyebrow">Accesos rápidos</p>
              <h2 id="quick-title">¿Qué necesitás hacer?</h2>
            </div>
            <div className="portal-dashboard__quick-links">
              {QUICK_LINKS.filter((item) => !item.capability || capabilities.has(item.capability)).map((item) => (
                <Link className="portal-quick-link" to={item.to} key={item.to}>
                  <Icon name={item.icon} size={21} />
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                  </span>
                  <Icon className="portal-quick-link__arrow" name="arrow-right" size={18} />
                </Link>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
