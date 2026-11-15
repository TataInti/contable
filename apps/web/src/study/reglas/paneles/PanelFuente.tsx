import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import { Button, Field } from "@contable/design-system";
import { ActionDrawer } from "../../../ui/ActionDrawer";

type NuevaFuente = { title: string; reference: string; url: string; consultedAt: string };

interface PanelFuenteProps {
  showSourceForm: boolean;
  setShowSourceForm: Dispatch<SetStateAction<boolean>>;
  editable: boolean;
  newSource: NuevaFuente;
  setNewSource: Dispatch<SetStateAction<NuevaFuente>>;
  addSourceMutation: UseMutationResult<unknown, Error, void>;
}

export function PanelFuente({
  showSourceForm,
  setShowSourceForm,
  editable,
  newSource,
  setNewSource,
  addSourceMutation,
}: PanelFuenteProps) {
  return (
    <>
      <ActionDrawer
        isOpen={showSourceForm && editable}
        onClose={() => setShowSourceForm(false)}
        title="Agregar fuente normativa"
        description="Asociá la norma, padrón o resolución que respalda esta versión."
        size="wide"
      >
        <form
          className="study-form fiscal-action-form"
          onSubmit={(event) => {
            event.preventDefault();
            addSourceMutation.mutate();
          }}
        >
          <Field
            label="Título"
            id="rule-source-title"
            value={newSource.title}
            onChange={(event) => setNewSource({ ...newSource, title: event.target.value })}
            required
          />
          <Field
            label="Referencia"
            id="rule-source-reference"
            value={newSource.reference}
            onChange={(event) => setNewSource({ ...newSource, reference: event.target.value })}
            placeholder="Opcional"
          />
          <Field
            label="URL"
            id="rule-source-url"
            type="url"
            value={newSource.url}
            onChange={(event) => setNewSource({ ...newSource, url: event.target.value })}
            placeholder="https://…"
          />
          <Field
            label="Consultada el"
            id="rule-source-consulted-at"
            type="date"
            value={newSource.consultedAt}
            onChange={(event) => setNewSource({ ...newSource, consultedAt: event.target.value })}
            required
          />
          <div className="study-form__actions">
            <Button
              type="submit"
              loading={addSourceMutation.isPending}
              disabled={!newSource.title.trim()}
            >
              Guardar fuente
            </Button>
          </div>
        </form>
      </ActionDrawer>
    </>
  );
}
