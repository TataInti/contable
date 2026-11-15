import { StatusBadge } from "../../../ui/StatusBadge";
import type { ClientSummary } from "../../../lib/api";
import { formatearFecha } from "../../../lib/formatoFechas";
import { CONDITION_LABELS, PERSON_TYPE_LABELS, displayValue } from "../etiquetas";
import { SummaryFact } from "../Piezas";
import { SummarySectionEmpty } from "../Piezas";

type Props = {
  activeProfile: ClientSummary["fiscal"]["profiles"][number] | undefined;
  fiscal: ClientSummary["fiscal"];
};

export function SeccionPerfilFiscal({ activeProfile, fiscal }: Props) {
  return (
    <section className="client-summary__detail-section" aria-labelledby="tax-profile-title">
      <div className="client-summary__detail-heading">
        <div>
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
            <SummaryFact label="Vigente desde" value={formatearFecha(activeProfile.validFrom)} />
            <SummaryFact label="Categoría monotributo" value={displayValue(activeProfile.monotributoCategory)} />
          </dl>
          <div className="client-summary__history">
            <h3>Historial de versiones</h3>
            <ul>
              {fiscal.profiles.map((profileVersion) => (
                <li key={profileVersion.id}>
                  <span>v{profileVersion.version} · {formatearFecha(profileVersion.validFrom)}</span>
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
  );
}
