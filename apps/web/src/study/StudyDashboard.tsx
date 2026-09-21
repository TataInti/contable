import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, EmptyState } from "@contable/design-system";
import { Link, useNavigate } from "react-router-dom";
import { api, type FiscalYear } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { useSession } from "../session/SessionContext";
import { StatusBadge } from "../ui/StatusBadge";
import { SectionIndex } from "../ui/SectionIndex";
import { Icon, type IconName } from "../ui/Icon";
import { AsyncState } from "../ui/AsyncState";
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
  const { firmId, clientId, periodId, capabilities, hasClientAccess, setClientId, setPeriodId } =
    useClientContext();
  const { me } = useSession();
  const navigate = useNavigate();
  const canReadDashboard = capabilities.has("client.read");
  const canReadTaxWorklist = capabilities.has("tax.settlements.read");
  const [openingSettlementId, setOpeningSettlementId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["study-dashboard", firmId],
    queryFn: () => api.get<DashboardSummary>(`/firms/${firmId}/dashboard`),
    enabled: Boolean(firmId && canReadDashboard),
  });
  // G5-06: la cartera por riesgo viene del worklist fiscal real.
  // F0.1: la ruta lleva la firma explícita (no contexto implícito).
  const worklistQuery = useQuery({
    queryKey: ["tax-worklist-dashboard", firmId],
    queryFn: () => api.get<WorklistItem[]>(`/firms/${firmId}/portfolio/tax-worklist`),
    enabled: Boolean(firmId && canReadTaxWorklist),
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

  const openSettlement = async (item: WorklistItem) => {
    if (!hasClientAccess(item.clientId)) return;
    setOpeningSettlementId(item.id);
    setClientId(item.clientId);
    try {
      if (item.period) {
        const fiscalYears = await api.get<FiscalYear[]>(
          `/firms/${firmId}/clients/${item.clientId}/fiscal-years`,
        );
        const taxPeriodStart = new Date(item.period.startDate).getTime();
        const taxPeriodEnd = new Date(item.period.endDate).getTime();
        const accountingPeriod = fiscalYears
          .flatMap((year) => year.periods)
          .find((period) => {
            const start = new Date(period.startDate).getTime();
            const end = new Date(period.endDate).getTime();
            return start <= taxPeriodEnd && end >= taxPeriodStart;
          });
        if (accountingPeriod) setPeriodId(accountingPeriod.id);
      }
      navigate("/liquidaciones");
    } catch {
      // El cliente ya quedó seleccionado; si no podemos resolver el período equivalente,
      // la bandeja fiscal sigue siendo el siguiente paso recuperable.
      navigate("/liquidaciones");
    } finally {
      setOpeningSettlementId(null);
    }
  };

  const openTaxWorkspace = () => {
    if (!clientId) {
      navigate("/clientes");
      return;
    }
    if (!periodId) {
      navigate("/configuracion-fiscal");
      return;
    }
    navigate("/expediente-mensual");
  };

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
        <div className="study-page__actions">
          <Button
            variant="ghost"
            disabled={!canReadDashboard && !canReadTaxWorklist}
            title={
              !canReadDashboard && !canReadTaxWorklist
                ? "Tu rol no tiene datos operativos para actualizar."
                : undefined
            }
            onClick={() => {
              if (canReadDashboard) void query.refetch();
              if (canReadTaxWorklist) void worklistQuery.refetch();
            }}
          >
            Actualizar
          </Button>
          {clientId ? (
            <Link className="page-primary-link" to="/bandeja">
              <Icon name="inbox" size={17} /> Revisar bandeja <Icon name="arrow-right" size={15} />
            </Link>
          ) : capabilities.has("client.manage") ? (
            <Button onClick={() => navigate("/clientes")}>
              <Icon name="users" size={17} /> Elegir cliente
            </Button>
          ) : (
            <Button disabled title="Seleccioná un cliente para abrir la bandeja.">
              <Icon name="inbox" size={17} /> Revisar bandeja
            </Button>
          )}
        </div>
      </div>

      <SectionIndex
        items={[
          { id: "dashboard-focus-title", label: "Mesa de trabajo", meta: String(attentionTotal) },
          { id: "risk-portfolio-title", label: "Liquidaciones en curso", meta: String(worklist.length) },
          { id: "portfolio-overview-title", label: "Panorama general" },
        ]}
      />

      {!canReadDashboard ? (
        <EmptyState
          title="Resumen no disponible para tu rol"
          description="Podés seguir trabajando en los módulos a los que tenés acceso desde la navegación lateral."
        />
      ) : query.isLoading || query.isError ? (
        <AsyncState
          loading={query.isLoading}
          error={query.isError}
          loadingLabel="Organizando el resumen…"
          errorTitle="No se pudo cargar el resumen"
          errorDescription="La información del estudio no está disponible en este momento."
          onRetry={() => void query.refetch()}
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
                  to={clientId ? item.to : "/clientes"}
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
              {clientId && canReadTaxWorklist ? (
                <Link to="/liquidaciones">
                  Ver todas <Icon name="arrow-right" size={14} />
                </Link>
              ) : null}
            </div>
            {!canReadTaxWorklist ? (
              <EmptyState
                size="compact"
                title="Cartera fiscal restringida"
                description="Tu rol no permite consultar liquidaciones de la firma."
              />
            ) : worklistQuery.isLoading ? (
              <div className="study-state" role="status">
                Cargando cartera…
              </div>
            ) : worklistQuery.isError ? (
              <EmptyState
                title="No se pudo cargar la cartera fiscal"
                description="La consulta falló; no interpretamos esta situación como una cartera sin liquidaciones."
                action={
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void worklistQuery.refetch()}
                  >
                    Reintentar
                  </Button>
                }
              />
            ) : worklist.length === 0 ? (
              <EmptyState
                title="Sin liquidaciones en curso"
                description="Cuando se calcule una liquidación, aparecerá acá priorizada por riesgo."
                action={
                  clientId && capabilities.has("tax.settlements.read") ? (
                    <Button onClick={openTaxWorkspace}>
                      {periodId ? "Abrir expediente mensual" : "Configurar período"}
                    </Button>
                  ) : capabilities.has("client.manage") ? (
                    <Button variant="secondary" onClick={() => navigate("/clientes")}>
                      Crear o elegir cliente
                    </Button>
                  ) : undefined
                }
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
                    {hasClientAccess(item.clientId) ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={openingSettlementId === item.id}
                        loadingLabel="Abriendo liquidación"
                        onClick={() => void openSettlement(item)}
                      >
                        Abrir <Icon name="arrow-right" size={14} />
                      </Button>
                    ) : null}
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
