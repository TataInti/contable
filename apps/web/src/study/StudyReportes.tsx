import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field, Notice, Table, useNotify } from "@contable/design-system";
import { api, downloadFile, type Account, type ReportRun, type ReportTemplate } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { Icon } from "../ui/Icon";
import { StatusBadge } from "../ui/StatusBadge";
import { ConfirmDialog, useConfirmAction } from "../ui/ConfirmAction";
import {
  DenseHeader,
  DensePage,
  StatStrip,
  useDensity,
} from "../ui/Dense";
import "./study.css";

interface BiPlan {
  version: number;
  clientId: string;
  fiscalPeriodId: string;
  metric: string;
  dimensions: string[];
  filters: unknown[];
  comparison: string;
  limit: number;
}

interface BiExecution {
  result: { metric: string; value: string; source: string; generatedAt: string };
  resultHash: string;
  metric: { id: string; name: string };
}

export function StudyReportes() {
  const [density] = useDensity();
  const { firmId, clientId, periodId, capabilities } = useClientContext();
  const queryClient = useQueryClient();
  const [templateId, setTemplateId] = useState("");
  const [cutoff, setCutoff] = useState(() => new Date().toISOString().slice(0, 10));
  const [biQuestion, setBiQuestion] = useState("¿Cuál es el resultado neto del período?");
  const [biResult, setBiResult] = useState<BiExecution | null>(null);
  const notify = useNotify();

  const base = firmId && clientId ? `/firms/${firmId}/clients/${clientId}` : null;
  const templates = useQuery({
    queryKey: ["report-templates", firmId, clientId],
    queryFn: () => api.get<ReportTemplate[]>(`${base}/report-templates`),
    enabled: Boolean(base),
  });
  const runs = useQuery({
    queryKey: ["report-runs", firmId, clientId],
    queryFn: () => api.get<ReportRun[]>(`${base}/report-runs`),
    enabled: Boolean(base),
  });
  const accounts = useQuery({
    queryKey: ["accounts", firmId, clientId],
    queryFn: () => api.get<Account[]>(`${base}/accounts`),
    enabled: Boolean(base && capabilities.has("report.configure")),
  });

  const selectedTemplateId = templateId || templates.data?.[0]?.id || "";
  const runReport = useMutation({
    mutationFn: () =>
      api.post<ReportRun>(`${base}/report-runs`, { templateId: selectedTemplateId, cutoff }),
    onSuccess: () => {
      notify.success("El reporte fue generado y quedó en borrador para revisión.");
      void queryClient.invalidateQueries({ queryKey: ["report-runs", firmId, clientId] });
    },
  });
  const publish = useMutation({
    mutationFn: (runId: string) => api.post(`${base}/report-runs/${runId}/publish`),
    onSuccess: () => {
      notify.success("Reporte publicado. El cliente ya puede ver esta versión en su portal.");
      void queryClient.invalidateQueries({ queryKey: ["report-runs", firmId, clientId] });
    },
  });
  const revoke = useMutation({
    mutationFn: (publicationId: string) =>
      api.post(`${base}/report-publications/${publicationId}/revoke`),
    onSuccess: () => {
      notify.success("La publicación fue revocada. El reporte ya no está disponible en el portal.");
      void queryClient.invalidateQueries({ queryKey: ["report-runs", firmId, clientId] });
    },
  });
  const exportRun = useMutation({
    mutationFn: ({ runId, format }: { runId: string; format: "pdf" | "xlsx" | "csv" }) =>
      downloadFile(`${base}/report-runs/${runId}/export?format=${format}`),
    onSuccess: (_data, variables) =>
      notify.success(`Se descargó el reporte en ${variables.format.toUpperCase()}.`),
  });
  const createBaseTemplate = useMutation({
    mutationFn: () => {
      const lines = (accounts.data ?? []).map((account, index) => ({
        position: index + 1,
        code: account.code,
        label: account.name,
        formulaAst: { op: "ACCOUNT", accountCode: account.code },
        isTotal: false,
        indent: 0,
      }));
      return api.post<ReportTemplate>(`${base}/report-templates`, {
        code: `BALANCE_${Date.now()}`,
        name: "Balance por cuentas",
        kind: "BALANCE",
        lines,
      });
    },
    onSuccess: (created) => {
      setTemplateId(created.id);
      notify.success("Plantilla base creada con las cuentas disponibles del cliente.");
      void queryClient.invalidateQueries({ queryKey: ["report-templates", firmId, clientId] });
    },
  });
  const executeBi = useMutation({
    mutationFn: async () => {
      const plan = await api.post<BiPlan>(`${base}/bi/plan`, { periodId, query: biQuestion });
      return api.post<BiExecution>(`${base}/bi/execute`, { plan });
    },
    onSuccess: setBiResult,
  });

  const rows = useMemo(() => runs.data ?? [], [runs.data]);
  const confirm = useConfirmAction();
  if (!firmId || !clientId) {
    return (
      <div className="study-page">
        <EmptyState
          title="Seleccioná un cliente"
          description="Los reportes siempre se calculan dentro de un contexto explícito."
        />
      </div>
    );
  }

  return (
    <DensePage density={density} flow>
      <DenseHeader
        eyebrow="Información verificable"
        title="Reportes y análisis"
        description="Generá estados desde el mayor canónico, revisalos y publicalos al portal."
        actions={
          <>
          <Button
            variant="ghost"
            onClick={() => {
              void Promise.all([templates.refetch(), runs.refetch()]);
            }}
          >
            Actualizar
          </Button>
          {capabilities.has("report.configure") ? (
            <Button
              variant="secondary"
              onClick={() => createBaseTemplate.mutate()}
              loading={createBaseTemplate.isPending}
              disabled={(accounts.data?.length ?? 0) === 0}
              title={
                (accounts.data?.length ?? 0) === 0
                  ? "No hay cuentas disponibles para armar una plantilla"
                  : undefined
              }
            >
              <Icon name="plus" size={17} /> Nueva plantilla base
            </Button>
          ) : null}
        
          </>
        }
      />

      <StatStrip
        label="Resumen de reportes"
        items={[
          { key: "templates", label: "Plantillas", value: templates.data?.length ?? "—" },
          { key: "runs", label: "Ejecuciones", value: rows.length },
          { key: "drafts", label: "Borradores", value: rows.filter((run) => run.status === "DRAFT").length },
          { key: "published", label: "Publicados", value: rows.filter((run) => run.status === "PUBLISHED").length },
        ]}
      />




      <section className="study-panel" aria-labelledby="generate-report-title">
        <div className="study-panel__heading">
          <div>
            <h2 id="generate-report-title">Nueva ejecución</h2>
            <p>El corte limita los asientos incluidos y queda registrado en el resultado.</p>
          </div>
        </div>
        {templates.isError ? (
          <Notice
            tone="error"
            action={<Button size="sm" variant="ghost" onClick={() => void templates.refetch()}>Reintentar</Button>}
          >
            No se pudieron cargar las plantillas.
          </Notice>
        ) : null}
        {(templates.data?.length ?? 0) === 0 && !templates.isLoading ? (
          <EmptyState
            title="Todavía no hay plantillas"
            description="Podés crear una base con todas las cuentas del cliente."
            action={
              capabilities.has("report.configure") && (accounts.data?.length ?? 0) > 0 ? (
                <Button
                  onClick={() => createBaseTemplate.mutate()}
                  loading={createBaseTemplate.isPending}
                >
                  <Icon name="plus" size={17} /> Crear plantilla base
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="study-inline-form">
            <label className="ds-field">
              <span className="ds-field__label">Plantilla</span>
              <select
                className="ctxbar__input"
                value={selectedTemplateId}
                onChange={(event) => setTemplateId(event.target.value)}
              >
                {(templates.data ?? []).map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} · v{template.version}
                  </option>
                ))}
              </select>
            </label>
            <Field
              id="report-cutoff"
              label="Fecha de corte"
              type="date"
              value={cutoff}
              onChange={(event) => setCutoff(event.target.value)}
            />
            <Button
              onClick={() => runReport.mutate()}
              loading={runReport.isPending}
              disabled={!selectedTemplateId || !capabilities.has("report.run")}
            >
              <Icon name="reports" size={17} /> Generar reporte
            </Button>
          </div>
        )}
        {runReport.isError ? (
          <Notice tone="error">
            {runReport.error.message}
          </Notice>
        ) : null}
      </section>

      <section className="study-page__section" aria-labelledby="report-history-title">
        <h2 className="study-page__section-title" id="report-history-title">
          Historial
        </h2>
        {runs.isLoading ? (
          <div className="query-state query-state--compact" role="status">
            <span className="loading-copy">Cargando ejecuciones…</span>
          </div>
        ) : runs.isError ? (
          <Notice
            tone="error"
            title="No se pudo cargar el historial"
            action={
              <Button variant="secondary" onClick={() => void runs.refetch()}>
                Reintentar
              </Button>
            }
          >
            Reintentá la consulta para actualizar las ejecuciones.
          </Notice>
        ) : rows.length === 0 ? (
          <EmptyState
            title="Sin ejecuciones"
            description="Generá el primer reporte para comenzar."
          />
        ) : (
          <Table<ReportRun>
            rows={rows}
            rowKey={(run) => run.id}
            columns={[
              { key: "template", header: "Reporte", render: (run) => run.template.name },
              {
                key: "cutoff",
                header: "Corte",
                render: (run) =>
                  new Date(run.cutoff).toLocaleDateString("es-AR", { timeZone: "UTC" }),
              },
              {
                key: "status",
                header: "Estado",
                render: (run) => <StatusBadge status={run.status} />,
              },
              {
                key: "actions",
                header: "Acciones",
                render: (run) => (
                  <div className="table-actions">
                    {(["pdf", "xlsx", "csv"] as const).map((format) => (
                      <Button
                        type="button"
                        variant="text"
                        size="row"
                        key={format}
                        disabled={exportRun.isPending}
                        onClick={() => exportRun.mutate({ runId: run.id, format })}
                      >
                        <Icon name="download" size={14} /> {format.toUpperCase()}
                      </Button>
                    ))}
                    {run.status === "DRAFT" && capabilities.has("report.publish") ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={publish.isPending}
                        onClick={() =>
                          confirm.ask({
                            title: "¿Publicar esta versión en el portal del cliente?",
                            description:
                              "Verificá el corte y el contenido antes de continuar. El cliente verá este reporte publicado.",
                            confirmLabel: "Publicar",
                            onConfirm: () => publish.mutate(run.id),
                          })
                        }
                      >
                        Publicar
                      </Button>
                    ) : null}
                    {run.status === "PUBLISHED" && capabilities.has("report.publish") ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={revoke.isPending}
                        disabled={
                          !run.publications.some(
                            (publication) => publication.status === "PUBLISHED",
                          )
                        }
                        onClick={() => {
                          const publication = run.publications.find(
                            (item) => item.status === "PUBLISHED",
                          );
                          if (!publication) return;
                          confirm.ask({
                            title: "¿Revocar la publicación?",
                            description:
                              "El reporte dejará de estar visible para el cliente en el portal.",
                            confirmLabel: "Revocar publicación",
                            tone: "danger",
                            onConfirm: () => revoke.mutate(publication.id),
                          });
                        }}
                      >
                        Revocar
                      </Button>
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
        )}
      </section>

      {exportRun.isError || revoke.isError ? (
        <Notice tone="error">
          {(exportRun.error ?? revoke.error)?.message ?? "No se pudo completar la acción."}
        </Notice>
      ) : null}

      {capabilities.has("bi.use") ? (
        <section className="study-panel" aria-labelledby="bi-title">
          <div className="study-panel__heading">
            <div>
              <h2 id="bi-title">Copiloto BI</h2>
              <p>
                La pregunta se convierte en un plan validado; las cifras se calculan desde el
                ledger, sin SQL libre.
              </p>
            </div>
          </div>
          <div className="study-page__form">
            <label className="ds-field" htmlFor="bi-question">
              <span className="ds-field__label">Pregunta</span>
              <textarea
                id="bi-question"
                className="study-textarea"
                rows={3}
                value={biQuestion}
                onChange={(event) => setBiQuestion(event.target.value)}
              />
            </label>
            <Button
              onClick={() => executeBi.mutate()}
              loading={executeBi.isPending}
              disabled={!periodId || !biQuestion.trim()}
            >
              <Icon name="spark" size={17} /> Analizar período
            </Button>
          </div>
          {executeBi.isError ? (
            <Notice tone="error">
              {executeBi.error.message}
            </Notice>
          ) : null}
          {biResult ? (
            <div className="bi-result" aria-live="polite">
              <span className="bi-result__verified">
                <Icon name="shield" size={15} /> Resultado verificado
              </span>
              <span>{biResult.metric.name}</span>
              <strong>
                {new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(
                  Number(biResult.result.value),
                )}
              </strong>
              <small>
                Fuente canónica: {biResult.result.source} · evidencia{" "}
                {biResult.resultHash.slice(0, 12)}
              </small>
            </div>
          ) : null}
        </section>
      ) : null}
      <ConfirmDialog confirm={confirm} />
    
    </DensePage>
  );
}
