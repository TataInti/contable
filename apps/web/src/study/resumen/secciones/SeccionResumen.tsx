import type { NavigateFunction } from "react-router-dom";
import { Button } from "@contable/design-system";
import { clientConfigurationMissing } from "@contable/contracts";
import type { ClientSummary } from "../../../lib/api";
import { formatearFecha } from "../../../lib/formatoFechas";
import { DenseSection } from "../../../ui/Dense";
import { StatusBadge } from "../../../ui/StatusBadge";
import { SummaryFact } from "../Piezas";
import { fiscalConfigurationReadinessFor } from "../../fiscal/pasos";

type Props = {
  client: ClientSummary["client"];
  profile: ClientSummary["client"]["profile"];
  fiscal: ClientSummary["fiscal"];
  openAccountingYearCount: number;
  activeActivities: number;
  navigate: NavigateFunction;
};

export function SeccionResumen({ client, profile, fiscal, openAccountingYearCount, activeActivities, navigate }: Props) {
  // Mismo criterio que Configuración fiscal (pasos.ts): un único estado de la configuración fiscal.
  const ultimoPerfil = fiscal.profiles.reduce<(typeof fiscal.profiles)[number] | undefined>(
    (latest, item) => (!latest || item.version > latest.version ? item : latest),
    undefined,
  );
  const faltantes = clientConfigurationMissing(fiscalConfigurationReadinessFor({
    hasAccountingProfile: Boolean(profile),
    latestProfile: ultimoPerfil,
    registrations: fiscal.registrations,
    activities: fiscal.activities,
    periods: fiscal.periods,
    obligations: fiscal.obligations,
  }));
  // Solo lo que falta o lo que sigue: con la configuración completa y obligaciones generadas no hay atajos.
  const primerFaltante = faltantes[0];
  const siguiente: Array<{ texto: string; ruta: string }> = [];
  if (primerFaltante && primerFaltante.step !== "ficha") {
    siguiente.push({ texto: "Completar la configuración fiscal", ruta: `/configuracion-fiscal?paso=${encodeURIComponent(primerFaltante.step)}` });
  }
  if (fiscal.obligations.length === 0) siguiente.push({ texto: "Generar obligaciones", ruta: "/configuracion-fiscal" });
  return (
    <DenseSection
      id="rc-resumen"
      title="Datos generales"
      description="Una lectura rápida para decidir dónde continuar."
      surface="integrated"
      actions={
        <div className="client-summary__overview-meta">
          <span className="client-summary__overview-status">
            <span>Estado</span>
            <StatusBadge status={client.status} variant="pill" />
          </span>
          <span className="client-summary__overview-created">
            Alta en el estudio {formatearFecha(client.createdAt)}
          </span>
          <span className="client-summary__updated">Actualizado {formatearFecha(client.updatedAt)}</span>
        </div>
      }
    >
      <dl className="client-summary__overview-facts">
        <SummaryFact
          label="Ficha contable"
          value={<StatusBadge status={profile ? "CONFIGURED" : "PENDING"} className="status-badge--regular" />}
        />
        <SummaryFact
          label="Configuración fiscal"
          value={
            <>
              <StatusBadge status={faltantes.length ? "PENDING" : "COMPLETED"} className="status-badge--regular" />
              {faltantes.length ? <span>Falta: {faltantes.map((gap, index) => <span key={gap.key}>{index ? ", " : ""}<Button type="button" variant="text" size="row" onClick={() => navigate(gap.step === "ficha" ? "/clientes" : `/configuracion-fiscal?paso=${encodeURIComponent(gap.step)}`)}>{gap.label}</Button></span>)}.</span> : null}
            </>
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
          label={fiscal.obligations.length === 1 ? "Obligación" : "Obligaciones"}
          value={String(fiscal.obligations.length)}
        />
      </dl>
      {siguiente.length > 0 ? (
        <div className="client-summary__overview-links">
          <h3>Qué sigue</h3>
          <ul>
            {siguiente.map((item) => (
              <li key={item.texto}>
                <Button type="button" variant="text" size="row" onClick={() => navigate(item.ruta)}>
                  <strong>{item.texto}</strong>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </DenseSection>
  );
}
