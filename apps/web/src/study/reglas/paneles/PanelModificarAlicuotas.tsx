import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import { Button, Field } from "@contable/design-system";
import { Icon } from "../../../ui/Icon";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { ErrorAccion } from "../Errores";
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
}: PanelModificarAlicuotasProps) {
  return (
    <>
      <ActionDrawer
        isOpen={showCloneForm && Boolean(selectedVersion) && selectedVersion?.status !== "DRAFT"}
        onClose={() => setShowCloneForm(false)}
        title="Modificar alícuotas"
        description="Primero elegí desde cuándo rigen los nuevos valores. Al continuar se abre un borrador con las alícuotas actuales para que las edites; la versión vigente sigue aplicando hasta que el Administrador o Titular active la nueva."
      >
        <form
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
          {cloneMutation.error ? <ErrorAccion error={cloneMutation.error} /> : null}
          <div className="study-form__actions">
            <Button type="submit" loading={cloneMutation.isPending}>
              <Icon name="plus" size={16} /> Crear borrador y editar
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowCloneForm(false)}>
              Cancelar
            </Button>
          </div>
          <p className="muted-copy">
            La versión vigente no se modifica: sigue activa hasta que el Administrador o Titular
            active esta nueva versión.
          </p>
        </form>
      </ActionDrawer>
    </>
  );
}
