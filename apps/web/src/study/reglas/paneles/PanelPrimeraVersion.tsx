import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { Button, Field } from "@contable/design-system";
import { ActionDrawer, ActionDrawerFooter } from "../../../ui/ActionDrawer";
import { ErrorAccion } from "../Errores";
import { SelectorMotor } from "../SelectorMotor";
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
  const motivoCrear = !detailQuery.data?.regime.calcFamilyId
    ? "Asigná una familia de cálculo al régimen para crear la versión."
    : regimeEnginesQuery.isLoading
      ? "Esperá a que carguen las opciones de cálculo para crear la versión."
      : regimeEnginesQuery.isError
        ? "Reintentá la consulta de opciones de cálculo para crear la versión."
        : !regimeEnginesQuery.data?.length
          ? "Sin opciones de cálculo no se puede crear la versión."
          : !engineId
            ? "Elegí una opción de cálculo para crear la versión."
            : null;
  const familiaDefinida = Boolean(detailQuery.data?.regime.calcFamilyId);
  const selector = (
    <SelectorMotor
      id="first-rule-version-engine"
      regimeId={detailQuery.data?.regime.id ?? ""}
      familiaDefinida={familiaDefinida}
      enginesQuery={regimeEnginesQuery}
      value={engineId}
      onChange={setEngineId}
    />
  );
  const footerPrimeraVersion = (
    <ActionDrawerFooter
      primary={
        <Button
          type="submit"
          form="first-rule-version-form"
          loading={createVersionMutation.isPending}
          disabled={!regimeEnginesQuery.data?.some((engine) => engine.id === engineId)}
        >
          Crear primera versión
        </Button>
      }
      hint={motivoCrear}
      onCancel={() => setShowInitialVersionForm(false)}
    />
  );
  return (
    <>
      <ActionDrawer
        isOpen={showInitialVersionForm && Boolean(detailQuery.data) && !selectedVersion}
        onClose={() => setShowInitialVersionForm(false)}
        title="Crear primera versión"
        description="Abrí un borrador para cargar alícuotas, vencimientos y las fuentes que respaldan el cálculo."
        footer={footerPrimeraVersion}
      >
        <form
          id="first-rule-version-form"
          className="study-form study-form--compact fiscal-action-form"
          onSubmit={(event) => {
            event.preventDefault();
            const dateError = validateRuleVersionDate(validFrom);
            setVersionDateError(dateError);
            if (dateError) return;
            createVersionMutation.mutate();
          }}
        >
          {familiaDefinida ? null : selector}
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
          {familiaDefinida ? selector : null}
          {createVersionMutation.error ? <ErrorAccion error={createVersionMutation.error} /> : null}
        </form>
      </ActionDrawer>
    </>
  );
}
