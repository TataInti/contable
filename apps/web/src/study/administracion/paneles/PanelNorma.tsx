import { Button, Field } from "@contable/design-system";
import type { Dispatch, SetStateAction } from "react";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import type { AccountingStandardRow } from "../tipos";

type Props = {
  showStandardForm: boolean;
  setShowStandardForm: Dispatch<SetStateAction<boolean>>;
  standardEditing: AccountingStandardRow | null;
  setStandardEditing: Dispatch<SetStateAction<AccountingStandardRow | null>>;
  standardName: string;
  setStandardName: Dispatch<SetStateAction<string>>;
  createStandard: { isPending: boolean; isError: boolean; mutate: () => void };
  updateStandard: { isPending: boolean; isError: boolean; mutate: (vars: { id: string; name?: string; isActive?: boolean }) => void };
  actionError: string | null;
  setActionError: Dispatch<SetStateAction<string | null>>;
};

export function PanelNorma({ showStandardForm, setShowStandardForm, standardEditing, setStandardEditing, standardName, setStandardName, createStandard, updateStandard, actionError, setActionError }: Props) {
  return (
    <ActionDrawer
      isOpen={showStandardForm}
      onClose={() => {
        setShowStandardForm(false);
        setStandardEditing(null);
        setStandardName("");
      }}
      title={standardEditing ? "Editar norma contable" : "Nueva norma contable"}
      description="El nombre es el valor que se muestra y se guarda en la ficha de clientes. No se precargan normas: el estudio define las suyas."
    >
      <form
        className="study-form study-form--compact"
        onSubmit={(event) => {
          event.preventDefault();
          setActionError(null);
          if (standardEditing)
            updateStandard.mutate({ id: standardEditing.id, name: standardName.trim() });
          else createStandard.mutate();
        }}
      >
        <Field
          id="accounting-standard-name"
          label="Nombre de la norma"
          value={standardName}
          onChange={(event) => setStandardName(event.target.value)}
          maxLength={100}
          required
        />
        {createStandard.isError || updateStandard.isError ? (
          actionError ? (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          ) : null
        ) : null}
        <div className="study-form__actions">
          <Button
            type="submit"
            loading={createStandard.isPending || updateStandard.isPending}
            disabled={!standardName.trim()}
          >
            {standardEditing ? "Guardar cambios" : "Crear norma"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setShowStandardForm(false);
              setStandardEditing(null);
              setStandardName("");
            }}
          >
            Cancelar
          </Button>
        </div>
      </form>
    </ActionDrawer>
  );
}
