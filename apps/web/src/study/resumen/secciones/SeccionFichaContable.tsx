import type { NavigateFunction } from "react-router-dom";
import { AsyncState } from "@contable/design-system";
import type { ClientContact, ClientSummary } from "../../../lib/api";
import { formatearFecha } from "../../../lib/formatoFechas";
import { DenseSection } from "../../../ui/Dense";
import { MONTH_LABELS, displayVatCondition, siglaFormaJuridica } from "../etiquetas";
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
  const condicionIva = profile?.vatCondition ? displayVatCondition(profile.vatCondition) : null;
  const formaJuridica = siglaFormaJuridica(profile?.legalForm);
  const domicilioFalta = !activeProfile?.fiscalAddress?.trim();
  const contactosListos = !cargando && !error;
  const faltan = [
    !profile && "ficha contable",
    profile && !condicionIva && "condición IVA",
    profile && !formaJuridica && "forma jurídica",
    profile && !profile.province?.trim() && "provincia",
    profile && !profile.activity?.trim() && "actividad principal",
    profile && !profile.accountingStandard?.trim() && "norma contable",
    profile && profile.iibbJurisdictions.length === 0 && "jurisdicciones IIBB",
    profile && !profile.serviceStartDate && "inicio del servicio",
    canManageContacts && contactosListos && !principal && "contacto principal",
    domicilioFalta && "domicilio fiscal",
  ].filter((texto): texto is string => Boolean(texto));

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
            <SummaryFact label="Cierre de ejercicio" value={MONTH_LABELS[profile.fiscalYearEndMonth - 1] ?? "—"} />
            {condicionIva ? <SummaryFact label="Condición IVA" value={condicionIva} /> : null}
            {formaJuridica ? <SummaryFact label="Forma jurídica" value={formaJuridica} /> : null}
            {profile.province?.trim() ? <SummaryFact label="Provincia" value={profile.province.trim()} /> : null}
            {profile.activity?.trim() ? <SummaryFact label="Actividad principal" value={profile.activity.trim()} /> : null}
            {profile.accountingStandard?.trim() ? <SummaryFact label="Norma contable" value={profile.accountingStandard.trim()} /> : null}
            {profile.iibbJurisdictions.length > 0 ? <SummaryFact label="Jurisdicciones IIBB" value={profile.iibbJurisdictions.join(", ")} /> : null}
            {profile.serviceStartDate ? <SummaryFact label="Inicio del servicio" value={formatearFecha(profile.serviceStartDate)} /> : null}
          </>
        ) : null}
        {canManageContacts && (cargando || error || principal) ? (
          <>
            <SummaryFact
              label="Contacto principal"
              value={cargando ? "Cargando…" : error ? "No disponible" : principal?.name.trim() || "No cargado"}
              detail={error ? <a href="/clientes" onClick={irAContactos}>Abrir Contactos</a> : undefined}
              wrap
            />
            {cargando || error || principal?.email?.trim() ? <SummaryFact label="Correo de contacto" value={valorDeContacto(principal?.email)} wrap /> : null}
            {cargando || error || principal?.phone?.trim() ? <SummaryFact label="Teléfono de contacto" value={valorDeContacto(principal?.phone)} wrap /> : null}
          </>
        ) : null}
        {activeProfile?.fiscalAddress?.trim() ? <SummaryFact label="Domicilio fiscal" value={activeProfile.fiscalAddress.trim()} wrap /> : null}
      </dl>
      {faltan.length > 0 ? (
        <p className="client-summary__missing">
          Falta cargar: {faltan.join(", ")}.{" "}
          <a href="/clientes" onClick={irAContactos}>Completar lo que falta</a>
          {domicilioFalta ? (
            <>
              {" · "}
              <a href="/configuracion-fiscal" onClick={(event) => { event.preventDefault(); navigate("/configuracion-fiscal"); }}>
                Cargar el domicilio fiscal
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </DenseSection>
  );
}
