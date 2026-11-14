import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, EmptyState, Notice, Table } from "@contable/design-system";
import { useNavigate } from "react-router-dom";
import { CLIENT_VAT_CONDITION_LABELS } from "@contable/contracts";
import { api, type ClientContact, type ClientSummary } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { StatusBadge } from "../ui/StatusBadge";
import {
  DenseHeader,
  DensePage,
  DenseSearch,
  DenseToolbar,
  useDensity,
} from "../ui/Dense";
import "./study.css";

const DATE_FORMAT = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});
const MONTH_FORMAT = new Intl.DateTimeFormat("es-AR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const PERSON_TYPE_LABELS: Record<string, string> = {
  FISICA: "Persona física",
  JURIDICA: "Persona jurídica",
};

const CONDITION_LABELS: Record<string, string> = {
  RESPONSABLE_INSCRIPTO: "Responsable inscripto",
  MONOTRIBUTISTA: "Monotributista",
  EXENTO: "Exento",
  NO_RESPONSABLE: "No responsable",
};

const MONTH_LABELS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : DATE_FORMAT.format(date);
}

function formatMonth(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const label = MONTH_FORMAT.format(date);
  return label.charAt(0).toLocaleUpperCase("es-AR") + label.slice(1);
}

function formatRange(startDate: string, endDate: string) {
  return `${formatDate(startDate)} – ${formatDate(endDate)}`;
}

function displayValue(value: string | null | undefined) {
  return value?.trim() || "Sin configurar";
}

function displayVatCondition(value: string | null | undefined) {
  if (!value) return "Sin configurar";
  return (CLIENT_VAT_CONDITION_LABELS as Record<string, string>)[value] ?? value;
}

