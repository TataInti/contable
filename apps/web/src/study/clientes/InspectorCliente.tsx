import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { Button, EmptyState, Notice } from "@contable/design-system";
import type { ClientContact } from "../../lib/api";
import { formatCuit } from "../../lib/cuit";
import { formatearFecha } from "../../lib/formatoFechas";
import { Inspector, InspectorFacts, InspectorSection } from "../../ui/Dense";
import { StatusBadge } from "../../ui/StatusBadge";
import { MONTH_LONG, profileGaps, vatLabel } from "./etiquetas";
import type { ClientWithProfile } from "./tipos";

const missingProfileFields = profileGaps;

interface InspectorClienteProps {
  selectedClient: ClientWithProfile;
  capabilities: ReadonlySet<string>;
  canManage: boolean;
  contactsQuery: UseQueryResult<ClientContact[], Error>;
  toggleContactState: UseMutationResult<ClientContact, Error, ClientContact>;
  openContactEditor: (contact?: ClientContact) => void;
  startClientEdit: (client: ClientWithProfile) => void;
  startStatusChange: (client: ClientWithProfile) => void;
  openClientSummary: (id: string) => void;
  openClientWorkspace: (id: string) => void;
  setDeletingClient: (client: ClientWithProfile) => void;
  setSelectedId: (id: string | null) => void;
}

