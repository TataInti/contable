import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@contable/design-system";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { useSession } from "../session/SessionContext";
import { StatusBadge } from "../ui/StatusBadge";
import { Icon, type IconName } from "../ui/Icon";
import "./study.css";

interface DashboardSummary {
  clients: number;
  documents: number;
  extracted: number;
  processing: number;
  openRequests: number;
  pendingObligations: number;
}

/** Worklist fiscal: liquidaciones con riesgo (G5-06). */
interface WorklistItem {
  id: string;
  status: string;
  clientId: string;
  version: number;
  cutoff: string;
  period?: { startDate: string; endDate: string };
  regime?: { code: string; name: string; taxType?: { code: string; name: string } };
}

const TODAY = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" });

/** Severidad de un estado para priorizar la mesa de trabajo. */
function riskTone(status: string): "danger" | "warn" | "info" {
  switch (status) {
    case "CHANGES_REQUESTED":
      return "danger";
    case "IN_REVIEW":
      return "warn";
    case "DRAFT":
    case "CALCULATED":
      return "info";
    default:
      return "info";
  }
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "En preparación",
  CALCULATED: "Calculada",
  IN_REVIEW: "En revisión",
  CHANGES_REQUESTED: "Requiere corrección",
  REVIEWED: "Revisada",
  FINALIZED: "Finalizada",
  SUPERSEDED: "Rectificada",
};

