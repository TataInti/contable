import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, EmptyState, Notice } from "@contable/design-system";
import { useNavigate } from "react-router-dom";
import { api, type ClientContact, type ClientSummary } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import {
  DenseHeader,
  DensePage,
  DenseSearch,
  DenseToolbar,
  useDensity,
} from "../ui/Dense";
import "./study.css";
import { buildSearchResults, type SummarySectionDefinition, type SummarySectionId } from "./resumen/busqueda";
import { IndiceSecciones } from "./resumen/IndiceSecciones";
import { SummarySectionEmpty } from "./resumen/Piezas";
import { SeccionResumen } from "./resumen/secciones/SeccionResumen";
import { SeccionPeriodosContables } from "./resumen/secciones/SeccionPeriodosContables";
import { SeccionPeriodosFiscales } from "./resumen/secciones/SeccionPeriodosFiscales";
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
        <IndiceSecciones
          secciones={sections}
          activeSection={activeSection}
          hayBusqueda={Boolean(search.trim())}
          onSelect={(id) => {
            setSearch("");
            setActiveSection(id);
          }}
        />

        <div className="client-summary__detail" aria-live="polite">
          {search.trim() ? (
            <section className="client-summary__detail-section" aria-labelledby="client-summary-search-results-title">
              <div className="client-summary__detail-heading">
                <div>
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
            <SeccionResumen
              client={client}
              profile={profile}
              fiscal={fiscal}
              openAccountingYearCount={openAccountingYearCount}
              activeActivities={activeActivities}
              navigate={navigate}
            />
          ) : null}

          {!search.trim() && activeSection === "accounting-periods" ? (
            <SeccionPeriodosContables
              accounting={accounting}
              accountingPeriodCount={accountingPeriodCount}
            />
          ) : null}

          {!search.trim() && activeSection === "tax-periods" ? (
            <SeccionPeriodosFiscales
              fiscal={fiscal}
            />
          ) : null}

          {!search.trim() && activeSection === "obligations" ? (
            <SeccionObligaciones
              fiscal={fiscal}
            />
          ) : null}

          {!search.trim() && activeSection === "base-config" ? (
            <SeccionFichaContable
              profile={profile}
              canManageContacts={canManageContacts}
              contactValue={contactValue}
              contactEmailValue={contactEmailValue}
              contactPhoneValue={contactPhoneValue}
              contactAction={contactAction}
              activeProfile={activeProfile}
              clientId={clientId}
              navigate={navigate}
            />
          ) : null}

          {!search.trim() && activeSection === "tax-profile" ? (
            <SeccionPerfilFiscal
              activeProfile={activeProfile}
              fiscal={fiscal}
            />
          ) : null}

          {!search.trim() && activeSection === "registrations" ? (
            <SeccionRegimenes
              fiscal={fiscal}
            />
          ) : null}

          {!search.trim() && activeSection === "activities" ? (
            <SeccionActividades
              fiscal={fiscal}
              activeActivities={activeActivities}
            />
          ) : null}

          {!search.trim() && activeSection === "catalogs" ? (
            <SeccionCatalogos
              counts={counts}
            />
          ) : null}
        </div>
      </div>
    </DensePage>
  );
}
