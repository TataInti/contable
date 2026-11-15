import { StatusBadge } from "../../../ui/StatusBadge";
import type { ClientSummary } from "../../../lib/api";
import { formatearFecha } from "../../../lib/formatoFechas";
import { SummarySectionEmpty } from "../Piezas";

type Props = {
  fiscal: ClientSummary["fiscal"];
};

export function SeccionRegimenes({ fiscal }: Props) {
  return (
    <section className="client-summary__detail-section" aria-labelledby="registrations-title">
      <div className="client-summary__detail-heading">
        <div>
          <h2 id="registrations-title">Regímenes adheridos</h2>
          <p>Inscripciones fiscales y su vigencia.</p>
        </div>
        <span className="section-count">{fiscal.registrations.length}</span>
      </div>
      {fiscal.registrations.length === 0 ? (
        <SummarySectionEmpty
          title="Sin inscripciones"
          description="Los regímenes del cliente se administran desde configuración fiscal."
        />
      ) : (
        <ul className="client-summary__detail-list">
          {fiscal.registrations.map((registration) => (
            <li key={registration.id}>
              <div>
                <strong>{registration.regime.name}{!registration.regime.isActive ? " (oculto)" : ""}</strong>
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
    </section>
  );
}
