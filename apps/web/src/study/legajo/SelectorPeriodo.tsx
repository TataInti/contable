import { Button, EmptyState } from "@contable/design-system";
import { fiscalTaxPeriodLabel } from "./periodoFiscal";
import type { FiscalTaxPeriod } from "./tipos";

interface SelectorPeriodoProps {
  cargando: boolean;
  error: boolean;
  onReintentar: () => void;
  periodos: FiscalTaxPeriod[];
  valor: string;
  onCambiar: (id: string) => void;
  onConfigurar: () => void;
}

/** Período fiscal del Legajo: carga, error con Reintentar, selector o pedido de configurar un período (K15). */
export function SelectorPeriodo({
  cargando,
  error,
  onReintentar,
  periodos,
  valor,
  onCambiar,
  onConfigurar,
}: SelectorPeriodoProps) {
  if (cargando) {
    return (
      <div className="study-state" role="status">
        Cargando períodos fiscales…
      </div>
    );
  }
  if (error) {
    return (
      <EmptyState
        title="No se pudieron cargar los períodos fiscales"
        description="Reintentá la consulta para volver a cargar los períodos del cliente."
        action={
          <Button variant="secondary" onClick={onReintentar}>
            Reintentar
          </Button>
        }
      />
    );
  }
  if (periodos.length === 0) {
    return (
      <EmptyState
        title="Configurá un período fiscal"
        description="El legajo organiza las obligaciones del mes seleccionado."
        action={
          <Button variant="secondary" onClick={onConfigurar}>
            Abrir configuración fiscal
          </Button>
        }
      />
    );
  }
  return (
    <section className="study-page__section" aria-label="Período fiscal">
      <div className="ds-field">
        <label className="ds-field__label" htmlFor="monthly-workpaper-tax-period">
          Período fiscal
        </label>
        <select
          id="monthly-workpaper-tax-period"
          className="ds-field__input"
          value={valor}
          onChange={(event) => onCambiar(event.target.value)}
        >
          <option value="">Seleccioná un período fiscal…</option>
          {periodos.map((taxPeriod) => (
            <option key={taxPeriod.id} value={taxPeriod.id}>
              {taxPeriod.taxType.name} · {fiscalTaxPeriodLabel(taxPeriod)}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
