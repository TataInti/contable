import type { NavigateFunction } from "react-router-dom";
import { AsyncState } from "@contable/design-system";
import type { ClientContact, ClientSummary } from "../../../lib/api";
import { formatearFecha } from "../../../lib/formatoFechas";
import { DenseSection } from "../../../ui/Dense";
import { MONTH_LABELS, displayValue, displayVatCondition } from "../etiquetas";
import { SummaryFact } from "../Piezas";

type Props = {
  profile: ClientSummary["client"]["profile"];
  canManageContacts: boolean;
  contactos: {
    cargando: boolean;
    error: boolean;
    principal: ClientContact | null;
    onReintentar: () => void;
  };
  activeProfile: ClientSummary["fiscal"]["profiles"][number] | undefined;
  clientId: string | null;
  navigate: NavigateFunction;
};

export function SeccionFichaContable({ profile, canManageContacts, contactos, activeProfile, clientId, navigate }: Props) {
  const { cargando, error, principal } = contactos;
  const valorDeContacto = (dato: string | null | undefined) =>
    cargando ? "Cargando…" : error ? "No disponible" : dato?.trim() || "No cargado";
  const irAContactos = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    navigate("/clientes", { state: { contactClientId: clientId } });
  };
  const accionContacto =
    cargando || (principal && !error) ? undefined : error ? (
      <a href="/clientes" onClick={irAContactos}>Abrir Contactos</a>
    ) : (
      <a href="/clientes" onClick={irAContactos}>Cargar en Contactos</a>
    );

  return (
    <DenseSection
      id="rc-ficha"
      title="Ficha contable"
      description="Parámetros generales que sostienen el trabajo del cliente."
      surface="integrated"
    >
      {error && canManageContacts ? (
        <AsyncState
          loading={false}
          error
          loadingLabel=""
          errorTitle="No pudimos cargar los contactos"
          errorDescription="Revisá tu conexión e intentá de nuevo."
          onRetry={contactos.onReintentar}
          className="client-summary__contacts-error"
        />
      ) : null}
      <dl className="client-summary__facts">
        {profile ? (
          <>
            <SummaryFact label="Moneda funcional" value={profile.functionalCurrency} />
            <SummaryFact label="Cierre de ejercicio" value={MONTH_LABELS[profile.fiscalYearEndMonth - 1] ?? "Sin configurar"} />
            <SummaryFact label="Condición IVA" value={displayVatCondition(profile.vatCondition)} />
            <SummaryFact label="Forma jurídica" value={displayValue(profile.legalForm)} />
            <SummaryFact label="Provincia" value={displayValue(profile.province)} />
            <SummaryFact label="Actividad principal" value={displayValue(profile.activity)} />
            <SummaryFact label="Norma contable" value={profile.accountingStandard?.trim() || "Sin norma contable"} />
            <SummaryFact
              label="Jurisdicciones IIBB"
              value={profile.iibbJurisdictions.length > 0 ? profile.iibbJurisdictions.join(", ") : "Sin configurar"}
            />
            <SummaryFact label="Inicio del servicio" value={formatearFecha(profile.serviceStartDate)} />
          </>
        ) : (
          <SummaryFact
            label="Ficha contable"
            value="No cargado"
            detail={
              <a href="/clientes" onClick={irAContactos}>
                Completar desde Clientes
              </a>
            }
          />
        )}
        {canManageContacts ? (
          <>
            <SummaryFact
              label="Contacto principal"
              value={cargando ? "Cargando…" : error ? "No disponible" : principal?.name.trim() || "No cargado"}
              detail={accionContacto}
              wrap
            />
            <SummaryFact label="Correo de contacto" value={valorDeContacto(principal?.email)} wrap />
            <SummaryFact label="Teléfono de contacto" value={valorDeContacto(principal?.phone)} wrap />
          </>
        ) : null}
        <SummaryFact
          label="Domicilio fiscal"
          value={activeProfile?.fiscalAddress?.trim() || "No cargado"}
          wrap
          detail={
            activeProfile?.fiscalAddress?.trim() ? undefined : (
              <a href="/configuracion-fiscal" onClick={(event) => { event.preventDefault(); navigate("/configuracion-fiscal"); }}>
                Cargar en Configuración fiscal
              </a>
            )
          }
        />
      </dl>
    </DenseSection>
  );
}
