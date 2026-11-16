import type { ClientSummary } from "../../../lib/api";
import { formatearFecha } from "../../../lib/formatoFechas";
import { DenseSection } from "../../../ui/Dense";
import { StatusBadge } from "../../../ui/StatusBadge";
import { CONDITION_LABELS, PERSON_TYPE_LABELS, displayValue } from "../etiquetas";
import { SalidaConfiguracionFiscal, SummaryFact, SummarySectionEmpty } from "../Piezas";

type Props = {
  activeProfile: ClientSummary["fiscal"]["profiles"][number] | undefined;
  fiscal: ClientSummary["fiscal"];
};

export function SeccionPerfilFiscal({ activeProfile, fiscal }: Props) {
  return (
    <DenseSection
      id="rc-perfil"
      title="Perfil del contribuyente"
      description="Versión vigente y trazabilidad de sus cambios."
      actions={activeProfile ? <StatusBadge status={activeProfile.status} /> : undefined}
      surface="integrated"
    >
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
          action={<SalidaConfiguracionFiscal />}
        />
      )}
    </DenseSection>
  );
}
