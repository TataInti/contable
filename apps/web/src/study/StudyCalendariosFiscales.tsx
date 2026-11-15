import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { AsyncState, Button, EmptyState, Field, Notice, useNotify } from "@contable/design-system";
import { useClientContext } from "../context/ClientContext";
import { api } from "../lib/api";
import { formatearFecha } from "../lib/formatoFechas";
import { ActionDrawer, ActionDrawerFooter } from "../ui/ActionDrawer";
import { StatusBadge } from "../ui/StatusBadge";
import {
  DenseHeader,
  DensePage,
  DenseTable,
  DenseToggleGroup,
  DenseToolbar,
  useDensity,
  type DenseColumn,
} from "../ui/Dense";
import { CalendarioFiscalFicha } from "./CalendarioFiscalFicha";
import { CalendarioFiscalSelect } from "./CalendarioFiscalSelect";
import {
  STATUS_FILTERS,
  applyStatusFilter,
  calendarIssues,
  calendarPayload,
  emptyCalendarForm,
  filtersFromParams,
  hasCalendarFilters,
  paramsWithFilters,
  serverIssues,
  statusFilterOf,
  statusLabel,
  NO_CALENDAR_FILTERS,
  type CalendarDetail,
  type CalendarFilters,
  type CalendarForm,
  type CalendarListItem,
  type StatusFilterValue,
} from "./calendariosFiscales";
import {
  useCalendarCatalogs,
  useCalendarList,
  type AuthorityOption,
  type JurisdictionOption,
} from "./calendariosFiscalesHooks";

const DESCRIPTION = "Cargá, revisá y publicá los vencimientos de cada organismo y jurisdicción.";
const READ_ONLY_DESCRIPTION =
  "Tu rol consulta los calendarios. Cargarlos y corregirlos lo hacen el Titular, el Administrador y el Preparador.";

// «Todos» no es un filtro: es la opción que aparece pulsada cuando no hay estado elegido.
const TODOS_FILTER = "todos";
const STATUS_OPTIONS = [
  { value: TODOS_FILTER, label: "Todos" },
  ...STATUS_FILTERS.map((item) => ({ value: item.value, label: item.label })),
];

function isStatusFilterValue(value: string): value is StatusFilterValue {
  return STATUS_FILTERS.some((item) => item.value === value);
}

/** Elegir «Todos» limpia la selección; los estados se suman o se quitan de a uno (selección múltiple). */
function statusesFromGroup(next: readonly string[], shown: readonly string[]): StatusFilterValue[] {
  const eligioTodos = next.includes(TODOS_FILTER) && !shown.includes(TODOS_FILTER);
  return eligioTodos ? [] : next.filter(isStatusFilterValue);
}

/**
 * «Calendarios fiscales» (Configuración): lista con filtros en la dirección y,
 * al abrir un calendario, su ficha con pestañas. Solo interfaz: la API ya existe
 * (corte 2a-i) y la baja de celdas viene con 2a-ii-a.
 */
