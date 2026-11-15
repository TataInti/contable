import type { UseMutationResult } from "@tanstack/react-query";
import { Button, Notice } from "@contable/design-system";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { ApiError, type Client } from "../../../lib/api";
import type { ClientWithProfile } from "../tipos";

interface PanelEstadoProps {
  statusClient: ClientWithProfile | null;
  setStatusClient: (cliente: ClientWithProfile | null) => void;
  updateStatus: UseMutationResult<Client, Error, void>;
  statusForm: string;
  setStatusForm: (valor: string) => void;
}

export function PanelEstado({
  statusClient,
  setStatusClient,
  updateStatus,
  statusForm,
  setStatusForm,
}: PanelEstadoProps) {
  return (
    <ActionDrawer
      isOpen={Boolean(statusClient)}
      onClose={() => {
        setStatusClient(null);
        updateStatus.reset();
      }}
      title="Cambiar estado"
      description="Elegí el estado del cliente."
      footer={
        <Button
          type="submit"
          form="client-status-form"
          loading={updateStatus.isPending}
          loadingLabel="Guardando estado"
        >
          Guardar estado
        </Button>
      }
    >
      {statusClient ? (
        <form
          id="client-status-form"
          className="study-inline-form study-inline-form--client"
          onSubmit={(event) => {
            event.preventDefault();
            updateStatus.mutate();
          }}
        >
          <label className="ds-field">
            <span className="ds-field__label">Estado</span>
            <select
              id="client-status"
              className="ctxbar__input"
              value={statusForm}
              onChange={(event) => setStatusForm(event.target.value)}
            >
              <option value="ONBOARDING">En configuración</option>
              <option value="ACTIVE">Activo</option>
              <option value="INACTIVE">Inactivo</option>
              <option value="ARCHIVED">Archivado</option>
            </select>
          </label>
          {updateStatus.isError ? (
            <Notice tone="error" className="study-inline-form__feedback">
              {updateStatus.error instanceof ApiError
                ? updateStatus.error.message
                : "No se pudo actualizar el estado. Revisá los datos y los permisos."}
            </Notice>
          ) : null}
        </form>
      ) : null}
    </ActionDrawer>
  );
}
