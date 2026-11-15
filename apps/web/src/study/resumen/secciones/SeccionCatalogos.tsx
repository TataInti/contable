import type { ClientSummary } from "../../../lib/api";

type Props = {
  counts: ClientSummary["counts"];
};

export function SeccionCatalogos({ counts }: Props) {
  return (
    <section className="client-summary__detail-section" aria-labelledby="catalogs-title">
      <div className="client-summary__detail-heading">
        <div>
          <h2 id="catalogs-title">Catálogos del cliente</h2>
          <p>Volumen configurado para sostener la operación.</p>
        </div>
      </div>
      <ul className="client-summary__catalog-list">
        <li><span>Plan de cuentas</span><strong>{counts.accounts}</strong></li>
        <li><span>Contrapartes</span><strong>{counts.counterparties}</strong></li>
        <li><span>Centros de costo activos</span><strong>{counts.costCenters}</strong></li>
      </ul>
    </section>
  );
}
