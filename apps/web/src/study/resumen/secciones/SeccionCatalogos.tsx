import type { ClientSummary } from "../../../lib/api";
import { DenseSection } from "../../../ui/Dense";

type Props = {
  counts: ClientSummary["counts"];
};

export function SeccionCatalogos({ counts }: Props) {
  return (
    <DenseSection
      id="rc-catalogos"
      title="Catálogos del cliente"
      description="Volumen configurado para sostener la operación."
      surface="integrated"
    >
      <ul className="client-summary__catalog-list">
        <li><span>Plan de cuentas</span><strong>{counts.accounts}</strong></li>
        <li><span>Contrapartes</span><strong>{counts.counterparties}</strong></li>
        <li><span>Centros de costo activos</span><strong>{counts.costCenters}</strong></li>
      </ul>
    </DenseSection>
  );
}