export function StudyDashboard() {
  const { firmId } = useClientContext();
  const { me } = useSession();
  const query = useQuery({
    queryKey: ["study-dashboard", firmId],
    queryFn: () => api.get<DashboardSummary>(`/firms/${firmId}/dashboard`),
    enabled: Boolean(firmId),
  });
  // G5-06: la cartera por riesgo viene del worklist fiscal real.
  // F0.1: la ruta lleva la firma explícita (no contexto implícito).
  const worklistQuery = useQuery({
    queryKey: ["tax-worklist-dashboard", firmId],
    queryFn: () => api.get<WorklistItem[]>(`/firms/${firmId}/portfolio/tax-worklist`),
    enabled: Boolean(firmId),
  });
  const firmName = me?.firms.find((firm) => firm.firmId === firmId)?.firmName;
  if (!firmId)
    return (
      <div className="study-page">
        <EmptyState
          title="Elegí un estudio para empezar"
          description="Tu contexto determina qué cartera y tareas vas a ver."
        />
      </div>
    );
  const data = query.data;
  const worklist = worklistQuery.data ?? [];
  const atRisk = worklist.filter((item) => item.status === "CHANGES_REQUESTED").length;
  const inReview = worklist.filter((item) => item.status === "IN_REVIEW").length;
  const attentionTotal =
    (data?.processing ?? 0) + (data?.openRequests ?? 0) + (data?.pendingObligations ?? 0);
  const workItems: {
    to: string;
    icon: IconName;
    label: string;
    detail: string;
    count: number;
    tone: string;
  }[] = [
    {
      to: "/bandeja",
      icon: "inbox",
      label: "Documentos en procesamiento",
      detail: `${data?.extracted ?? 0} listos para revisar`,
      count: data?.processing ?? 0,
      tone: "info",
    },
    {
      to: "/trabajo",
      icon: "message",
      label: "Pedidos documentales abiertos",
      detail: "Seguimiento con clientes",
      count: data?.openRequests ?? 0,
      tone: "warn",
    },
    {
      to: "/trabajo",
      icon: "calendar",
      label: "Obligaciones pendientes",
      detail: "Vencimientos por resolver",
      count: data?.pendingObligations ?? 0,
      tone: "danger",
    },
  ];

  return (
    <div className="study-page study-dashboard">
      <div className="study-page__header study-page__header--dashboard">
        <div>
          <p className="study-page__eyebrow">{TODAY.format(new Date())}</p>
          <h1 className="study-page__title">Resumen operativo</h1>
          <p className="study-page__subtitle">
            {firmName ? `${firmName} · ` : ""}prioridades reales de la cartera, ordenadas para
            avanzar.
          </p>
        </div>
        <Link className="page-primary-link" to="/bandeja">
          <Icon name="inbox" size={17} /> Revisar bandeja <Icon name="arrow-right" size={15} />
        </Link>
      </div>

      {query.isLoading ? (
        <div className="dashboard-loading" role="status" aria-live="polite">
          <span className="loading-copy">Organizando el resumen…</span>
          <span />
          <span />
          <span />
        </div>
      ) : query.isError ? (
        <EmptyState
          title="No se pudo cargar el resumen"
          description="La información del estudio no está disponible en este momento."
          action={
            <button className="text-action" onClick={() => void query.refetch()}>
              Volver a intentar
            </button>
          }
        />
      ) : (
        <>
          <section className="dashboard-focus" aria-labelledby="dashboard-focus-title">
            <div className="dashboard-focus__lead">
              <span
                className={`dashboard-focus__signal${attentionTotal === 0 ? " dashboard-focus__signal--ok" : ""}`}
                aria-hidden="true"
              >
                <Icon name={attentionTotal === 0 ? "check" : "alert"} size={21} />
              </span>
              <p>Requieren atención</p>
              <strong>{attentionTotal}</strong>
              <span>
                {attentionTotal === 0
                  ? "La operación está al día"
                  : attentionTotal === 1
                    ? "tema abierto en la cartera"
                    : "temas abiertos en la cartera"}
              </span>
            </div>

            <div className="dashboard-focus__queue">
              <div className="dashboard-focus__heading">
                <div>
                  <p className="study-page__eyebrow">Próximos pasos</p>
                  <h2 id="dashboard-focus-title">Tu mesa de trabajo</h2>
                </div>
                <span>{attentionTotal > 0 ? "Priorizado" : "Sin pendientes"}</span>
              </div>
              {workItems.map((item) => (
                <Link
                  to={item.to}
                  className="dashboard-work-item"
                  key={item.label}
                  data-tone={item.tone}
                >
                  <span className="dashboard-work-item__icon">
                    <Icon name={item.icon} size={19} />
                  </span>
                  <span className="dashboard-work-item__copy">
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <strong className="dashboard-work-item__count">{item.count}</strong>
                  <Icon name="arrow-right" size={16} className="dashboard-work-item__arrow" />
                </Link>
              ))}
            </div>
          </section>

          {/* G5-06: cartera por riesgo — liquidaciones en curso de toda la firma. */}
          <section className="dashboard-overview" aria-labelledby="risk-portfolio-title">
            <div className="dashboard-overview__heading">
              <div>
                <p className="study-page__eyebrow">Cartera por riesgo</p>
                <h2 id="risk-portfolio-title">Liquidaciones en curso</h2>
                <p className="study-page__subtitle">
                  {atRisk} con correcciones pendientes · {inReview} en revisión
                </p>
              </div>
              <Link to="/liquidaciones">
                Ver todas <Icon name="arrow-right" size={14} />
              </Link>
            </div>
            {worklistQuery.isLoading ? (
              <div className="study-state" role="status">
                Cargando cartera…
              </div>
            ) : worklistQuery.isError ? (
              <EmptyState
                title="No se pudo cargar la cartera fiscal"
                description="La consulta falló; no interpretamos esta situación como una cartera sin liquidaciones."
                action={
                  <button className="text-action" onClick={() => void worklistQuery.refetch()}>
                    Reintentar
                  </button>
                }
              />
            ) : worklist.length === 0 ? (
              <EmptyState
                title="Sin liquidaciones en curso"
                description="Cuando se calcule una liquidación, aparecerá acá priorizada por riesgo."
              />
            ) : (
              <div className="risk-portfolio" role="list">
                {worklist.slice(0, 8).map((item) => (
                  <div
                    className="risk-portfolio__row"
                    role="listitem"
                    key={item.id}
                    data-tone={riskTone(item.status)}
                  >
                    <span className="risk-portfolio__signal" aria-hidden="true" />
                    <div className="risk-portfolio__copy">
                      <strong>
                        {item.regime?.taxType?.name ?? item.regime?.name ?? "Impuesto"} · v
                        {item.version}
                      </strong>
                      <small>
                        {item.period?.startDate ?? item.cutoff} → {item.period?.endDate ?? ""}
                      </small>
                    </div>
                    <StatusBadge status={STATUS_LABELS[item.status] ?? item.status} />
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="dashboard-overview" aria-labelledby="portfolio-overview-title">
            <div className="dashboard-overview__heading">
              <div>
                <p className="study-page__eyebrow">Cartera</p>
                <h2 id="portfolio-overview-title">Panorama general</h2>
              </div>
              <Link to="/clientes">
                Ver clientes <Icon name="arrow-right" size={14} />
              </Link>
            </div>
            <dl className="dashboard-overview__metrics">
              <div>
                <dt>Clientes activos</dt>
                <dd>{data?.clients ?? 0}</dd>
                <small>en el estudio</small>
              </div>
              <div>
                <dt>Documentos</dt>
                <dd>{data?.documents ?? 0}</dd>
                <small>recibidos en total</small>
              </div>
              <div>
                <dt>Extraídos</dt>
                <dd>{data?.extracted ?? 0}</dd>
                <small>con datos disponibles</small>
              </div>
              <div>
                <dt>Tasa de extracción</dt>
                <dd>
                  {data?.documents
                    ? `${Math.round(((data.extracted ?? 0) / data.documents) * 100)}%`
                    : "—"}
                </dd>
                <small>sobre documentación</small>
              </div>
            </dl>
          </section>
        </>
      )}
    </div>
  );
}
