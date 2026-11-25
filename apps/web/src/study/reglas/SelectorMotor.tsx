import type { UseQueryResult } from "@tanstack/react-query";
import type { TaxEngineOption } from "@contable/contracts";
import { EmptyState, SearchSelect } from "@contable/design-system";
import { ErrorConsulta } from "./Errores";

interface SelectorMotorProps {
  id: string;
  regimeId: string;
  familiaDefinida: boolean;
  enginesQuery: UseQueryResult<TaxEngineOption[], Error>;
  value: string;
  onChange: (engineId: string) => void;
  /** Opción de origen de una copia: viene preseleccionada y, si se elige otra, se dice la consecuencia. */
  actualId?: string | null;
}

// Selector «Opción de cálculo» (P5): lo usan «Crear primera versión» y «Crear a partir de este», con los mismos estados.
export function SelectorMotor({
  id,
  regimeId,
  familiaDefinida,
  enginesQuery,
  value,
  onChange,
  actualId = null,
}: SelectorMotorProps) {
  const editarRegimen = (
    <a
      className="dense-link"
      href={`/catalogos-fiscales?editRegime=${encodeURIComponent(regimeId)}`}
    >
      Editar régimen
    </a>
  );
  if (!familiaDefinida) {
    return (
      <div className="selector-motor-aviso">
        <EmptyState
          size="compact"
          role="alert"
          title="Elegí una familia de cálculo"
          description="Este régimen necesita una familia para mostrar las opciones de cálculo."
          action={editarRegimen}
        />
      </div>
    );
  }
  if (enginesQuery.isLoading) {
    return (
      <div className="selector-motor-aviso">
        <p className="muted-copy" role="status">
          Buscando opciones de cálculo…
        </p>
      </div>
    );
  }
  if (enginesQuery.isError) {
    return (
      <div className="selector-motor-aviso">
        <ErrorConsulta
          titulo="No pudimos cargar las opciones de cálculo"
          descripcion="Reintentá la consulta para elegir la opción de cálculo."
          onRetry={() => void enginesQuery.refetch()}
        />
      </div>
    );
  }
  if (!enginesQuery.data?.length) {
    return (
      <div className="selector-motor-aviso">
        <EmptyState
          size="compact"
          title="Esta familia aún no tiene opciones de cálculo"
          description="Elegí otra familia para este régimen en Editar régimen, o consultá con quien administra el estudio."
          action={editarRegimen}
        />
      </div>
    );
  }
  const actual = actualId ? enginesQuery.data.find((engine) => engine.id === actualId) : undefined;
  const elegida = enginesQuery.data.find((engine) => engine.id === value);
  const consecuencia =
    actual && elegida && elegida.id !== actual.id
      ? `La nueva versión va a calcular con ${elegida.label} en lugar de ${actual.label}.`
      : null;
  return (
    <div className="ds-field">
      <label className="ds-field__label" htmlFor={id}>
        Opción de cálculo <span aria-hidden="true">*</span>
      </label>
      <SearchSelect
        id={id}
        label="Opción de cálculo"
        hideLabel
        className="ds-field__input"
        value={value}
        onChange={(next) => onChange(next)}
        required
        placeholder="Seleccioná una opción…"
        options={enginesQuery.data.map((engine) => ({ value: engine.id, label: engine.label }))}
      />
      {consecuencia ? (
        <p className="form-submit-hint selector-motor-consecuencia" role="note">
          {consecuencia}
        </p>
      ) : null}
    </div>
  );
}
