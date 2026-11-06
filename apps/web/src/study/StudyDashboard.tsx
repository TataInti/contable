import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, EmptyState } from "@contable/design-system";
import { Link, useNavigate } from "react-router-dom";
import { api, type FiscalYear } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { useSession } from "../session/SessionContext";
import { StatusBadge } from "../ui/StatusBadge";
import {
  DenseFooter,
  DenseHeader,
  DenseLoading,
  DensePage,
  DenseTable,
  DenseWorkspace,
  Inspector,
  InspectorFacts,
  InspectorSection,
  StatStrip,
  useDensity,
  type DenseColumn,
} from "../ui/Dense";
import type { IconName } from "../ui/Icon";
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
  const [worklistFilter, setWorklistFilter] = useState("");
  const [density] = useDensity();
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

  const statusOptions = [
    { value: "", label: "Estado: todos" },
    { value: "CHANGES_REQUESTED", label: STATUS_LABELS.CHANGES_REQUESTED ?? "" },
    { value: "IN_REVIEW", label: STATUS_LABELS.IN_REVIEW ?? "" },
    { value: "OTHER", label: "Otros estados" },
  ];
  const visibleWorklist = worklist.filter((item) => {
    if (!worklistFilter) return true;
    if (worklistFilter === "OTHER") {
      return item.status !== "CHANGES_REQUESTED" && item.status !== "IN_REVIEW";
    }
    return item.status === worklistFilter;
  });
  const worklistColumns: DenseColumn<WorklistItem>[] = [
    {
      key: "tax",
      header: "Impuesto",
      sortValue: (item) => item.regime?.taxType?.name ?? item.regime?.name ?? "",
      render: (item) => (
        <span className="dense-name">
          <span className="dense-name__text">
            <strong>{item.regime?.taxType?.name ?? item.regime?.name ?? "Impuesto"}</strong>
            {item.regime?.name && item.regime.taxType?.name ? <small>{item.regime.name}</small> : null}
          </span>
        </span>
      ),
    },
    {
      key: "version",
      header: "Versión",
      sortValue: (item) => item.version,
      render: (item) => `v${item.version}`,
    },
    {
      key: "period",
      header: "Período",
      sortValue: (item) => item.period?.startDate ?? item.cutoff,
      render: (item) => (
        <span className="tabular-copy">
          {(item.period?.startDate ?? item.cutoff).slice(0, 10)} → {(item.period?.endDate ?? "").slice(0, 10)}
        </span>
      ),
    },
    {
      key: "risk",
      header: "Riesgo",
      sortValue: (item) => (riskTone(item.status) === "danger" ? 0 : riskTone(item.status) === "warn" ? 1 : 2),
      render: (item) =>
        riskTone(item.status) === "danger" ? (
          <span className="dense-tag dense-tag--warn">Alto</span>
        ) : riskTone(item.status) === "warn" ? (
          <span className="dense-tag">Medio</span>
        ) : (
          <span className="dense-dim">Bajo</span>
        ),
    },
    {
      key: "status",
      header: "Estado",
      sortValue: (item) => STATUS_LABELS[item.status] ?? item.status,
      render: (item) => <StatusBadge status={STATUS_LABELS[item.status] ?? item.status} />,
    },
    {
      key: "open",
      header: "",
      align: "right",
      render: (item) =>
        hasClientAccess(item.clientId) ? (
          <Button
            size="sm"
            variant="secondary"
            loading={openingSettlementId === item.id}
            loadingLabel="Abriendo liquidación"
            onClick={() => void openSettlement(item)}
          >
            Abrir
          </Button>
        ) : null,
    },
  ];

  const worklistBody = !canReadTaxWorklist ? (
    <EmptyState
      size="compact"
      title="Cartera fiscal restringida"
      description="Tu rol no permite consultar liquidaciones de la firma."
    />
  ) : worklistQuery.isLoading ? (
    <DenseLoading label="Cargando cartera…" />
  ) : worklistQuery.isError ? (
    <EmptyState
      title="No se pudo cargar la cartera fiscal"
      description="La consulta falló; no interpretamos esta situación como una cartera sin liquidaciones."
      action={
        <Button size="sm" variant="secondary" onClick={() => void worklistQuery.refetch()}>
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
    <DenseTable<WorklistItem>
      label="Liquidaciones en curso"
      columns={worklistColumns}
      rows={visibleWorklist}
      rowKey={(item) => item.id}
      footer={
        <DenseFooter
          count={visibleWorklist.length}
          noun={visibleWorklist.length === 1 ? "liquidación" : "liquidaciones"}
          hint="Ordenadas por riesgo; abrí una para continuar con su revisión."
          newShortcut={false}
        />
      }
      empty={<EmptyState size="compact" title="Ninguna liquidación coincide con el filtro" />}
    />
  );

  const extractionRate = data?.documents
    ? `${Math.round(((data.extracted ?? 0) / data.documents) * 100)}%`
    : "—";

  const agenda = (
    <Inspector
      label="Mesa de trabajo"
      eyebrow="Próximos pasos"
      title="Tu mesa de trabajo"
      subtitle={attentionTotal > 0 ? "Priorizado por urgencia" : "Sin pendientes"}
    >
      <ul className="dense-agenda">
        {workItems.map((item) => (
          <li key={item.label} data-tone={item.tone}>
            <Link to={clientId ? item.to : "/clientes"} className="dense-agenda__link">
              <span className="dense-agenda__count">{item.count}</span>
              <span className="dense-agenda__copy">
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
              <span className="dense-dim" aria-hidden="true">
                Abrir
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <InspectorSection title="Panorama general">
        <InspectorFacts
          items={[
            ["Clientes activos", data?.clients ?? 0],
            ["Documentos recibidos", data?.documents ?? 0],
            ["Con datos extraídos", data?.extracted ?? 0],
            ["Tasa de extracción", extractionRate],
          ]}
        />
        <Link className="dense-link" to="/clientes">
          Ver clientes
        </Link>
      </InspectorSection>
    </Inspector>
  );

  return (
    <DensePage density={density} flow>
      <DenseHeader
        eyebrow={TODAY.format(new Date())}
        title="Resumen operativo"
        description={`${firmName ? `${firmName} · ` : ""}prioridades reales de la cartera, ordenadas para avanzar.`}
        actions={
          <>
            <Button
              size="sm"
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
                Revisar bandeja
              </Link>
            ) : capabilities.has("client.manage") ? (
              <Button size="sm" onClick={() => navigate("/clientes")}>
                Elegir cliente
              </Button>
            ) : (
              <Button size="sm" disabled title="Seleccioná un cliente para abrir la bandeja.">
                Revisar bandeja
              </Button>
            )}
          </>
        }
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
          <StatStrip
            label="Resumen de la cartera"
            items={[
              {
                key: "open",
                label: "Temas abiertos",
                value: attentionTotal,
                detail: attentionTotal === 0 ? "La operación está al día" : "en la cartera activa",
                tone: attentionTotal > 0 ? "warn" : undefined,
              },
              {
                key: "changes",
                label: "Con correcciones",
                value: atRisk,
                detail: "liquidaciones",
                tone: atRisk > 0 ? "warn" : undefined,
                active: worklistFilter === "CHANGES_REQUESTED",
                onSelect: () =>
                  setWorklistFilter((current) =>
                    current === "CHANGES_REQUESTED" ? "" : "CHANGES_REQUESTED",
                  ),
              },
              {
                key: "review",
                label: "En revisión",
                value: inReview,
                detail: "liquidaciones",
                active: worklistFilter === "IN_REVIEW",
                onSelect: () =>
                  setWorklistFilter((current) => (current === "IN_REVIEW" ? "" : "IN_REVIEW")),
              },
              { key: "clients", label: "Clientes activos", value: data?.clients ?? 0, onSelect: () => navigate("/clientes") },
              {
                key: "documents",
                label: "Documentos",
                value: data?.documents ?? 0,
                detail: `${extractionRate} extraídos`,
              },
            ]}
          />

          <DenseWorkspace panelId="dashboard-panel" inspector={agenda}>
            <section className="dense-block" aria-labelledby="risk-portfolio-title">
              <header className="dense-block__head">
                <div className="dense-block__title">
                  <h2 id="risk-portfolio-title">Liquidaciones en curso</h2>
                  <span className="dense-count">{worklist.length}</span>
                </div>
                <p>
                  {atRisk} con correcciones pendientes · {inReview} en revisión
                </p>
                <div className="dense-block__actions">
                  <select
                    className="dense-select"
                    aria-label="Filtrar por estado"
                    value={worklistFilter}
                    onChange={(event) => setWorklistFilter(event.target.value)}
                  >
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {clientId && canReadTaxWorklist ? (
                    <Link className="dense-link" to="/liquidaciones">
                      Ver todas
                    </Link>
                  ) : null}
                </div>
              </header>
              {worklistBody}
            </section>
          </DenseWorkspace>
        </>
      )}
    </DensePage>
  );
}
