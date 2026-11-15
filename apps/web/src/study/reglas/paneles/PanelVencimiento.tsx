import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import { Button, Field } from "@contable/design-system";
import { ActionDrawer, ActionDrawerFooter } from "../../../ui/ActionDrawer";
import { ErrorAccion } from "../Errores";
import { esFrecuencia, OPCIONES_FRECUENCIA, type DueDateFrequency } from "../frecuencias";

type NuevoVencimiento = {
  frequency: DueDateFrequency;
  dueDay: string;
  cuitEnding: string;
  validFrom: string;
};

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
  const footerVencimiento = (
    <ActionDrawerFooter
      primary={
        <Button type="submit" form="rule-due-date-form" loading={addDueDateMutation.isPending} disabled={sinDia}>
          Guardar vencimiento
        </Button>
      }
      hint={sinDia ? "Ingresá un día del mes entre 1 y 31 para guardar el vencimiento." : null}
      onCancel={() => setShowDueDateForm(false)}
    />
  );
  return (
    <>
      <ActionDrawer
        isOpen={showDueDateForm && editable}
        onClose={() => setShowDueDateForm(false)}
        title="Agregar vencimiento"
        description="Definí la regla usada para calcular fechas de presentación y pago."
        footer={footerVencimiento}
      >
        <form
          id="rule-due-date-form"
          className="study-form study-form--compact fiscal-action-form"
          onSubmit={(event) => {
            event.preventDefault();
            addDueDateMutation.mutate();
          }}
        >
          <div className="ds-field">
            <label className="ds-field__label" htmlFor="rule-due-frequency">
              Frecuencia
            </label>
            <select
              id="rule-due-frequency"
              className="ds-field__input"
              value={newDueDate.frequency}
              onChange={(event) => {
                const frecuencia = event.target.value;
                if (esFrecuencia(frecuencia))
                  setNewDueDate({ ...newDueDate, frequency: frecuencia });
              }}
              required
            >
              {OPCIONES_FRECUENCIA.map((opcion) => (
                <option key={opcion.value} value={opcion.value}>
                  {opcion.label}
                </option>
              ))}
            </select>
          </div>
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
        </form>
      </ActionDrawer>
    </>
  );
}
