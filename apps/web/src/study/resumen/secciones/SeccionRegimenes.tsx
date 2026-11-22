import type { ClientSummary } from "../../../lib/api";
import { formatearFecha } from "../../../lib/formatoFechas";
import { DenseSection } from "../../../ui/Dense";
import { StatusBadge } from "../../../ui/StatusBadge";
import { SalidaConfiguracionFiscal, SummarySectionEmpty } from "../Piezas";
import { nombreRegimen } from "../../fiscal/etiquetaRegimen";

type Props = {
  fiscal: ClientSummary["fiscal"];
};

export function SeccionRegimenes({ fiscal }: Props) {
  return (
    <DenseSection
      id="rc-regimenes"
      title="Regímenes adheridos"
      description="Inscripciones fiscales y su vigencia."
      count={fiscal.registrations.length}
      surface="integrated"
    >
      {fiscal.registrations.length === 0 ? (
        <SummarySectionEmpty
          title="Sin inscripciones"
          description="Los regímenes se administran en Configuración fiscal."
          action={<SalidaConfiguracionFiscal />}
        />
      ) : (
        <ul className="client-summary__detail-list">
          {fiscal.registrations.map((registration) => (
            <li key={registration.id}>
              <div>
                <strong>{nombreRegimen(registration.regime)}{!registration.regime.isActive ? " (oculto)" : ""}</strong>
                <small>
                  {registration.regime.taxType.name}{!registration.regime.taxType.isActive ? " (oculto)" : ""} · {registration.regime.jurisdiction.name}{!registration.regime.jurisdiction.isActive ? " (oculto)" : ""}
                </small>
                <small>Desde {formatearFecha(registration.validFrom)}{registration.validTo ? ` · hasta ${formatearFecha(registration.validTo)}` : ""}</small>
              </div>
              <StatusBadge status={registration.status} />
            </li>
          ))}
        </ul>
      )}
    </DenseSection>
  );
}
