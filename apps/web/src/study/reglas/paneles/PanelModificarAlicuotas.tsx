import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import type { TaxEngineOption } from "@contable/contracts";
import { Button, Field } from "@contable/design-system";
import { Icon } from "../../../ui/Icon";
import { ActionDrawer, ActionDrawerFooter } from "../../../ui/ActionDrawer";
import { ErrorAccion } from "../Errores";
import { SelectorMotor } from "../SelectorMotor";
import type { RuleVersion } from "../tipos";
import { validateRuleVersionDate } from "../utilidades";

interface PanelModificarAlicuotasProps {
  showCloneForm: boolean;
  setShowCloneForm: Dispatch<SetStateAction<boolean>>;
  selectedVersion: RuleVersion | undefined;
  validFrom: string;
  setValidFrom: Dispatch<SetStateAction<string>>;
  versionDateError: string | null;
  setVersionDateError: Dispatch<SetStateAction<string | null>>;
  cloneMutation: UseMutationResult<unknown, Error, void>;
  regimeId: string;
  familiaDefinida: boolean;
  regimeEnginesQuery: UseQueryResult<TaxEngineOption[], Error>;
  engineId: string;
  setEngineId: (engineId: string) => void;
  motorOrigen: string | null;
  avisoMotor: string | null;
}

export function PanelModificarAlicuotas({
  showCloneForm,
  setShowCloneForm,
  selectedVersion,
  validFrom,
  setValidFrom,
  versionDateError,
  setVersionDateError,
  cloneMutation,
  regimeId,
  familiaDefinida,
  regimeEnginesQuery,
  engineId,
  setEngineId,
  motorOrigen,
  avisoMotor,
}: PanelModificarAlicuotasProps) {
  const footerClon = (
    <ActionDrawerFooter
      primary={
        <Button type="submit" form="rule-clone-form" loading={cloneMutation.isPending}>
          <Icon name="plus" size={16} /> Crear borrador y editar
        </Button>
      }
      onCancel={() => setShowCloneForm(false)}
    />
  );
  return (
    <>
      <ActionDrawer
        isOpen={showCloneForm && Boolean(selectedVersion) && selectedVersion?.status !== "DRAFT"}
        onClose={() => setShowCloneForm(false)}
        title="Crear a partir de este"
        description="Primero elegí desde cuándo rigen los nuevos valores. Al continuar se abre un borrador con las alícuotas actuales para que las edites; la versión vigente sigue aplicando hasta que el Administrador o Titular active la nueva."
        footer={footerClon}
      >
        <form
          id="rule-clone-form"
          className="study-form study-form--compact fiscal-action-form"
          onSubmit={(event) => {
            event.preventDefault();
            const dateError = validateRuleVersionDate(validFrom);
            setVersionDateError(dateError);
            if (dateError) return;
            cloneMutation.mutate();
          }}
        >
          <Field
            label="Nueva vigencia desde"
            id="rule-valid-from"
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
          <SelectorMotor
            id="rule-clone-engine"
            regimeId={regimeId}
            familiaDefinida={familiaDefinida}
            enginesQuery={regimeEnginesQuery}
            actualId={motorOrigen}
            value={engineId}
            onChange={setEngineId}
          />
          {avisoMotor ? (
            <p className="form-submit-hint" role="note">
              {avisoMotor}
            </p>
          ) : null}
          {cloneMutation.error ? <ErrorAccion error={cloneMutation.error} /> : null}
          <p className="muted-copy">
            La versión vigente no se modifica: sigue vigente hasta que el Administrador o Titular
            active esta nueva versión.
          </p>
        </form>
      </ActionDrawer>
    </>
  );
}
