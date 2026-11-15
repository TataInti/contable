import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AsyncState, Button, EmptyState, useNotify } from "@contable/design-system";
import { api } from "../lib/api";
import { StatusBadge } from "../ui/StatusBadge";
import { ConfirmDialog, useConfirmAction } from "../ui/ConfirmAction";
import {
  DenseSection,
  DenseTable,
  DenseTabs,
  DenseToolbar,
  DenseWorkspace,
  InspectorFacts,
  type DenseColumn,
} from "../ui/Dense";
import { CalendarioFiscalCeldaDrawer } from "./CalendarioFiscalCeldaDrawer";
import {
  adjustmentLabel,
  calendarTitleLine,
  conceptOrder,
  dayOf,
  groupingLabel,
  periodLabel,
  problemTarget,
  reviewStatus,
  scopeOf,
  serverIssues,
  statusLabel,
  type CalendarDetail,
  type CalendarEntryRow,
  type CalendarListItem,
  type ValidationProblem,
  type VisibilityResult,
} from "./calendariosFiscales";
import {
  useCalendarDetail,
  useCalendarList,
  useCalendarValidation,
  useMemberNames,
} from "./calendariosFiscalesHooks";

type TabId = "resumen" | "celdas" | "versiones";

const TABS_LABEL = "Secciones del calendario";

/**
 * Ficha de un calendario: Resumen (datos, acciones según estado e informe de
 * validación), Celdas (agrupadas por concepto) y Versiones del mismo alcance.
 * Cada fuente tiene su carga, su error y su reintento.
 */