export function InspectorCliente({
  selectedClient,
  capabilities,
  canManage,
  contactsQuery,
  toggleContactState,
  openContactEditor,
  startClientEdit,
  startStatusChange,
  openClientSummary,
  openClientWorkspace,
  setDeletingClient,
  setSelectedId,
}: InspectorClienteProps) {
  // C03: sin respuesta el contador no dice 0; en carga dice «pendiente» y con error «no disponible».
  const cantidadContactos = contactsQuery.data?.length ?? 0;
  const rotuloContactos = contactsQuery.isLoading
    ? "pendiente"
    : contactsQuery.isError
      ? "no disponible"
      : `${cantidadContactos} ${cantidadContactos === 1 ? "contacto" : "contactos"}`;
  return (
    <Inspector
      label={`Detalle de ${selectedClient.legalName}`}
      title={selectedClient.legalName}
      subtitle={`CUIT ${formatCuit(selectedClient.cuit)}`}
      leading={
        <span className="dense-avatar dense-avatar--lg" aria-hidden="true">
          {selectedClient.legalName.slice(0, 1).toLocaleUpperCase("es-AR")}
        </span>
      }
      banner={
        missingProfileFields(selectedClient).length > 0 ? (
          <Notice
            tone="warning"
            action={
              canManage ? (
                <Button size="sm" variant="secondary" onClick={() => startClientEdit(selectedClient)}>
                  Completar
                </Button>
              ) : undefined
            }
          >
            Ficha incompleta: falta {missingProfileFields(selectedClient).join(", ")}.
          </Notice>
        ) : undefined
      }
      onClose={() => setSelectedId(null)}
      footer={
        <div className="dense-inspector-actions">
          <Button size="sm" onClick={() => openClientSummary(selectedClient.id)}>
            Abrir
          </Button>
          {canManage ? (
            <Button size="sm" variant="secondary" onClick={() => startClientEdit(selectedClient)}>
              Editar
            </Button>
          ) : null}
          <details className="dense-inspector-actions__menu">
            <summary className="dense-inspector-actions__trigger">Más acciones</summary>
            <div className="dense-inspector-actions__items" role="group" aria-label="Acciones secundarias">
              <Button size="sm" variant="ghost" onClick={() => openClientWorkspace(selectedClient.id)}>
                Abrir trabajo
              </Button>
              {canManage ? (
                <>
                  <Button size="sm" variant="ghost" onClick={() => startStatusChange(selectedClient)}>
                    Cambiar estado
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      document
                        .getElementById(`client-contacts-${selectedClient.id}`)
                        ?.scrollIntoView?.({ block: "start" })
                    }
                  >
                    Contactos
                  </Button>
                </>
              ) : null}
              {capabilities.has("data.delete") ? (
                <Button size="sm" variant="danger" onClick={() => setDeletingClient(selectedClient)}>
                  Eliminar
                </Button>
              ) : null}
            </div>
          </details>
        </div>
      }
    >
      <InspectorSection title="Identificación">
        <InspectorFacts
          items={[
            ["Estado", <StatusBadge key="s" status={selectedClient.status} />],
            ["Nombre de fantasía", selectedClient.tradeName || "—"],
            ["Forma jurídica", selectedClient.profile?.legalForm || "—"],
            ["Provincia", selectedClient.profile?.province || "—"],
            ["Actividad", selectedClient.profile?.activity || "—"],
          ]}
        />
      </InspectorSection>
      <InspectorSection title="Perfil fiscal y contable">
        <InspectorFacts
          items={[
            ["Condición IVA", vatLabel(selectedClient.profile?.vatCondition) || "—"],
            ["Norma contable", selectedClient.profile?.accountingStandard || "—"],
            [
              "Cierre del ejercicio",
              selectedClient.profile?.fiscalYearEndMonth
                ? MONTH_LONG[selectedClient.profile.fiscalYearEndMonth - 1]
                : "—",
            ],
            ["Moneda funcional", selectedClient.profile?.functionalCurrency || "—"],
            [
              "Jurisdicciones IIBB",
              selectedClient.profile?.iibbJurisdictions?.length
                ? selectedClient.profile.iibbJurisdictions.join(", ")
                : "—",
            ],
            ["Inicio del servicio", formatearFecha(selectedClient.profile?.serviceStartDate)],
          ]}
        />
      </InspectorSection>
      {canManage ? (
        <div
          id={`client-contacts-${selectedClient.id}`}
          className="client-contacts__anchor"
        >
        <InspectorSection title="Contactos">
          <div className="client-contacts__toolbar">
            <span className="dense-dim">
              {rotuloContactos}
            </span>
            <Button size="sm" variant="secondary" onClick={() => openContactEditor()}>
              Nuevo contacto
            </Button>
          </div>
          {contactsQuery.isLoading ? (
            <p role="status">Cargando contactos…</p>
          ) : contactsQuery.isError ? (
            <Notice
              tone="error"
              action={
                <Button size="sm" variant="secondary" onClick={() => void contactsQuery.refetch()}>
                  Reintentar
                </Button>
              }
            >
              No se pudieron cargar los contactos. Reintentá.
            </Notice>
          ) : contactsQuery.data?.length ? (
            <div className="client-contact-list">
              {contactsQuery.data.map((contact) => (
                <article
                  key={contact.id}
                  className={`client-contact${contact.isActive ? "" : " client-contact--inactive"}`}
                >
                  <div className="client-contact__main">
                    <div className="client-contact__heading">
                      <strong>{contact.name}</strong>
                      {contact.isPrimary ? <span className="dense-tag">Principal</span> : null}
                      {!contact.isActive ? <span className="dense-tag">Oculto</span> : null}
                    </div>
                    <div className="client-contact__details">
                      {contact.function ? <span>{contact.function}</span> : null}
                      {contact.email ? <span>{contact.email}</span> : null}
                      {contact.phone ? <span>{contact.phone}</span> : null}
                    </div>
                  </div>
                  <div className="client-contact__actions">
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Editar contacto de ${contact.name}`}
                      onClick={() => openContactEditor(contact)}
                    >
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`${contact.isActive ? "Ocultar" : "Mostrar"} contacto de ${contact.name}`}
                      loading={toggleContactState.isPending}
                      onClick={() => toggleContactState.mutate(contact)}
                    >
                      {contact.isActive ? "Ocultar" : "Mostrar"}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              size="compact"
              title="Todavía no hay contactos"
              description="Agregá personas de referencia para este cliente."
            />
          )}
        </InspectorSection>
        </div>
      ) : null}
    </Inspector>
  );
}
