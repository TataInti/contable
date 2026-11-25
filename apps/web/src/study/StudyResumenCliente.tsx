import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AsyncState, Button, EmptyState } from "@contable/design-system";
import { useNavigate } from "react-router-dom";
import { api, type ClientContact, type ClientSummary } from "../lib/api";
import { formatCuit } from "../lib/cuit";
import { useClientContext } from "../context/ClientContext";
import { DenseHeader, DensePage, DenseSearch, DenseToolbar, useDensity } from "../ui/Dense";
import "./study.css";
import { buildSearchResults, type SummarySectionDefinition, type SummarySectionId } from "./resumen/busqueda";
import { etiquetaCoincidencias } from "./resumen/etiquetas";
import { IndiceSecciones } from "./resumen/IndiceSecciones";
import { SummarySectionEmpty } from "./resumen/Piezas";
import { SeccionResumen } from "./resumen/secciones/SeccionResumen";
import { SeccionPeriodosContables } from "./resumen/secciones/SeccionPeriodosContables";
import { SeccionObligaciones } from "./resumen/secciones/SeccionObligaciones";
import { SeccionFichaContable } from "./resumen/secciones/SeccionFichaContable";
import { SeccionPerfilFiscal } from "./resumen/secciones/SeccionPerfilFiscal";
import { SeccionRegimenes } from "./resumen/secciones/SeccionRegimenes";
import { SeccionActividades } from "./resumen/secciones/SeccionActividades";
import { SeccionCatalogos } from "./resumen/secciones/SeccionCatalogos";

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
  const contactos = {
    cargando: contactsQuery.isPending && contactsQuery.fetchStatus !== "idle",
    error: contactsQuery.isError,
    principal: primaryContact,
    onReintentar: () => void contactsQuery.refetch(),
  };
  const activeActivities = query.data?.fiscal.activities.filter((item) => !item.validTo).length ?? 0;
  const openAccountingYearCount =
    query.data?.accounting.fiscalYears.filter((year) => year.status === "OPEN").length ?? 0;
  const cargandoResumen = query.isPending && query.fetchStatus !== "idle";

  const acciones = (
    <>
      <Button variant="ghost" onClick={() => navigate("/clientes")}>
        Volver a clientes
      </Button>
      <Button variant="secondary" onClick={() => navigate("/configuracion-fiscal")}>
        Configuración fiscal
      </Button>
      <Button onClick={() => navigate("/expediente-mensual")}>Abrir Legajo</Button>
    </>
  );

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

  if (query.isError) {
    return (
      <DensePage density={density} flow className="client-summary">
        <DenseHeader title="Resumen del cliente" actions={acciones} />
        <AsyncState
          loading={false}
          error
          loadingLabel=""
          errorTitle="No pudimos cargar el resumen del cliente"
          errorDescription="Revisá tu conexión e intentá de nuevo."
          onRetry={() => void query.refetch()}
        />
      </DensePage>
    );
  }

  if (cargandoResumen || !query.data) {
    return (
      <DensePage density={density} flow className="client-summary">
        <DenseHeader title="Resumen del cliente" actions={acciones} />
        <div className="study-route-state" role="status">
          Preparando el resumen del cliente…
        </div>
      </DensePage>
    );
  }

  const { client, accounting, fiscal, counts } = query.data;
  const profile = client.profile;
  const nombreComercial = client.tradeName?.trim();
  const mostrarComercial = Boolean(nombreComercial) && nombreComercial?.toLocaleLowerCase() !== client.legalName.trim().toLocaleLowerCase();
  const descripcionCliente = `${mostrarComercial ? `${nombreComercial} · ` : ""}CUIT ${formatCuit(client.cuit)}`;
  const hayContable = accountingPeriodCount > 0;
  const hayCatalogos = counts.accounts + counts.counterparties + counts.costCenters > 0;
  const sections: SummarySectionDefinition[] = [
    { id: "overview", group: "Datos generales", label: "Datos generales" },
    ...(hayContable ? [{ id: "accounting-periods" as const, group: "Contable" as const, label: "Períodos contables" }] : []),
    { id: "obligations", group: "Fiscal", label: "Obligaciones" },
    { id: "tax-profile", group: "Configuración fiscal", label: "Perfil fiscal" },
    { id: "registrations", group: "Configuración fiscal", label: "Regímenes adheridos" },
    { id: "activities", group: "Configuración fiscal", label: "Actividades registradas" },
    { id: "base-config", group: "Configuración", label: "Ficha contable" },
    ...(hayCatalogos ? [{ id: "catalogs" as const, group: "Configuración" as const, label: "Catálogos" }] : []),
  ];
  const seccionesVisibles = new Set(sections.map((section) => section.id));
  const searchResults = buildSearchResults(query.data, search).filter((result) => seccionesVisibles.has(result.sectionId));
  const termino = search.trim();

  return (
    <DensePage density={density} flow className="client-summary">
      <DenseHeader
        title={client.legalName}
        description={descripcionCliente}
        actions={acciones}
      />

      <DenseToolbar>
        <DenseSearch
          value={search}
          onChange={setSearch}
          placeholder="Buscar en el cliente"
          label="Buscar en este cliente"
        />
        {termino ? <span className="client-summary__search-status">{etiquetaCoincidencias(searchResults.length)}</span> : null}
      </DenseToolbar>
      <div className="client-summary__workspace">
        <IndiceSecciones
          secciones={sections}
          activeSection={activeSection}
          hayBusqueda={Boolean(termino)}
          onSelect={(id) => {
            setSearch("");
            setActiveSection(id);
          }}
        />

        <div className="client-summary__detail">
          {termino ? (
            <section className="client-summary__detail-section" aria-labelledby="client-summary-search-results-title">
              <div className="client-summary__detail-heading">
                <div>
                  <h2 id="client-summary-search-results-title" aria-live="polite">
                    Coincidencias para “{termino}”
                  </h2>
                  {searchResults.length > 0 ? (
                    <p>Seleccioná un resultado para abrir su sección y continuar desde ahí.</p>
                  ) : null}
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

          {!termino && activeSection === "overview" ? (
            <SeccionResumen
              client={client}
              profile={profile}
              fiscal={fiscal}
              openAccountingYearCount={openAccountingYearCount}
              activeActivities={activeActivities}
              navigate={navigate}
            />
          ) : null}

          {!termino && activeSection === "accounting-periods" ? (
            <SeccionPeriodosContables accounting={accounting} accountingPeriodCount={accountingPeriodCount} />
          ) : null}

          {!termino && activeSection === "obligations" ? <SeccionObligaciones fiscal={fiscal} /> : null}

          {!termino && activeSection === "base-config" ? (
            <SeccionFichaContable
              profile={profile}
              canManageContacts={canManageContacts}
              contactos={contactos}
              activeProfile={activeProfile}
              clientId={clientId}
              navigate={navigate}
            />
          ) : null}

          {!termino && activeSection === "tax-profile" ? (
            <SeccionPerfilFiscal activeProfile={activeProfile} fiscal={fiscal} />
          ) : null}

          {!termino && activeSection === "registrations" ? <SeccionRegimenes fiscal={fiscal} /> : null}

          {!termino && activeSection === "activities" ? (
            <SeccionActividades fiscal={fiscal} activeActivities={activeActivities} />
          ) : null}

          {!termino && activeSection === "catalogs" ? <SeccionCatalogos counts={counts} /> : null}
        </div>
      </div>
    </DensePage>
  );
}
