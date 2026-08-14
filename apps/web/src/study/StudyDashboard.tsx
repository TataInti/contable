import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@contable/design-system";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { useSession } from "../session/SessionContext";
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

const TODAY = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" });

export function StudyDashboard() {
  const { firmId } = useClientContext();
  const { me } = useSession();
  const query = useQuery({
    queryKey: ["study-dashboard", firmId],
    queryFn: () => api.get<DashboardSummary>(`/firms/${firmId}/dashboard`),
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