export function StudyCalendariosFiscales() {
  const { firmId, capabilities } = useClientContext();
  const canRead = capabilities.has("tax.calendars.read");
  const canManage = capabilities.has("tax.calendars.manage");
  const canPublish = capabilities.has("tax.calendars.publish");
  const canListMembers = capabilities.has("firm.users.manage");
  const [density] = useDensity();
  const [searchParams, setSearchParams] = useSearchParams();
  const calendarId = searchParams.get("calendario");
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const [newOpen, setNewOpen] = useState(false);
  const catalogs = useCalendarCatalogs(firmId, canRead);
  const list = useCalendarList(firmId, filters, canRead && calendarId === null);
  const rows = useMemo(
    () => (list.data ? applyStatusFilter(list.data, filters.statuses) : []),
    [list.data, filters.statuses],
  );
  const hasFilters = hasCalendarFilters(filters);
  const statusSelection: readonly string[] = filters.statuses.length === 0 ? [TODOS_FILTER] : filters.statuses;

  const openCalendar = (id: string) =>
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("calendario", id);
      return next;
    });

  const backToList = () =>
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete("calendario");
      return next;
    });

  const updateFilters = (next: CalendarFilters) => setSearchParams(paramsWithFilters(searchParams, next));
  const clearFilters = () => updateFilters(NO_CALENDAR_FILTERS);

  const authorityOptions = (catalogs.authorities.data ?? []).map((item: AuthorityOption) => ({
    value: item.id,
    label: item.name,
  }));
  const jurisdictionOptions = (catalogs.jurisdictions.data ?? []).map((item: JurisdictionOption) => ({
    value: item.id,
    label: item.name,
  }));
  const currentYear = new Date().getFullYear();
  const yearOptions = [...new Set([currentYear - 1, currentYear, currentYear + 1, ...(filters.year ? [filters.year] : [])])].sort(
    (a, b) => a - b,
  );

  const columns: ReadonlyArray<DenseColumn<CalendarListItem>> = [
    {
      key: "authority",
      header: "Organismo",
      sortValue: (row) => row.taxAuthority.name,
      render: (row) => (
        <Button type="button" variant="text" size="row" onClick={() => openCalendar(row.id)}>
          {row.taxAuthority.name}
        </Button>
      ),
    },
    {
      key: "jurisdiction",
      header: "Jurisdicción",
      sortValue: (row) => row.jurisdiction.name,
      render: (row) => row.jurisdiction.name,
    },
    { key: "year", header: "Año", align: "right", sortValue: (row) => row.year, render: (row) => row.year },
    { key: "version", header: "Versión", align: "right", sortValue: (row) => row.version, render: (row) => row.version },
    {
      key: "status",
      header: "Estado",
      sortValue: (row) => statusFilterOf(row.status),
      render: (row) => <StatusBadge status={row.status} label={statusLabel(row.status)} />,
    },
    {
      key: "entries",
      header: "Celdas",
      align: "right",
      sortValue: (row) => row._count.entries,
      render: (row) => row._count.entries,
    },
    {
      key: "updated",
      header: "Última modificación",
      sortValue: (row) => row.updatedAt,
      render: (row) => formatearFecha(row.updatedAt),
    },
  ];

  const headerActions = calendarId !== null ? (
    <Button type="button" variant="secondary" onClick={backToList}>
      Volver a la lista
    </Button>
  ) : canManage ? (
    <Button type="button" variant="primary" onClick={() => setNewOpen(true)}>
      Nuevo calendario
    </Button>
  ) : undefined;

  return (
    <DensePage density={density} flow>
      <DenseHeader
        title="Calendarios fiscales"
        description={canManage ? DESCRIPTION : READ_ONLY_DESCRIPTION}
        actions={headerActions}
      />
      {!canRead ? (
        <EmptyState
          kind="no-data"
          title="No tenés acceso a los calendarios fiscales"
          description="Pedí al Titular o al Administrador el permiso de lectura de calendarios."
        />
      ) : calendarId !== null ? (
        <CalendarioFiscalFicha
          firmId={firmId}
          calendarId={calendarId}
          canManage={canManage}
          canPublish={canPublish}
          canListMembers={canListMembers}
          onBack={backToList}
          onOpen={openCalendar}
        />
      ) : (
        <>
          <DenseToolbar>
            <select
              className="dense-select"
              aria-label="Año"
              value={filters.year === null ? "" : String(filters.year)}
              onChange={(event) =>
                updateFilters({ ...filters, year: event.target.value === "" ? null : Number(event.target.value) })
              }
            >
              <option value="">Todos los años</option>
              {yearOptions.map((year) => (
                <option key={year} value={String(year)}>
                  {year}
                </option>
              ))}
            </select>
            <select
              className="dense-select"
              aria-label="Organismo"
              value={filters.taxAuthorityId ?? ""}
              onChange={(event) => updateFilters({ ...filters, taxAuthorityId: event.target.value || null })}
            >
              <option value="">Todos los organismos</option>
              {authorityOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              className="dense-select"
              aria-label="Jurisdicción"
              value={filters.jurisdictionId ?? ""}
              onChange={(event) => updateFilters({ ...filters, jurisdictionId: event.target.value || null })}
            >
              <option value="">Todas las jurisdicciones</option>
              {jurisdictionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <DenseToggleGroup
              label="Estado"
              options={STATUS_OPTIONS}
              selected={statusSelection}
              onChange={(next) => updateFilters({ ...filters, statuses: statusesFromGroup(next, statusSelection) })}
            />
            {hasFilters ? (
              <Button type="button" variant="text" size="row" onClick={clearFilters}>
                Quitar filtros
              </Button>
            ) : null}
          </DenseToolbar>
          {list.isLoading ? (
            <AsyncState
              loading
              error={false}
              loadingLabel="Cargando los calendarios"
              errorTitle=""
              errorDescription=""
              onRetry={() => undefined}
            />
          ) : null}
          {list.isError ? (
            <AsyncState
              loading={false}
              error
              loadingLabel="Cargando los calendarios"
              errorTitle="No se pudieron cargar los calendarios"
              errorDescription="Reintentá para volver a consultar la lista."
              onRetry={() => void list.refetch()}
            />
          ) : null}
          {list.data && list.isFetching ? <p>Actualizando la lista: se muestran los datos anteriores.</p> : null}
          {list.data && rows.length === 0 ? (
            hasFilters ? (
              <EmptyState
                kind="no-results"
                title="Ningún calendario coincide"
                description="Quitá algún filtro para ver los demás calendarios."
                action={
                  <Button type="button" variant="secondary" onClick={clearFilters}>
                    Quitar filtros
                  </Button>
                }
              />
            ) : (
              <EmptyState
                kind="no-data"
                title="Todavía no hay calendarios"
                description="Creá el primero para cargar los vencimientos de un organismo y una jurisdicción."
                action={
                  canManage ? (
                    <Button type="button" variant="secondary" onClick={() => setNewOpen(true)}>
                      Nuevo calendario
                    </Button>
                  ) : undefined
                }
              />
            )
          ) : null}
          {rows.length > 0 ? (
            <DenseTable<CalendarListItem>
              label="Calendarios fiscales"
              surface="integrated"
              columns={columns}
              sortHint
              rows={rows}
              rowKey={(row) => row.id}
              selectedKey={null}
              onSelect={(key) => {
                if (key) openCalendar(key);
              }}
              footer={`${rows.length} ${rows.length === 1 ? "calendario" : "calendarios"}`}
            />
          ) : null}
        </>
      )}
      <NuevoCalendarioDrawer
        isOpen={newOpen}
        onClose={() => setNewOpen(false)}
        firmId={firmId}
        authorities={catalogs.authorities}
        jurisdictions={catalogs.jurisdictions}
        onCreated={(id) => {
          setNewOpen(false);
          openCalendar(id);
        }}
      />
    </DensePage>
  );
}

const NEW_FIELD_IDS: Record<string, string> = {
  taxAuthorityId: "cal-organismo",
  jurisdictionId: "cal-jurisdiccion",
  year: "cal-anio",
  title: "cal-titulo",
};

const NEW_FIELD_ORDER = ["taxAuthorityId", "jurisdictionId", "year", "title"] as const;

function NuevoCalendarioDrawer({
  isOpen,
  onClose,
  firmId,
  authorities,
  jurisdictions,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  firmId: string | null;
  authorities: UseQueryResult<AuthorityOption[]>;
  jurisdictions: UseQueryResult<JurisdictionOption[]>;
  onCreated: (id: string) => void;
}) {
  // El panel se monta solo mientras está abierto: cada apertura empieza en blanco.
  if (!isOpen) return null;
  return (
    <NuevoCalendarioPanel
      onClose={onClose}
      firmId={firmId}
      authorities={authorities}
      jurisdictions={jurisdictions}
      onCreated={onCreated}
    />
  );
}

const EMPTY_FIELD_LABELS: ReadonlyArray<readonly [keyof CalendarForm, string]> = [
  ["taxAuthorityId", "organismo"],
  ["jurisdictionId", "jurisdicción"],
  ["year", "año"],
  ["title", "título"],
];

const INVALID_FIELD_LABELS: Record<(typeof NEW_FIELD_ORDER)[number], string> = {
  taxAuthorityId: "el organismo",
  jurisdictionId: "la jurisdicción",
  year: "el año",
  title: "el título",
};

function listaCon(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

/** Motivo junto a «Crear calendario» mientras no se puede enviar: qué falta, o qué corregir. */
function motivoDeAlta(form: CalendarForm, issues: Record<string, string>): string | null {
  const vacios = EMPTY_FIELD_LABELS.filter(([key]) => form[key].trim() === "").map(([, label]) => label);
  if (vacios.length > 0) return `Completá ${listaCon(vacios)}.`;
  const primero = NEW_FIELD_ORDER.find((key) => issues[key] !== undefined);
  return primero !== undefined ? `Revisá ${INVALID_FIELD_LABELS[primero]}.` : null;
}

function NuevoCalendarioPanel({
  onClose,
  firmId,
  authorities,
  jurisdictions,
  onCreated,
}: {
  onClose: () => void;
  firmId: string | null;
  authorities: UseQueryResult<AuthorityOption[]>;
  jurisdictions: UseQueryResult<JurisdictionOption[]>;
  onCreated: (id: string) => void;
}) {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CalendarForm>(emptyCalendarForm);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [serverNotice, setServerNotice] = useState<string | null>(null);
  const issues = calendarIssues(form);
  const motivo = motivoDeAlta(form, issues);

  const errorFor = (key: string): string | undefined =>
    (submitted || touched[key] ? issues[key] : undefined) ?? serverFields[key];

  const change = (key: keyof CalendarForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setTouched((current) => ({ ...current, [key]: true }));
    setServerFields({});
    setServerNotice(null);
  };

  const create = useMutation({
    mutationFn: () => api.post<CalendarDetail>(`/firms/${firmId}/tax-calendars`, calendarPayload(form)),
    onSuccess: (calendar) => {
      void queryClient.invalidateQueries({ queryKey: ["tax-calendars", firmId] });
      notify.success(`Calendario creado: versión ${calendar.version} en borrador.`);
      onCreated(calendar.id);
    },
    onError: (error) => {
      const parsed = serverIssues(error);
      if (Object.keys(parsed.fields).length > 0) setServerFields(parsed.fields);
      else setServerNotice(parsed.message);
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    const first = NEW_FIELD_ORDER.find((key) => issues[key] !== undefined);
    if (first) {
      document.getElementById(NEW_FIELD_IDS[first] ?? "")?.focus();
      return;
    }
    create.mutate();
  };

  return (
    <ActionDrawer
      isOpen
      onClose={onClose}
      title="Nuevo calendario"
      description="Un calendario por organismo, jurisdicción y año. Empieza en borrador: cargá sus celdas y publicalo cuando la cobertura esté completa."
      footer={
        <ActionDrawerFooter
          primary={
            <Button
              type="submit"
              form="nuevo-calendario-form"
              variant="primary"
              loading={create.isPending}
              disabled={motivo !== null}
            >
              Crear calendario
            </Button>
          }
          hint={motivo}
          onCancel={onClose}
        />
      }
    >
      <form id="nuevo-calendario-form" className="study-form" noValidate onSubmit={onSubmit}>
        {serverNotice ? <Notice tone="error">{serverNotice}</Notice> : null}
        {authorities.isError ? (
          <AsyncState
            loading={false}
            error
            loadingLabel="Cargando organismos"
            errorTitle="No se pudieron cargar los organismos"
            errorDescription="Reintentá para elegir el organismo del calendario."
            onRetry={() => void authorities.refetch()}
          />
        ) : null}
        <CalendarioFiscalSelect
          id={NEW_FIELD_IDS.taxAuthorityId ?? "cal-organismo"}
          label="Organismo"
          value={form.taxAuthorityId}
          placeholder="Elegí el organismo"
          options={(authorities.data ?? []).map((item) => ({ value: item.id, label: item.name }))}
          onChange={(value) => change("taxAuthorityId", value)}
          error={errorFor("taxAuthorityId")}
        />
        {jurisdictions.isError ? (
          <AsyncState
            loading={false}
            error
            loadingLabel="Cargando jurisdicciones"
            errorTitle="No se pudieron cargar las jurisdicciones"
            errorDescription="Reintentá para elegir la jurisdicción del calendario."
            onRetry={() => void jurisdictions.refetch()}
          />
        ) : null}
        <CalendarioFiscalSelect
          id={NEW_FIELD_IDS.jurisdictionId ?? "cal-jurisdiccion"}
          label="Jurisdicción"
          value={form.jurisdictionId}
          placeholder="Elegí la jurisdicción"
          options={(jurisdictions.data ?? []).map((item) => ({ value: item.id, label: item.name }))}
          onChange={(value) => change("jurisdictionId", value)}
          error={errorFor("jurisdictionId")}
        />
        <Field
          id={NEW_FIELD_IDS.year ?? "cal-anio"}
          name="year"
          label="Año"
          className="calendario-anio"
          hint="Entre 2000 y 2100."
          inputMode="numeric"
          value={form.year}
          onChange={(event) => change("year", event.target.value)}
          onBlur={() => setTouched((current) => ({ ...current, year: true }))}
          error={errorFor("year")}
        />
        <Field
          id={NEW_FIELD_IDS.title ?? "cal-titulo"}
          name="title"
          label="Título"
          hint="Cómo se llama en el PDF, por ejemplo «Calendario nacional 2026»."
          value={form.title}
          onChange={(event) => change("title", event.target.value)}
          onBlur={() => setTouched((current) => ({ ...current, title: true }))}
          error={errorFor("title")}
        />
      </form>
    </ActionDrawer>
  );
}