export function CalendarioFiscalFicha({
  firmId,
  calendarId,
  canManage,
  canPublish,
  canListMembers,
  onBack,
  onOpen,
}: {
  firmId: string | null;
  calendarId: string;
  canManage: boolean;
  canPublish: boolean;
  canListMembers: boolean;
  onBack: () => void;
  onOpen: (calendarId: string) => void;
}) {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const confirm = useConfirmAction();
  const [tab, setTab] = useState<TabId>("resumen");
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [focusEntryId, setFocusEntryId] = useState<string | null>(null);
  const [cellDrawer, setCellDrawer] = useState<{ entry: CalendarEntryRow | null } | null>(null);

  const detail = useCalendarDetail(firmId, calendarId, true);
  const calendar = detail.data;
  const validation = useCalendarValidation(firmId, calendarId, Boolean(calendar));
  const versions = useCalendarList(
    firmId,
    calendar ? scopeOf(calendar) : { year: null, taxAuthorityId: null, jurisdictionId: null },
    Boolean(calendar),
  );
  const names = useMemberNames(firmId, canListMembers);

  useEffect(() => {
    if (tab !== "celdas" || !focusEntryId) return;
    document.querySelector<HTMLElement>(`[data-row-key="${focusEntryId}"]`)?.focus();
    setFocusEntryId(null);
  }, [tab, focusEntryId]);

  const who = (userId: string | null): string | null =>
    userId ? (names.data?.get(userId) ?? "Integrante del estudio") : null;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["tax-calendars", firmId] });
  };

  /** Dice qué versión dejó de estar visible, con el número que trae la lista del alcance. */
  const hiddenMessage = (hiddenId: string | null): string => {
    if (!hiddenId) return "";
    const version = versions.data?.find((item: CalendarListItem) => item.id === hiddenId)?.version;
    return version
      ? ` Dejó de estar visible la versión ${version}.`
      : " Dejó de estar visible otra versión de este calendario.";
  };

  const publish = useMutation({
    mutationFn: () => api.post<VisibilityResult>(`/firms/${firmId}/tax-calendars/${calendarId}/publish`),
    onSuccess: (result) => {
      notify.success(`Publicada la versión ${result.calendar.version}.${hiddenMessage(result.hiddenCalendarId)}`);
      refresh();
    },
    onError: (error) => {
      notify.error(serverIssues(error).message);
      refresh();
    },
  });

  const hide = useMutation({
    mutationFn: () => api.post<CalendarDetail>(`/firms/${firmId}/tax-calendars/${calendarId}/hide`),
    onSuccess: (hidden) => {
      notify.success(`La versión ${hidden.version} quedó oculta. Podés volver a mostrarla.`);
      refresh();
    },
    onError: (error) => {
      notify.error(serverIssues(error).message);
      refresh();
    },
  });

  const show = useMutation({
    mutationFn: () => api.post<VisibilityResult>(`/firms/${firmId}/tax-calendars/${calendarId}/show`),
    onSuccess: (result) => {
      notify.success(
        `La versión ${result.calendar.version} vuelve a estar visible.${hiddenMessage(result.hiddenCalendarId)}`,
      );
      refresh();
    },
    onError: (error) => {
      notify.error(serverIssues(error).message);
      refresh();
    },
  });

  const createFrom = useMutation({
    mutationFn: () => api.post<CalendarDetail>(`/firms/${firmId}/tax-calendars/${calendarId}/create-from`),
    onSuccess: (copy) => {
      notify.success(
        `Copia creada: versión ${copy.version} en borrador, a partir de la versión ${calendar?.version ?? ""}. Corregila y publicala cuando esté lista.`,
      );
      refresh();
      onOpen(copy.id);
    },
    onError: (error) => {
      notify.error(serverIssues(error).message);
      refresh();
    },
  });

  const removeEntry = useMutation({
    mutationFn: (entryId: string) => api.del<null>(`/firms/${firmId}/tax-calendars/${calendarId}/entries/${entryId}`),
    onSuccess: () => {
      notify.success("Celda quitada. La validación se recalcula.");
      refresh();
    },
    onError: (error) => {
      notify.error(serverIssues(error).message);
      refresh();
    },
  });

  if (detail.isLoading) {
    return <AsyncState loading error={false} loadingLabel="Cargando el calendario" errorTitle="" errorDescription="" onRetry={() => undefined} />;
  }
  if (detail.isError || !calendar) {
    const notFound = detail.error instanceof Error && "status" in detail.error && detail.error.status === 404;
    if (notFound) {
      return (
        <EmptyState
          kind="no-data"
          title="No encontramos ese calendario"
          description="Puede que se haya quitado o que pertenezca a otro estudio."
          action={<Button type="button" variant="secondary" onClick={onBack}>Volver a la lista</Button>}
        />
      );
    }
    return (
      <AsyncState
        loading={false}
        error
        loadingLabel="Cargando el calendario"
        errorTitle="No se pudo cargar el calendario"
        errorDescription="Reintentá para volver a consultarlo."
        onRetry={() => void detail.refetch()}
      />
    );
  }

  const isDraft = calendar.status === "DRAFT";
  const canEditCells = canManage && isDraft;
  const report = validation.data;
  const problems = report?.problems ?? [];
  const errors = problems.filter((problem) => problem.severity === "ERROR");
  const firstError = errors[0];
  const firstTarget = firstError ? problemTarget(firstError, calendar.entries) : null;
  const publishable = Boolean(report && report.canPublish && isDraft);
  const publishReason = report
    ? errors.length > 0
      ? `No se puede publicar: ${errors.length === 1 ? "falta 1 problema" : `faltan ${errors.length} problemas`} por resolver`
      : ""
    : validation.isError
      ? "No se pudo revisar el informe de validación: reintentá en su sección."
      : "Revisando el informe de validación antes de publicar.";

  const goToEntry = (entryId: string) => {
    setTab("celdas");
    setSelectedEntryId(entryId);
    setFocusEntryId(entryId);
  };

  const askPublish = () => {
    confirm.ask({
      title: "Publicar el calendario",
      description: `Se publica la versión ${calendar.version}. La versión visible anterior de este organismo, jurisdicción y año deja de estar visible. Las obligaciones ya creadas no cambian.`,
      confirmLabel: "Publicar calendario",
      tone: "default",
      onConfirm: () => publish.mutate(),
    });
  };

  const askRemove = (entry: CalendarEntryRow) => {
    confirm.ask({
      title: "Quitar la celda",
      description: `Se quita «${entry.conceptLabel}» (${periodLabel(entry)}, vence ${dayOf(entry.dueDate) ?? ""}). El calendario sigue en borrador y la validación se vuelve a calcular.`,
      confirmLabel: "Quitar celda",
      tone: "danger",
      onConfirm: () => removeEntry.mutate(entry.id),
    });
  };

  const tabs = [
    { id: "resumen" as const, label: "Resumen" },
    { id: "celdas" as const, label: "Celdas", count: calendar.entries.length },
    ...(versions.data ? [{ id: "versiones" as const, label: "Versiones", count: versions.data.length }] : [{ id: "versiones" as const, label: "Versiones" }]),
  ];

  const cellsNote = canEditCells
    ? ""
    : !canManage
      ? "Solo lectura: tu rol consulta las celdas. Cargarlas lo hacen el Titular, el Administrador y el Preparador."
      : isDraft
        ? ""
        : calendar.status === "PUBLISHED"
          ? "Publicado: las celdas no se editan. Para corregirlas, creá una versión nueva a partir de este."
          : "Oculto: las celdas no se editan. Mostralo o creá una versión nueva a partir de este.";

  const cellOrder = conceptOrder(calendar.entries);
  const cellColumns: ReadonlyArray<DenseColumn<CalendarEntryRow>> = [
    { key: "period", header: "Período de referencia", render: (entry) => periodLabel(entry) },
    { key: "grouping", header: "Terminaciones", render: (entry) => groupingLabel(entry) },
    {
      key: "due",
      header: "Vencimiento",
      sortValue: (entry) => dayOf(entry.dueDate) ?? "",
      align: "right",
      render: (entry) => dayOf(entry.dueDate) ?? "—",
    },
    { key: "adjustment", header: "Ajuste", render: (entry) => adjustmentLabel(entry.adjustment) },
    {
      key: "review",
      header: "Revisión",
      render: (entry) => {
        const review = reviewStatus(entry.reviewState);
        return review.status ? <StatusBadge status={review.status} label={review.label} /> : review.label;
      },
    },
    ...(canEditCells
      ? [
          {
            key: "actions",
            header: "Acciones",
            render: (entry: CalendarEntryRow) => (
              <>
                <Button
                  type="button"
                  variant="text"
                  size="row"
                  aria-label={`Editar ${entry.conceptLabel}, vence ${dayOf(entry.dueDate) ?? ""}`}
                  onClick={() => setCellDrawer({ entry })}
                >
                  Editar
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="row"
                  aria-label={`Quitar ${entry.conceptLabel}, vence ${dayOf(entry.dueDate) ?? ""}`}
                  onClick={() => askRemove(entry)}
                >
                  Quitar
                </Button>
              </>
            ),
          },
        ]
      : []),
  ];

  const versionColumns: ReadonlyArray<DenseColumn<CalendarListItem>> = [
    { key: "version", header: "Versión", align: "right", render: (item) => item.version },
    { key: "title", header: "Título", render: (item) => item.title },
    { key: "status", header: "Estado", render: (item) => <StatusBadge status={item.status} label={statusLabel(item.status)} /> },
    { key: "entries", header: "Celdas", align: "right", render: (item) => item._count.entries },
    {
      key: "published",
      header: "Publicación",
      render: (item) =>
        item.publishedAt ? `${dayOf(item.publishedAt) ?? ""} · ${who(item.publishedByUserId) ?? ""}` : "—",
    },
    {
      key: "hidden",
      header: "Ocultamiento",
      render: (item) => (item.hiddenAt ? `${dayOf(item.hiddenAt) ?? ""} · ${who(item.hiddenByUserId) ?? ""}` : "—"),
    },
    { key: "created", header: "Creada", render: (item) => dayOf(item.createdAt) ?? "—" },
  ];

  const sourceVersion = calendar.supersedesId
    ? (versions.data?.find((item) => item.id === calendar.supersedesId)?.version ?? null)
    : null;

  return (
    <DenseSection
      id="calendario-ficha"
      title={`${calendarTitleLine(calendar)} · versión ${calendar.version}`}
      surface="integrated"
    >
      {detail.isFetching ? <p>Actualizando el calendario: se muestran los datos anteriores.</p> : null}
      <DenseTabs label={TABS_LABEL} idPrefix="calendario-tab" active={tab} onChange={setTab} tabs={tabs} />
      <DenseWorkspace panelId="calendario-tab-panel">
        {tab === "resumen" ? (
          <>
            <div className="calendario-ficha__datos">
              <InspectorFacts
                items={[
                  ["Organismo", calendar.taxAuthority.name],
                  ["Jurisdicción", calendar.jurisdiction.name],
                  ["Año", String(calendar.year)],
                  ["Título", calendar.title],
                  ["Versión", String(calendar.version)],
                  ["Estado", <StatusBadge status={calendar.status} label={statusLabel(calendar.status)} />],
                  ["Celdas", String(calendar.entries.length)],
                  [
                    "Creada a partir de",
                    calendar.supersedesId ? (sourceVersion ? `versión ${sourceVersion}` : "otra versión") : null,
                  ],
                  [
                    "Publicada",
                    calendar.publishedAt ? `${dayOf(calendar.publishedAt) ?? ""} · ${who(calendar.publishedByUserId) ?? ""}` : null,
                  ],
                  ["Ocultada", calendar.hiddenAt ? `${dayOf(calendar.hiddenAt) ?? ""} · ${who(calendar.hiddenByUserId) ?? ""}` : null],
                  ["Última modificación", dayOf(calendar.updatedAt)],
                ]}
              />
            </div>
            <DenseToolbar>
              {isDraft && canPublish ? (
                <>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={!publishable || publish.isPending}
                    aria-describedby={publishReason ? "publicar-motivo" : undefined}
                    onClick={askPublish}
                  >
                    Publicar
                  </Button>
                  {publishReason ? <span id="publicar-motivo">{publishReason}</span> : null}
                  {errors.length > 1 && firstError && firstTarget ? (
                    <Button type="button" variant="text" size="row" onClick={() => goToEntry(firstTarget.entryId)}>
                      Ir al primer problema
                    </Button>
                  ) : null}
                </>
              ) : null}
              {isDraft && !canPublish ? <span>Publicar lo hacen el Titular y el Administrador.</span> : null}
              {!isDraft && canManage ? (
                <Button type="button" variant="secondary" loading={createFrom.isPending} onClick={() => createFrom.mutate()}>
                  Crear una versión a partir de este
                </Button>
              ) : null}
              {calendar.status === "PUBLISHED" && canManage ? (
                <Button type="button" variant="secondary" loading={hide.isPending} onClick={() => hide.mutate()}>
                  Ocultar
                </Button>
              ) : null}
              {calendar.status === "HIDDEN" && canManage ? (
                <Button type="button" variant="secondary" loading={show.isPending} onClick={() => show.mutate()}>
                  Mostrar
                </Button>
              ) : null}
            </DenseToolbar>
            <DenseSection id="calendario-validacion" title="Informe de validación" surface="integrated">
              {validation.isLoading ? (
                <AsyncState loading error={false} loadingLabel="Revisando el informe" errorTitle="" errorDescription="" onRetry={() => undefined} />
              ) : null}
              {validation.isError ? (
                <AsyncState
                  loading={false}
                  error
                  loadingLabel="Revisando el informe"
                  errorTitle="No se pudo revisar el informe"
                  errorDescription="Reintentá para volver a calcular la cobertura de las celdas."
                  onRetry={() => void validation.refetch()}
                />
              ) : null}
              {report && problems.length === 0 ? (
                <p>Sin problemas: la cobertura de 0 a 9 está completa en cada concepto y período.</p>
              ) : null}
              {report && problems.length > 0 ? (
                <ul className="calendario-problemas">
                  {problems.map((problem: ValidationProblem, index) => {
                    const target = problemTarget(problem, calendar.entries);
                    return (
                      <li key={`${problem.field}-${index}`}>
                        <StatusBadge status={problem.severity === "ERROR" ? "BLOCKING" : "WARNING"} />{" "}
                        <span>{problem.message}</span>{" "}
                        {target ? (
                          <Button type="button" variant="text" size="row" onClick={() => goToEntry(target.entryId)}>
                            {errors.length === 1 && problem.severity === "ERROR" ? "Ir al problema" : "Ir a la celda"}
                          </Button>
                        ) : canEditCells ? (
                          <Button type="button" variant="text" size="row" onClick={() => setCellDrawer({ entry: null })}>
                            Agregar celda
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </DenseSection>
          </>
        ) : null}
        {tab === "celdas" ? (
          <>
            <DenseToolbar>
              {canEditCells ? (
                <Button type="button" variant="primary" onClick={() => setCellDrawer({ entry: null })}>
                  Agregar celda
                </Button>
              ) : null}
              {cellsNote ? <span>{cellsNote}</span> : null}
            </DenseToolbar>
            <DenseTable<CalendarEntryRow>
              label="Celdas del calendario"
              surface="integrated"
              columns={cellColumns}
              rows={calendar.entries}
              rowKey={(entry) => entry.id}
              selectedKey={selectedEntryId}
              onSelect={setSelectedEntryId}
              groupBy={(entry) => ({
                key: entry.conceptLabel,
                label: entry.conceptLabel,
                order: cellOrder.get(entry.conceptLabel) ?? 0,
              })}
              footer={`${calendar.entries.length} ${calendar.entries.length === 1 ? "celda" : "celdas"}`}
              empty={
                <EmptyState
                  kind="no-data"
                  size="inline"
                  title="Todavía no hay celdas"
                  description="Agregá cada vencimiento con su grupo de terminaciones y su período de referencia."
                />
              }
            />
          </>
        ) : null}
        {tab === "versiones" ? (
          versions.isLoading ? (
            <AsyncState loading error={false} loadingLabel="Cargando las versiones" errorTitle="" errorDescription="" onRetry={() => undefined} />
          ) : versions.isError ? (
            <AsyncState
              loading={false}
              error
              loadingLabel="Cargando las versiones"
              errorTitle="No se pudieron cargar las versiones"
              errorDescription="Reintentá para ver el historial de este organismo, jurisdicción y año."
              onRetry={() => void versions.refetch()}
            />
          ) : (
            <DenseTable<CalendarListItem>
              label="Versiones del calendario"
              surface="integrated"
              columns={versionColumns}
              rows={[...(versions.data ?? [])].sort((a, b) => b.version - a.version)}
              rowKey={(item) => item.id}
              selectedKey={calendar.id}
              onSelect={(key) => {
                if (key) onOpen(key);
              }}
              footer={`${versions.data?.length ?? 0} ${versions.data?.length === 1 ? "versión" : "versiones"} de este organismo, jurisdicción y año`}
            />
          )
        ) : null}
      </DenseWorkspace>
      {cellDrawer ? (
        <CalendarioFiscalCeldaDrawer
          isOpen
          onClose={() => setCellDrawer(null)}
          firmId={firmId}
          calendarId={calendarId}
          entry={cellDrawer.entry}
        />
      ) : null}
      <ConfirmDialog confirm={confirm} />
    </DenseSection>
  );
}
