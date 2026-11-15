import type { ReactNode } from "react";
import type { NavigateFunction } from "react-router-dom";
import type { ClientSummary } from "../../../lib/api";
import { formatearFecha } from "../../../lib/formatoFechas";
import { MONTH_LABELS, displayValue, displayVatCondition } from "../etiquetas";
import { SummaryFact } from "../Piezas";

type Props = {
  profile: ClientSummary["client"]["profile"];
  canManageContacts: boolean;
  contactValue: string;
  contactEmailValue: string;
  contactPhoneValue: string;
  contactAction: ReactNode;
  activeProfile: ClientSummary["fiscal"]["profiles"][number] | undefined;
  clientId: string | null;
  navigate: NavigateFunction;
};

export function SeccionFichaContable({ profile, canManageContacts, contactValue, contactEmailValue, contactPhoneValue, contactAction, activeProfile, clientId, navigate }: Props) {
  return (
    <section className="client-summary__detail-section" aria-labelledby="base-config-title">
      <div className="client-summary__detail-heading">
        <div>
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
            <SummaryFact label="Inicio del servicio" value={formatearFecha(profile.serviceStartDate)} />
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
  );
}
