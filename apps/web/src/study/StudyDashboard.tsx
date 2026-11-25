import { useState } from "react";
import { useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, SearchSelect } from "@contable/design-system";
import { Link, useNavigate } from "react-router-dom";
import { api, type FiscalYear } from "../lib/api";
import { formatearPeriodo } from "../lib/formatoFechas";
import { useClientContext } from "../context/ClientContext";
import { useSession } from "../session/SessionContext";
import { StatusBadge } from "../ui/StatusBadge";
import {
  DenseFooter,
  DenseHeader,
  DensePage,
  DenseSection,
  DenseTable,
  DenseWorkspace,
  StatStrip,
  useDensity,
  type DenseColumn,
} from "../ui/Dense";
import { AsyncState } from "../ui/AsyncState";
import { PendingFilingReceipts } from "./PendingFilingReceipts";
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

// Salida que acompaña a toda fuente restringida (P1): dice qué puede seguir haciendo la persona.
const SALIDA_RESTRINGIDA =
  "Podés seguir trabajando en los módulos a los que tenés acceso desde la navegación lateral.";

export function StudyDashboard() {
  const { firmId, clientId, periodId, capabilities, hasClientAccess, setClientId, setPeriodId } =
    useClientContext();
  const { me } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
  // G06: las constancias las consulta PendingFilingReceipts; se cuentan acá para el estado de «Actualizar».
  const receiptsFetching = useIsFetching({ queryKey: ["pending-filing-receipts", firmId] }) > 0;
  const refreshing = query.isFetching || worklistQuery.isFetching || receiptsFetching;
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
  const hasPrevious = data !== undefined || worklistQuery.data !== undefined;
  // Cada fuente dice su estado: restringida para el rol, en carga, sin respuesta o con cifras confirmadas.
  // El cero queda para una respuesta confirmada.
  const summaryValue = (value: number | undefined): number | string =>
    !canReadDashboard ? "restringido" : (value ?? (query.isError ? "no disponible" : "pendiente"));
  const worklistValue = (value: number | undefined): number | string =>
    !canReadTaxWorklist ? "restringido" : (value ?? (worklistQuery.isError ? "no disponible" : "pendiente"));
  // "En curso" deja afuera lo finalizado y lo reemplazado: lo finalizado sin presentar
  // ya figura en el recordatorio de constancias.
  const worklist = (worklistQuery.data ?? []).filter(
    (item) => item.status !== "FINALIZED" && item.status !== "SUPERSEDED",
  );
  const atRisk = worklist.filter((item) => item.status === "CHANGES_REQUESTED").length;
  const inReview = worklist.filter((item) => item.status === "IN_REVIEW").length;
  const attentionTotal =
    (data?.processing ?? 0) + (data?.openRequests ?? 0) + (data?.pendingObligations ?? 0);
  const summaryNote = !canReadDashboard
    ? `Tu rol no permite consultar el resumen del estudio. ${SALIDA_RESTRINGIDA}`
    : data
      ? null
      : query.isError
        ? "Sin respuesta del resumen: reintentá con el aviso de arriba."
        : "Consultando el resumen…";
  const worklistNote = !canReadTaxWorklist
    ? "Tu rol no permite consultar liquidaciones de la firma."
    : worklistQuery.data
      ? "No incluye las finalizadas ni las reemplazadas."
      : worklistQuery.isError
        ? "Sin respuesta de la cartera fiscal: reintentá con el aviso de la lista."
        : "Cifras pendientes hasta que responda la cartera fiscal.";
  const documentosExtraidos = data?.extracted ?? 0;
  const documentWork: { to: string; label: string; singular: string; detail: string; count: number; tone: string }[] = [
    {
      to: "/bandeja",
      label: "Documentos en procesamiento",
      singular: "Documento en procesamiento",
      detail: `${documentosExtraidos} para revisar`,
      count: data?.processing ?? 0,
      tone: "info",
    },
    {
      to: "/trabajo",
      label: "Pedidos documentales abiertos",
      singular: "Pedido documental abierto",
      detail: "Seguimiento con clientes",
      count: data?.openRequests ?? 0,
      tone: "warn",
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
          {formatearPeriodo(item.period?.startDate ?? item.cutoff, item.period?.endDate)}
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
            variant="link"
            className="dense-link"
            loading={openingSettlementId === item.id}
            loadingLabel="Abriendo liquidación"
            aria-label={`Abrir liquidación de ${item.regime?.taxType?.name ?? item.regime?.name ?? "Impuesto"}, versión ${item.version}`}
            onClick={() => void openSettlement(item)}
          >
            Abrir
          </Button>
        ) : null,
    },
  ];

  const worklistBody = !canReadTaxWorklist ? (
    <EmptyState
      size="inline"
      title="Cartera fiscal restringida"
      description={`Tu rol no permite consultar liquidaciones de la firma. ${SALIDA_RESTRINGIDA}`}
    />
  ) : worklistQuery.isError || worklistQuery.isLoading ? (
    <AsyncState
      loading={worklistQuery.isLoading}
      error={worklistQuery.isError}
      loadingLabel="Cargando cartera…"
      errorTitle="No se pudo cargar la cartera fiscal"
      errorDescription="Reintentá para volver a cargar la cartera fiscal."
      onRetry={() => void worklistQuery.refetch()}
    />
  ) : worklist.length === 0 ? (
    <EmptyState
      size="inline"
      title="Sin liquidaciones en curso"
      description="Aparecerán acá, priorizadas por riesgo, cuando se calculen."
      action={
        clientId && capabilities.has("tax.settlements.read") ? (
          <Button variant="secondary" onClick={openTaxWorkspace}>
            {periodId ? "Seguir en el Legajo" : "Configurar período"}
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
      surface="integrated"
      footer={
        <DenseFooter
          count={visibleWorklist.length}
          noun={visibleWorklist.length === 1 ? "liquidación" : "liquidaciones"}
          hint="Ordenadas por riesgo; abrí una para continuar con su revisión."
          newShortcut={false}
        />
      }
      empty={
        <EmptyState
          size="compact"
          kind="no-results"
          title="Ninguna liquidación coincide con el filtro"
          description="Ajustá el filtro para consultar otras liquidaciones."
        />
      }
    />
  );

  const extractionRate = data?.documents
    ? `${Math.round(((data.extracted ?? 0) / data.documents) * 100)}%`
    : "—";
  const participioExtraidos = data?.documents === 1 ? "extraído" : "extraídos";

  return (
    <DensePage density={density} flow>
      <DenseHeader
        title="Resumen operativo"
        description={`${firmName ? `${firmName} · ` : ""}cartera del estudio, ordenada para avanzar.`}
        actions={
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={!canReadDashboard && !canReadTaxWorklist}
              loading={refreshing}
              loadingLabel="Actualizando"
              title={
                !canReadDashboard && !canReadTaxWorklist
                  ? "Tu rol no tiene datos operativos para actualizar."
                  : undefined
              }
              onClick={() => {
                if (canReadDashboard) void query.refetch();
                if (canReadTaxWorklist) {
                  void worklistQuery.refetch();
                  void queryClient.invalidateQueries({ queryKey: ["pending-filing-receipts", firmId] });
                }
              }}
            >
              Actualizar
            </Button>
            <Button size="sm" variant="primary" onClick={openTaxWorkspace}>
              Abrir Legajo del mes
            </Button>
          </>
        }
      />
      {refreshing && hasPrevious ? (
        <p className="dense-dim" role="status">
          Actualizando: se muestran los datos de la última consulta.
        </p>
      ) : null}

      {!canReadDashboard && !canReadTaxWorklist ? (
        <EmptyState
          size="inline"
          title="Indicadores restringidos para tu rol"
          description={`Tu rol no permite consultar el resumen ni las liquidaciones de la firma. ${SALIDA_RESTRINGIDA}`}
        />
      ) : (
        <>
          <StatStrip
            variant="strip"
            label="Resumen de la cartera"
            items={[
              {
                key: "open",
                label: "Temas abiertos",
                value: summaryValue(data ? attentionTotal : undefined),
                detail: data ? (attentionTotal === 0 ? "La operación está al día" : "en la cartera activa") : undefined,
                tone: attentionTotal > 0 ? "warn" : undefined,
              },
              {
                key: "changes",
                label: "Con correcciones",
                value: worklistValue(worklistQuery.data ? atRisk : undefined),
                detail: worklistQuery.data ? "liquidaciones" : undefined,
                tone: atRisk > 0 ? "warn" : undefined,
                active: worklistFilter === "CHANGES_REQUESTED",
                pressed: worklistFilter === "CHANGES_REQUESTED",
                onSelect: canReadTaxWorklist
                  ? () => setWorklistFilter((current) => (current === "CHANGES_REQUESTED" ? "" : "CHANGES_REQUESTED"))
                  : undefined,
              },
              {
                key: "review",
                label: "En revisión",
                value: worklistValue(worklistQuery.data ? inReview : undefined),
                detail: worklistQuery.data ? "liquidaciones" : undefined,
                active: worklistFilter === "IN_REVIEW",
                pressed: worklistFilter === "IN_REVIEW",
                onSelect: canReadTaxWorklist
                  ? () => setWorklistFilter((current) => (current === "IN_REVIEW" ? "" : "IN_REVIEW"))
                  : undefined,
              },
              {
                key: "clients",
                label: "Clientes activos",
                value: summaryValue(data?.clients),
                onSelect: () => navigate("/clientes"),
              },
              {
                key: "documents",
                label: data?.documents === 1 ? "Documento" : "Documentos",
                value: summaryValue(data?.documents),
                detail: data ? `${extractionRate} ${participioExtraidos}` : undefined,
              },
            ]}
          />
          <AsyncState
            loading={query.isLoading}
            error={query.isError}
            loadingLabel="Organizando el resumen…"
            errorTitle="No se pudo cargar el resumen"
            errorDescription="La información del estudio no está disponible en este momento."
            onRetry={() => void query.refetch()}
          />
        </>
      )}

      <DenseWorkspace panelId="dashboard-panel" role="region" aria-label="Trabajo del estudio">
        {canReadTaxWorklist ? (
          <PendingFilingReceipts
            firmId={firmId}
            canOpen={hasClientAccess}
            onOpen={(openClientId) => {
              setClientId(openClientId);
              navigate("/expediente-mensual");
            }}
          />
        ) : (
          <DenseSection id="pending-receipts" title="Falta el acuse de presentación" surface="integrated">
            <EmptyState
              size="inline"
              title="Acuses restringidos para tu rol"
              description={`Tu rol no permite consultar los acuses de presentación de la firma. ${SALIDA_RESTRINGIDA}`}
            />
          </DenseSection>
        )}

        <DenseSection
          id="risk-portfolio"
          title="Liquidaciones en curso"
          description={worklistNote}
          surface="integrated"
          actions={
            worklist.length > 0 ? (
            <>
              <SearchSelect
                hideLabel
                label="Filtrar por estado"
                className="dense-select"
                value={worklistFilter}
                onChange={(value) => setWorklistFilter(value)}
                placeholder="Estado: todos"
                options={statusOptions.filter((option) => option.value !== "")}
              />
              {clientId && canReadTaxWorklist ? (
                <Link className="dense-link" to="/liquidaciones">
                  Ver todo
                </Link>
              ) : null}
            </>
            ) : undefined
          }
        >
          <div className="dense-worklist">{worklistBody}</div>
        </DenseSection>

        <DenseSection
          id="obligations"
          title="Obligaciones pendientes"
          count={data ? data.pendingObligations : undefined}
          description="Todavía sin presentar."
          surface="integrated"
          actions={
            <Link className="dense-link" to={clientId ? "/trabajo" : "/clientes"}>
              Ver todo
            </Link>
          }
        >
          {summaryNote ? <p className="dense-dim">{summaryNote}</p> : null}
        </DenseSection>

        <DenseSection id="other-circuits" title="Otros circuitos" surface="integrated">
          {summaryNote ? (
            <p className="dense-dim">{summaryNote}</p>
          ) : (
            <ul className="dense-agenda dense-agenda--con-accion">
              {documentWork.map((item) => {
                const destino = clientId ? item.to : "/clientes";
                const etiqueta = item.count === 1 ? item.singular : item.label;
                return (
                  <li key={item.label} data-tone={item.tone}>
                    <Link to={destino} className="dense-agenda__link">
                      <span className={`dense-agenda__count${item.count === 0 ? " dense-agenda__count--zero" : ""}`}>{item.count}</span>
                      <span className="dense-agenda__copy">
                        <strong>{etiqueta}</strong>
                        <small>{item.detail}</small>
                      </span>
                    </Link>
                    <Button
                      variant="link"
                      className="dense-link"
                      size="sm"
                      aria-label={`Abrir ${etiqueta}`}
                      onClick={() => navigate(destino)}
                    >
                      Ver todo
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </DenseSection>
      </DenseWorkspace>
    </DensePage>
  );
}
