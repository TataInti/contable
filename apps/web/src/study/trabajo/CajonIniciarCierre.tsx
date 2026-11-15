import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import { Button, Notice } from "@contable/design-system";
import { ActionDrawer } from "../../ui/ActionDrawer";
import type { FiscalYear } from "../../lib/api";

interface CajonIniciarCierreProps {
  showClose: boolean;
  setShowClose: Dispatch<SetStateAction<boolean>>;
  closeItems: string;
  setCloseItems: Dispatch<SetStateAction<string>>;
  activeFiscalYear: FiscalYear | undefined;
  periodId: string | null | undefined;
  createClose: UseMutationResult<unknown, Error, void>;
}

export function CajonIniciarCierre({
  showClose,
  setShowClose,
  closeItems,
  setCloseItems,
  activeFiscalYear,
  periodId,
  createClose,
}: CajonIniciarCierreProps) {
  return (
    <>
      <ActionDrawer
        isOpen={showClose}
        onClose={() => setShowClose(false)}
        title="Iniciar cierre del período"
        description="Definí las verificaciones del ciclo. Cada tarea se completa y queda auditada por separado."
      >
        <form
          className="study-page__form"
          onSubmit={(event) => {
            event.preventDefault();
            createClose.mutate();
          }}
        >
          <label className="ds-field" htmlFor="close-items">
            <span className="ds-field__label">Tareas de cierre</span>
            <textarea
              id="close-items"
              className="study-textarea"
              rows={5}
              value={closeItems}
              onChange={(event) => setCloseItems(event.target.value)}
              placeholder="Una tarea por línea"
              required
            />
            <small className="study-page__hint">
              Se crearán {closeItems.split("\n").filter((item) => item.trim()).length} tareas.
            </small>
          </label>
          {!activeFiscalYear ? (
            <Notice tone="error">
              Seleccioná un período contable abierto antes de iniciar el cierre.
            </Notice>
          ) : null}
          {createClose.isError ? (
            <Notice tone="error">
              {createClose.error.message}
            </Notice>
          ) : null}
          <div className="study-inline-form__actions">
            <Button
              type="submit"
              loading={createClose.isPending}
              disabled={!activeFiscalYear || !periodId}
            >
              Crear ciclo de cierre
            </Button>
          </div>
        </form>
      </ActionDrawer>
    </>
  );
}