function SummaryFact({
  label,
  value,
  detail,
  wrap = false,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  wrap?: boolean;
}) {
  return (
    <div className={`client-summary__fact${wrap ? " client-summary__fact--wrap" : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function SummarySectionEmpty({
  title,
  description,
  kind = "no-data",
}: {
  title: string;
  description: string;
  kind?: "no-data" | "no-results";
}) {
  return <EmptyState size="compact" kind={kind} title={title} description={description} />;
}

type SummarySectionId =
  | "overview"
  | "accounting-periods"
  | "tax-periods"
  | "obligations"
  | "base-config"
  | "tax-profile"
  | "registrations"
  | "activities"
  | "catalogs";

type SummarySectionDefinition = {
  id: SummarySectionId;
  group: "Resumen" | "Contable" | "Fiscal" | "Configuración fiscal" | "Configuración";
  label: string;
};

type SummarySearchResult = {
  sectionId: SummarySectionId;
  sectionLabel: string;
  title: string;
  detail: string;
};

function normalizeSearchValue(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-AR");
}

function matchesSearch(term: string, ...values: unknown[]) {
  return values.some((value) => normalizeSearchValue(value).includes(term));
}

function buildSearchResults(summary: ClientSummary, search: string): SummarySearchResult[] {
  const term = normalizeSearchValue(search.trim());
  if (!term) return [];

  const results: SummarySearchResult[] = [];
  const sectionHits = new Map<SummarySectionId, number>();
  const addResult = (result: SummarySearchResult) => {
    const sectionResultCount = sectionHits.get(result.sectionId) ?? 0;
    sectionHits.set(result.sectionId, sectionResultCount + 1);
    if (sectionResultCount < 6) results.push(result);
  };
  const addSectionHit = (sectionId: SummarySectionId, sectionLabel: string) => {
    if (normalizeSearchValue(sectionLabel).includes(term)) {
      addResult({ sectionId, sectionLabel, title: sectionLabel, detail: "Abrir sección" });
    }
  };

  addSectionHit("overview", "Resumen");
  if (matchesSearch(term, summary.client.legalName, summary.client.tradeName, summary.client.cuit)) {
    addResult({
      sectionId: "overview",
      sectionLabel: "Resumen",
      title: summary.client.legalName,
      detail: `CUIT ${summary.client.cuit}`,
    });
  }

  addSectionHit("accounting-periods", "Períodos contables");
  for (const year of summary.accounting.fiscalYears) {
    if (matchesSearch(term, year.label, year.status, formatDate(year.startDate), formatDate(year.endDate))) {
      addResult({
        sectionId: "accounting-periods",
        sectionLabel: "Períodos contables",
        title: year.label,
        detail: `${formatRange(year.startDate, year.endDate)} · ${year.status}`,
      });
    }
    for (const period of year.periods) {
      if (matchesSearch(term, formatMonth(period.startDate), formatRange(period.startDate, period.endDate), period.status, period.ordinal)) {
        addResult({
          sectionId: "accounting-periods",
          sectionLabel: "Períodos contables",
          title: formatMonth(period.startDate),
          detail: `${year.label} · ${formatRange(period.startDate, period.endDate)} · ${period.status}`,
        });
      }
    }
  }

  addSectionHit("tax-periods", "Períodos fiscales");
  for (const period of summary.fiscal.periods) {
    if (matchesSearch(term, period.taxType.name, period.taxType.code, period.label, formatRange(period.startDate, period.endDate))) {
      addResult({
        sectionId: "tax-periods",
        sectionLabel: "Períodos fiscales",
        title: `${period.taxType.name} · ${displayValue(period.label)}`,
        detail: `${period.taxType.code} · ${formatRange(period.startDate, period.endDate)}`,
      });
    }
  }

  addSectionHit("obligations", "Obligaciones");
  for (const obligation of summary.fiscal.obligations) {
    if (matchesSearch(term, obligation.regime.name, obligation.regime.taxType.name, obligation.regime.jurisdiction.name, obligation.period.label, formatDate(obligation.dueDate), obligation.status)) {
      addResult({
        sectionId: "obligations",
        sectionLabel: "Obligaciones",
        title: `${obligation.regime.name} · ${displayValue(obligation.period.label)}`,
        detail: `Vence ${formatDate(obligation.dueDate)} · ${obligation.status}`,
      });
    }
  }

  addSectionHit("base-config", "Ficha contable");
  const profile = summary.client.profile;
  if (profile && matchesSearch(term, profile.functionalCurrency, MONTH_LABELS[profile.fiscalYearEndMonth - 1], profile.vatCondition, profile.legalForm, profile.province, profile.activity, profile.accountingStandard, profile.iibbJurisdictions.join(" "), formatDate(profile.serviceStartDate))) {
    addResult({
      sectionId: "base-config",
      sectionLabel: "Ficha contable",
      title: "Configuración contable",
      detail: `${displayValue(profile.activity)} · ${displayValue(profile.province)}`,
    });
  }

  addSectionHit("tax-profile", "Perfil fiscal");
  for (const profileVersion of summary.fiscal.profiles) {
    if (matchesSearch(term, profileVersion.legalName, profileVersion.cuit, profileVersion.personType, profileVersion.nationalCondition, profileVersion.version, formatDate(profileVersion.validFrom), profileVersion.fiscalAddress, profileVersion.monotributoCategory, profileVersion.status)) {
      addResult({
        sectionId: "tax-profile",
        sectionLabel: "Perfil fiscal",
        title: profileVersion.legalName,
        detail: `v${profileVersion.version} · CUIT ${profileVersion.cuit} · ${profileVersion.status}`,
      });
    }
  }

  addSectionHit("registrations", "Regímenes adheridos");
  for (const registration of summary.fiscal.registrations) {
    if (matchesSearch(term, registration.regime.name, registration.regime.taxType.name, registration.regime.jurisdiction.name, formatDate(registration.validFrom), formatDate(registration.validTo), registration.status)) {
      addResult({
        sectionId: "registrations",
        sectionLabel: "Regímenes adheridos",
        title: registration.regime.name,
        detail: `${registration.regime.taxType.name} · ${registration.regime.jurisdiction.name} · ${registration.status}`,
      });
    }
  }

  addSectionHit("activities", "Actividades registradas");
  for (const activity of summary.fiscal.activities) {
    if (matchesSearch(term, activity.activity.name, activity.activity.code, activity.activity.jurisdiction.name, formatDate(activity.validFrom), formatDate(activity.validTo), activity.isPrimary ? "principal" : "secundaria")) {
      addResult({
        sectionId: "activities",
        sectionLabel: "Actividades registradas",
        title: activity.activity.name,
        detail: `${activity.activity.code} · ${activity.isPrimary ? "Principal" : "Secundaria"}`,
      });
    }
  }

  addSectionHit("catalogs", "Catálogos");
  if (matchesSearch(term, "Plan de cuentas", countsLabel(summary.counts.accounts), "Contrapartes", summary.counts.counterparties, "Centros de costo activos", summary.counts.costCenters)) {
    addResult({
      sectionId: "catalogs",
      sectionLabel: "Catálogos",
      title: "Catálogos del cliente",
      detail: `${summary.counts.accounts} cuentas · ${summary.counts.counterparties} contrapartes · ${summary.counts.costCenters} centros de costo`,
    });
  }

  return results;
}

function countsLabel(value: number) {
  return String(value);
}

export function StudyResumenCliente() {
  const [density] = useDensity();
  const { firmId, clientId, capabilities } = useClientContext();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<SummarySectionId>("overview");
  const [search, setSearch] = useState("");
  const canManageContacts = capabilities.has("client.manage");
  const query = useQuery({
    queryKey: ["client-summary", firmId, clientId],
    queryFn: () => api.get<ClientSummary>(`/firms/${firmId}/clients/${clientId}/summary`),
    enabled: Boolean(firmId && clientId),
  });
  const contactsQuery = useQuery({
    queryKey: ["client-contacts", firmId, clientId],
    queryFn: () => api.get<ClientContact[]>(`/firms/${firmId}/clients/${clientId}/contacts`),
    enabled: Boolean(firmId && clientId && canManageContacts),
  });

  const accountingPeriodCount = useMemo(
    () => query.data?.accounting.fiscalYears.reduce((total, year) => total + year.periods.length, 0) ?? 0,
    [query.data],
  );
  const activeProfile = useMemo(
    () =>
      query.data?.fiscal.profiles.find((profile) => profile.status === "ACTIVE") ??
      query.data?.fiscal.profiles.find((profile) => profile.status === "DRAFT") ??
      query.data?.fiscal.profiles[0],
    [query.data],
  );
  const primaryContact = useMemo(
    () => contactsQuery.data?.find((contact) => contact.isPrimary && contact.isActive) ?? null,
    [contactsQuery.data],
  );
  const contactValue = contactsQuery.isLoading
    ? "Cargando…"
    : contactsQuery.isError
      ? "No disponible"
      : primaryContact?.name.trim() || "No cargado";
  const contactEmailValue = contactsQuery.isLoading
    ? "Cargando…"
    : contactsQuery.isError
      ? "No disponible"
      : primaryContact?.email?.trim() || "No cargado";
  const contactPhoneValue = contactsQuery.isLoading
    ? "Cargando…"
    : contactsQuery.isError
      ? "No disponible"
      : primaryContact?.phone?.trim() || "No cargado";
  const contactAction =
    contactsQuery.isLoading || (primaryContact && !contactsQuery.isError)
      ? undefined
      : contactsQuery.isError
        ? <><span>No se pudo cargar. </span><a href="/clientes" onClick={(event) => { event.preventDefault(); navigate("/clientes", { state: { contactClientId: clientId } }); }}>Abrir Contactos</a></>
        : <a href="/clientes" onClick={(event) => { event.preventDefault(); navigate("/clientes", { state: { contactClientId: clientId } }); }}>Cargar en Contactos</a>;
  const activeActivities = query.data?.fiscal.activities.filter((item) => !item.validTo).length ?? 0;
  const openAccountingYearCount =
    query.data?.accounting.fiscalYears.filter((year) => year.status === "OPEN").length ?? 0;

  if (!firmId || !clientId) {
    return (
      <div className="study-page study-route-state">
        <EmptyState
          title="Seleccioná un cliente"
          description="Elegí un cliente para consultar sus períodos y configuración consolidada."
          action={<Button onClick={() => navigate("/clientes")}>Ir a clientes</Button>}
        />
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="study-page study-route-state" role="status" aria-live="polite">
        Preparando el resumen del cliente…
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="study-page study-route-state">
        <Notice
          tone="error"
          title="No se pudo cargar el resumen"
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Reintentar
            </Button>
          }
        >
          Reintentá para volver a cargar la ficha consolidada sin perder el cliente seleccionado.
        </Notice>
      </div>
    );
  }

  const { client, accounting, fiscal, counts } = query.data;
  const profile = client.profile;
  const sections: SummarySectionDefinition[] = [
    { id: "overview", group: "Resumen", label: "Resumen" },
    { id: "accounting-periods", group: "Contable", label: "Períodos contables" },
    { id: "tax-periods", group: "Fiscal", label: "Períodos fiscales" },
    { id: "obligations", group: "Fiscal", label: "Obligaciones" },
    { id: "tax-profile", group: "Configuración fiscal", label: "Perfil fiscal" },
    { id: "registrations", group: "Configuración fiscal", label: "Regímenes adheridos" },
    { id: "activities", group: "Configuración fiscal", label: "Actividades registradas" },
    { id: "base-config", group: "Configuración", label: "Ficha contable" },
    { id: "catalogs", group: "Configuración", label: "Catálogos" },
  ];
  const searchResults = buildSearchResults(query.data, search);
  const sectionGroups: SummarySectionDefinition["group"][] = [
    "Resumen",
    "Contable",
    "Fiscal",
    "Configuración fiscal",
    "Configuración",
  ];

  return (
    <DensePage density={density} flow className="client-summary">
      <DenseHeader
        title="Resumen del cliente"
        description={`${client.legalName}${client.tradeName ? ` · ${client.tradeName}` : ""} · CUIT ${client.cuit}`}
        actions={
          <>
          <Button variant="ghost" onClick={() => navigate("/clientes")}>
            Volver a clientes
          </Button>
          <Button variant="secondary" onClick={() => navigate("/configuracion-fiscal")}>
            Configuración fiscal
          </Button>
          <Button onClick={() => navigate("/trabajo")}>Abrir trabajo</Button>
        
          </>
        }
      />

      <DenseToolbar>
        <DenseSearch
          value={search}
          onChange={setSearch}
          placeholder="CUIT, período, impuesto, obligación…"
          label="Buscar en este cliente"
        />
        {search.trim() ? (
          <span className="client-summary__search-status" role="status" aria-live="polite">
            {searchResults.length > 0 ? `${searchResults.length} coincidencias` : "Sin coincidencias"}
          </span>
        ) : null}
      </DenseToolbar>




      <div className="client-summary__workspace">
        <label className="client-summary__index-select-control">
          <span className="sr-only">Sección del cliente</span>
          <select
            className="client-summary__index-select"
            aria-label="Sección del cliente"
            value={activeSection}
            onChange={(event) => {
              setSearch("");
              setActiveSection(event.target.value as SummarySectionId);
            }}
          >
            {sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.group === section.label ? section.label : `${section.group} · ${section.label}`}
              </option>
            ))}
          </select>
        </label>
        <nav className="client-summary__section-index" aria-label="Secciones internas del cliente">
          <div className="client-summary__index-heading">
            <p className="study-page__eyebrow">Índice de la ficha</p>
          </div>
          {sectionGroups.map((group) => {
            const groupSections = sections.filter((section) => section.group === group);
            return (
              <div className="client-summary__index-group" key={group}>
                <p>{group}</p>
                <ul>
                  {groupSections.map((section) => (
                    <li key={section.id}>
                      <Button
                        type="button"
                        variant="text"
                        size="row"
                        className="client-summary__index-link"
                        aria-current={activeSection === section.id && !search.trim() ? "page" : undefined}
                        onClick={() => {
                          setSearch("");
                          setActiveSection(section.id);
                        }}
                      >
                        <span>{section.label}</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="client-summary__detail" aria-live="polite">
          {search.trim() ? (
            <section className="client-summary__detail-section" aria-labelledby="client-summary-search-results-title">
              <div className="client-summary__detail-heading">
                <div>
                  <p className="study-page__eyebrow">Resultados de búsqueda</p>
                  <h2 id="client-summary-search-results-title">Coincidencias para “{search.trim()}”</h2>
                  <p>Seleccioná un resultado para abrir su sección y continuar desde ahí.</p>
                </div>
                {searchResults.length > 0 ? <span className="section-count">{searchResults.length}</span> : null}
              </div>
              {searchResults.length === 0 ? (
                <SummarySectionEmpty
                  kind="no-results"
                  title="No encontramos coincidencias"
                  description="Probá con una razón social, CUIT, período, impuesto o estado diferente."
                />
              ) : (
                <ul className="client-summary__search-results">
                  {searchResults.map((result, index) => (
                    <li key={`${result.sectionId}-${result.title}-${index}`}>
                      <Button
                        type="button"
                        variant="text"
                        size="row"
                        onClick={() => {
                          setSearch("");
                          setActiveSection(result.sectionId);
                        }}
                      >
                        <span>
                          <strong>{result.title}</strong>
                          <small>{result.detail}</small>
                        </span>
                        <em>{result.sectionLabel}</em>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {!search.trim() && activeSection === "overview" ? (
            <section className="client-summary__detail-section" aria-labelledby="client-summary-overview-title">
              <div className="client-summary__detail-heading">
                <div>
                  <h2 id="client-summary-overview-title">Resumen</h2>
                  <p>Una lectura rápida para decidir dónde continuar.</p>
                </div>
                <div className="client-summary__overview-meta">
                  <span className="client-summary__overview-status">
                    <span>Estado</span>
                    <StatusBadge status={client.status} variant="pill" />
                  </span>
                  <span className="client-summary__overview-created">
                    Alta en el estudio {formatDate(client.createdAt)}
                  </span>
                  <span className="client-summary__updated">Actualizado {formatDate(client.updatedAt)}</span>
                </div>
              </div>
              <dl className="client-summary__overview-facts">
                <SummaryFact
                  label="Ficha contable"
                  value={
                    <StatusBadge
                      status={profile ? "CONFIGURED" : "PENDING"}
                      className="status-badge--regular"
                    />
                  }
                />
                <SummaryFact
                  label="Onboarding fiscal"
                  value={
                    <StatusBadge
                      status={client.onboarding?.completed ? "COMPLETED" : "PENDING"}
                      className="status-badge--regular"
                    />
                  }
                />
                {openAccountingYearCount > 0 ? (
                  <SummaryFact
                    label={openAccountingYearCount === 1 ? "Ejercicio contable" : "Ejercicios contables"}
                    value={String(openAccountingYearCount)}
                  />
                ) : null}
                <SummaryFact
                  label="Actividades registradas"
                  value={String(fiscal.activities.length)}
                  detail={`${activeActivities} vigente${activeActivities === 1 ? "" : "s"}`}
                />
                <SummaryFact
                  label={fiscal.obligations.length === 1 ? "Obligación materializada" : "Obligaciones materializadas"}
                  value={String(fiscal.obligations.length)}
                />
              </dl>
              <div className="client-summary__overview-links">
                <h3>Accesos rápidos</h3>
                <ul>
                  <li>
                    <Button type="button" variant="text" size="row" onClick={() => navigate("/expediente-mensual")}>
                      <strong>Cargar período</strong>
                    </Button>
                  </li>
                  <li>
                    <Button type="button" variant="text" size="row" onClick={() => navigate("/configuracion-fiscal")}>
                      <strong>Materializar obligaciones</strong>
                    </Button>
                  </li>
                  <li>
                    <Button type="button" variant="text" size="row" onClick={() => navigate("/configuracion-fiscal")}>
                      <strong>Nueva versión del perfil</strong>
                    </Button>
                  </li>
                </ul>
              </div>
            </section>
          ) : null}

          {!search.trim() && activeSection === "accounting-periods" ? (
            <section className="client-summary__detail-section" aria-labelledby="accounting-periods-title">
              <div className="client-summary__detail-heading">
                <div>
                  <p className="study-page__eyebrow">Calendario contable</p>
                  <h2 id="accounting-periods-title">Períodos contables</h2>
                  <p>Cada ejercicio con el detalle de sus períodos y estado de cierre.</p>
                </div>
                <span className="section-count">{accountingPeriodCount}</span>
              </div>
              {accounting.fiscalYears.length === 0 ? (
                <SummarySectionEmpty
                  title="Sin ejercicios contables"
                  description="Todavía no hay ejercicios creados para este cliente."
                />
              ) : (
                <div className="client-summary__year-list">
                  {accounting.fiscalYears.map((year) => (
                    <section className="client-summary__year" key={year.id}>
                      <div className="client-summary__year-heading">
                        <div>
                          <h3>{year.label}</h3>
                          <p>{formatRange(year.startDate, year.endDate)}</p>
                        </div>
                        <StatusBadge status={year.status} />
                      </div>
                      {year.periods.length === 0 ? (
                        <p className="muted-copy">Sin períodos mensuales generados.</p>
                      ) : (
                        <div className="client-summary__period-list">
                          {year.periods.map((period) => (
                            <div className="client-summary__period-row" key={period.id}>
                              <span className="client-summary__period-number">{period.ordinal}</span>
                              <span>
                                <strong>{formatMonth(period.startDate)}</strong>
                                <small>{formatRange(period.startDate, period.endDate)}</small>
                              </span>
                              <StatusBadge status={period.status} />
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {!search.trim() && activeSection === "tax-periods" ? (
            <section className="client-summary__detail-section" aria-labelledby="tax-periods-title">
              <div className="client-summary__detail-heading">
                <div>
                  <p className="study-page__eyebrow">Calendario fiscal</p>
                  <h2 id="tax-periods-title">Períodos fiscales</h2>
                  <p>Períodos disponibles para asociar saldos, presentaciones y obligaciones.</p>
                </div>
                <span className="section-count">{fiscal.periods.length}</span>
              </div>
              {fiscal.periods.length === 0 ? (
                <SummarySectionEmpty
                  title="Sin períodos fiscales"
                  description="La configuración fiscal todavía no tiene períodos para este cliente."
                />
              ) : (
                <Table
                  rows={fiscal.periods}
                  rowKey={(period) => period.id}
                  columns={[
                    {
                      key: "taxType",
                      header: "Impuesto",
                      render: (period) => (
                        <div className="summary-table__primary">
                          <strong>{period.taxType.name}{!period.taxType.isActive ? " (oculto)" : ""}</strong>
                          <small>{period.taxType.code}{!period.taxType.isActive ? " (oculto)" : ""}</small>
                        </div>
                      ),
                    },
                    {
                      key: "range",
                      header: "Período",
                      render: (period) => (
                        <div className="summary-table__primary">
                          <strong>{displayValue(period.label)}</strong>
                          <small>{formatRange(period.startDate, period.endDate)}</small>
                        </div>
                      ),
                    },
                  ]}
                />
              )}
            </section>
          ) : null}

          {!search.trim() && activeSection === "obligations" ? (
            <section className="client-summary__detail-section" aria-labelledby="obligations-title">
              <div className="client-summary__detail-heading">
                <div>
                  <p className="study-page__eyebrow">Seguimiento fiscal</p>
                  <h2 id="obligations-title">Obligaciones materializadas</h2>
                  <p>Régimen, período, vencimiento y estado de cada obligación del cliente.</p>
                </div>
                <span className="section-count">{fiscal.obligations.length}</span>
              </div>
              {fiscal.obligations.length === 0 ? (
                <SummarySectionEmpty
                  title="Sin obligaciones materializadas"
                  description="Las obligaciones aparecen acá cuando se generan desde la configuración fiscal."
                />
              ) : (
                <Table
                  rows={fiscal.obligations}
                  rowKey={(obligation) => obligation.id}
                  columns={[
                    {
                      key: "regime",
                      header: "Régimen",
                      render: (obligation) => (
                        <div className="summary-table__primary">
                          <strong>{obligation.regime.name}{!obligation.regime.isActive ? " (oculto)" : ""}</strong>
                          <small>
                            {obligation.regime.taxType.name}{!obligation.regime.taxType.isActive ? " (oculto)" : ""} · {obligation.regime.jurisdiction.name}{!obligation.regime.jurisdiction.isActive ? " (oculto)" : ""}
                          </small>
                        </div>
                      ),
                    },
                    {
                      key: "period",
                      header: "Período",
                      render: (obligation) => (
                        <div className="summary-table__primary">
                          <strong>{displayValue(obligation.period.label)}</strong>
                          <small>{formatRange(obligation.period.startDate, obligation.period.endDate)}</small>
                        </div>
                      ),
                    },
                    {
                      key: "dueDate",
                      header: "Vencimiento",
                      render: (obligation) => <span className="tabular-copy">{formatDate(obligation.dueDate)}</span>,
                    },
                    {
                      key: "status",
                      header: "Estado",
                      render: (obligation) => <StatusBadge status={obligation.status} />,
                    },
                  ]}
                />
              )}
            </section>
          ) : null}

          {!search.trim() && activeSection === "base-config" ? (
            <section className="client-summary__detail-section" aria-labelledby="base-config-title">
              <div className="client-summary__detail-heading">
                <div>
                  <p className="study-page__eyebrow">Configuración base</p>
                  <h2 id="base-config-title">Ficha contable</h2>
                  <p>Parámetros generales que sostienen el trabajo del cliente.</p>
                </div>
              </div>
              <dl className="client-summary__facts">
                {profile ? (
                  <>
                    <SummaryFact label="Moneda funcional" value={profile.functionalCurrency} />
                    <SummaryFact label="Cierre de ejercicio" value={MONTH_LABELS[profile.fiscalYearEndMonth - 1] ?? "Sin configurar"} />
                    <SummaryFact label="Condición IVA" value={displayVatCondition(profile.vatCondition)} />
                    <SummaryFact label="Forma jurídica" value={displayValue(profile.legalForm)} />
                    <SummaryFact label="Provincia" value={displayValue(profile.province)} />
                    <SummaryFact label="Actividad principal" value={displayValue(profile.activity)} />
                    <SummaryFact label="Norma contable" value={displayValue(profile.accountingStandard)} />
                    <SummaryFact
                      label="Jurisdicciones IIBB"
                      value={profile.iibbJurisdictions.length > 0 ? profile.iibbJurisdictions.join(", ") : "Sin configurar"}
                    />
                    <SummaryFact label="Inicio del servicio" value={formatDate(profile.serviceStartDate)} />
                  </>
                ) : (
                  <SummaryFact
                    label="Ficha contable"
                    value="No cargado"
                    detail={
                      <a href="/clientes" onClick={(event) => { event.preventDefault(); navigate("/clientes", { state: { contactClientId: clientId } }); }}>
                        Completar desde Clientes
                      </a>
                    }
                  />
                )}
                {canManageContacts ? (
                  <>
                    <SummaryFact label="Contacto principal" value={contactValue} detail={contactAction} wrap />
                    <SummaryFact label="Correo de contacto" value={contactEmailValue} wrap />
                    <SummaryFact label="Teléfono de contacto" value={contactPhoneValue} wrap />
                  </>
                ) : null}
                <SummaryFact
                  label="Domicilio fiscal"
                  value={activeProfile?.fiscalAddress?.trim() || "No cargado"}
                  wrap
                  detail={
                    activeProfile?.fiscalAddress?.trim()
                      ? undefined
                      : <a href="/configuracion-fiscal" onClick={(event) => { event.preventDefault(); navigate("/configuracion-fiscal"); }}>Cargar en Onboarding fiscal</a>
                  }
                />
              </dl>
            </section>
          ) : null}

          {!search.trim() && activeSection === "tax-profile" ? (
            <section className="client-summary__detail-section" aria-labelledby="tax-profile-title">
              <div className="client-summary__detail-heading">
                <div>
                  <p className="study-page__eyebrow">Situación fiscal</p>
                  <h2 id="tax-profile-title">Perfil del contribuyente</h2>
                  <p>Versión vigente y trazabilidad de sus cambios.</p>
                </div>
                {activeProfile ? <StatusBadge status={activeProfile.status} /> : null}
              </div>
              {activeProfile ? (
                <>
                  <dl className="client-summary__facts">
                    <SummaryFact label="Razón social fiscal" value={activeProfile.legalName} />
                    <SummaryFact label="CUIT fiscal" value={activeProfile.cuit} />
                    <SummaryFact label="Tipo de persona" value={PERSON_TYPE_LABELS[activeProfile.personType] ?? activeProfile.personType} />
                    <SummaryFact label="Condición nacional" value={CONDITION_LABELS[activeProfile.nationalCondition] ?? activeProfile.nationalCondition} />
                    <SummaryFact label="Versión" value={`v${activeProfile.version}`} />
                    <SummaryFact label="Vigente desde" value={formatDate(activeProfile.validFrom)} />
                    <SummaryFact label="Categoría monotributo" value={displayValue(activeProfile.monotributoCategory)} />
                  </dl>
                  <div className="client-summary__history">
                    <h3>Historial de versiones</h3>
                    <ul>
                      {fiscal.profiles.map((profileVersion) => (
                        <li key={profileVersion.id}>
                          <span>v{profileVersion.version} · {formatDate(profileVersion.validFrom)}</span>
                          <StatusBadge status={profileVersion.status} />
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              ) : (
                <SummarySectionEmpty
                  title="Sin perfil fiscal"
                  description="Todavía no hay una versión de perfil fiscal para este cliente."
                />
              )}
            </section>
          ) : null}

          {!search.trim() && activeSection === "registrations" ? (
            <section className="client-summary__detail-section" aria-labelledby="registrations-title">
              <div className="client-summary__detail-heading">
                <div>
                  <p className="study-page__eyebrow">Inscripciones</p>
                  <h2 id="registrations-title">Regímenes adheridos</h2>
                  <p>Inscripciones fiscales y su vigencia.</p>
                </div>
                <span className="section-count">{fiscal.registrations.length}</span>
              </div>
              {fiscal.registrations.length === 0 ? (
                <SummarySectionEmpty
                  title="Sin inscripciones"
                  description="Los regímenes del cliente se administran desde configuración fiscal."
                />
              ) : (
                <ul className="client-summary__detail-list">
                  {fiscal.registrations.map((registration) => (
                    <li key={registration.id}>
                      <div>
                        <strong>{registration.regime.name}{!registration.regime.isActive ? " (oculto)" : ""}</strong>
                        <small>
                          {registration.regime.taxType.name}{!registration.regime.taxType.isActive ? " (oculto)" : ""} · {registration.regime.jurisdiction.name}{!registration.regime.jurisdiction.isActive ? " (oculto)" : ""}
                        </small>
                        <small>Desde {formatDate(registration.validFrom)}{registration.validTo ? ` · hasta ${formatDate(registration.validTo)}` : ""}</small>
                      </div>
                      <StatusBadge status={registration.status} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {!search.trim() && activeSection === "activities" ? (
            <section className="client-summary__detail-section" aria-labelledby="activities-title">
              <div className="client-summary__detail-heading">
                <div>
                  <p className="study-page__eyebrow">Actividad económica</p>
                  <h2 id="activities-title">Actividades registradas</h2>
                  <p>{activeActivities} vigentes · la principal aparece primero.</p>
                </div>
                <span className="section-count">{fiscal.activities.length}</span>
              </div>
              {fiscal.activities.length === 0 ? (
                <SummarySectionEmpty
                  title="Sin actividades"
                  description="Las actividades económicas se administran desde configuración fiscal."
                />
              ) : (
                <ul className="client-summary__detail-list">
                  {fiscal.activities.map((item) => (
                    <li key={item.id}>
                      <div>
                        <strong>{item.activity.name}{!item.activity.isActive ? " (oculto)" : ""}</strong>
                        <small>
                          {item.activity.code} · {item.activity.jurisdiction.name}{!item.activity.jurisdiction.isActive ? " (oculto)" : ""}
                        </small>
                        <small>Desde {formatDate(item.validFrom)}{item.validTo ? ` · hasta ${formatDate(item.validTo)}` : ""}</small>
                      </div>
                      <StatusBadge
                        status="INFO"
                        label={item.isPrimary ? "Principal" : "Secundaria"}
                        className="status-badge--regular"
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {!search.trim() && activeSection === "catalogs" ? (
            <section className="client-summary__detail-section" aria-labelledby="catalogs-title">
              <div className="client-summary__detail-heading">
                <div>
                  <p className="study-page__eyebrow">Maestros</p>
                  <h2 id="catalogs-title">Catálogos del cliente</h2>
                  <p>Volumen configurado para sostener la operación.</p>
                </div>
              </div>
              <ul className="client-summary__catalog-list">
                <li><span>Plan de cuentas</span><strong>{counts.accounts}</strong></li>
                <li><span>Contrapartes</span><strong>{counts.counterparties}</strong></li>
                <li><span>Centros de costo activos</span><strong>{counts.costCenters}</strong></li>
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </DensePage>
  );
}
