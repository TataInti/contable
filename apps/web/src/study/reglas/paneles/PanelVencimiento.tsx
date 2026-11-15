import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import { Button, Field } from "@contable/design-system";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { ErrorAccion } from "../Errores";

type NuevoVencimiento = { frequency: string; dueDay: string; cuitEnding: string; validFrom: string };

interface PanelVencimientoProps {
  showDueDateForm: boolean;
  setShowDueDateForm: Dispatch<SetStateAction<boolean>>;
  editable: boolean;
  newDueDate: NuevoVencimiento;
  setNewDueDate: Dispatch<SetStateAction<NuevoVencimiento>>;
  addDueDateMutation: UseMutationResult<unknown, Error, void>;
}

export function PanelVencimiento({
  showDueDateForm,
  setShowDueDateForm,
  editable,
  newDueDate,
  setNewDueDate,
  addDueDateMutation,
}: PanelVencimientoProps) {
  const sinDia = !newDueDate.dueDay || Number(newDueDate.dueDay) < 1 || Number(newDueDate.dueDay) > 31;
  return (
    <>
      <ActionDrawer
        isOpen={showDueDateForm && editable}
        onClose={() => setShowDueDateForm(false)}
        title="Agregar vencimiento"
        description="Definí la regla usada para calcular fechas de presentación y pago."
      >
        <form
          className="study-form study-form--compact fiscal-action-form"
          onSubmit={(event) => {
            event.preventDefault();
            addDueDateMutation.mutate();
          }}
        >
          <Field
            label="Frecuencia"
            id="rule-due-frequency"
            value={newDueDate.frequency}
            onChange={(event) => setNewDueDate({ ...newDueDate, frequency: event.target.value })}
            required
          />
          <Field
            label="Día del mes"
            id="rule-due-day"
            type="number"
            min="1"
            max="31"
            value={newDueDate.dueDay}
            onChange={(event) => setNewDueDate({ ...newDueDate, dueDay: event.target.value })}
            required
          />
          <Field
            label="Terminación de CUIT"
            id="rule-due-cuit-ending"
            value={newDueDate.cuitEnding}
            onChange={(event) => setNewDueDate({ ...newDueDate, cuitEnding: event.target.value })}
            placeholder="Opcional"
          />
          <Field
            label="Vigencia desde"
            id="rule-due-valid-from"
            type="date"
            value={newDueDate.validFrom}
            onChange={(event) => setNewDueDate({ ...newDueDate, validFrom: event.target.value })}
            required
          />
          {addDueDateMutation.error ? <ErrorAccion error={addDueDateMutation.error} /> : null}
          <div className="study-form__actions">
            <Button type="submit" loading={addDueDateMutation.isPending} disabled={sinDia}>
              Guardar vencimiento
            </Button>
          </div>
          {sinDia ? (
            <p className="form-submit-hint" role="note">
              Ingresá un día del mes entre 1 y 31 para guardar el vencimiento.
            </p>
          ) : null}
        </form>
      </ActionDrawer>
    </>
  );
}
