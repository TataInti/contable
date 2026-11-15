import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { Button, EmptyState, Field } from "@contable/design-system";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { ApiError } from "../../../lib/api";
import type { TaxEngineOption } from "@contable/contracts";
import type { RulePackDetail, RuleVersion } from "../tipos";
import { validateRuleVersionDate } from "../utilidades";

interface PanelPrimeraVersionProps {
  showInitialVersionForm: boolean;
  setShowInitialVersionForm: Dispatch<SetStateAction<boolean>>;
  detailQuery: UseQueryResult<RulePackDetail, Error>;
  selectedVersion: RuleVersion | undefined;
  validFrom: string;
  setValidFrom: Dispatch<SetStateAction<string>>;
  versionDateError: string | null;
  setVersionDateError: Dispatch<SetStateAction<string | null>>;
  createVersionMutation: UseMutationResult<unknown, Error, void>;
  regimeEnginesQuery: UseQueryResult<TaxEngineOption[], Error>;
  engineId: string;
  setEngineId: Dispatch<SetStateAction<string>>;
}

export function PanelPrimeraVersion({
  showInitialVersionForm,
  setShowInitialVersionForm,
  detailQuery,
  selectedVersion,
  validFrom,
  setValidFrom,
  versionDateError,
  setVersionDateError,
  createVersionMutation,
  regimeEnginesQuery,
  engineId,
  setEngineId,
}: PanelPrimeraVersionProps) {
  return (
    <>
      <ActionDrawer
        isOpen={showInitialVersionForm && Boolean(detailQuery.data) && !selectedVersion}
        onClose={() => setShowInitialVersionForm(false)}
        title="Crear primera versión"
        description="Abrí un borrador para cargar alícuotas, vencimientos y las fuentes que respaldan el cálculo."
      >
        <form
          className="study-form study-form--compact fiscal-action-form"
          onSubmit={(event) => {
            event.preventDefault();
            const dateError = validateRuleVersionDate(validFrom);
            setVersionDateError(dateError);
            if (dateError) return;
            createVersionMutation.mutate();
          }}
        >
          <Field
            label="Vigencia desde"
            id="first-rule-version-valid-from"
            type="date"
            min="1900-01-01"
            max="2100-12-31"
            value={validFrom}
            error={versionDateError ?? undefined}
            onChange={(event) => {
              setValidFrom(event.target.value);
              setVersionDateError(null);
            }}
            onInvalid={(event) => {
              event.preventDefault();
              setVersionDateError(
                validateRuleVersionDate(event.currentTarget.value) ??
                  "La fecha debe estar entre 01/01/1900 y 31/12/2100.",
              );
            }}
            required
          />
          {!detailQuery.data?.regime.calcFamilyId ? (
            <EmptyState
              size="compact"
              role="alert"
              title="Elegí una familia de cálculo"
              description="Este régimen necesita una familia para mostrar las opciones de cálculo."
              action={(
                <a
                  className="dense-link"
                  href={`/catalogos-fiscales?editRegime=${encodeURIComponent(detailQuery.data?.regime.id ?? "")}`}
                >
                  Editar régimen
                </a>
              )}
            />
          ) : regimeEnginesQuery.isLoading ? (
            <p className="muted-copy" role="status">Buscando opciones de cálculo…</p>
          ) : regimeEnginesQuery.isError ? (
            <p className="form-error" role="alert">
              No pudimos cargar las opciones de cálculo. <Button type="button" variant="ghost" size="sm" onClick={() => void regimeEnginesQuery.refetch()}>Reintentar</Button>
            </p>
          ) : regimeEnginesQuery.data?.length ? (
            <div className="ds-field">
              <label className="ds-field__label" htmlFor="first-rule-version-engine">Opción de cálculo</label>
              <select
                id="first-rule-version-engine"
                className="ds-field__input"
                value={engineId}
                onChange={(event) => setEngineId(event.target.value)}
                required
              >
                <option value="">Seleccioná una opción…</option>
                {regimeEnginesQuery.data.map((engine) => (
                  <option key={engine.id} value={engine.id}>{engine.label}</option>
                ))}
              </select>
              {createVersionMutation.error instanceof ApiError ? (
                <p className="form-error" role="alert">{createVersionMutation.error.message}</p>
              ) : null}
            </div>
          ) : (
            <EmptyState
              size="compact"
              title="Esta familia aún no tiene opciones de cálculo"
              description="Elegí otra familia para este régimen o consultá con quien administra la configuración del estudio."
            />
          )}
          <div className="study-form__actions">
            <Button
              type="submit"
              loading={createVersionMutation.isPending}
              disabled={!regimeEnginesQuery.data?.some((engine) => engine.id === engineId)}
            >
              Crear primera versión
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowInitialVersionForm(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      </ActionDrawer>
    </>
  );
}
