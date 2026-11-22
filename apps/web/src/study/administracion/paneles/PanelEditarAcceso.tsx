import { Button, SearchSelect } from "@contable/design-system";
import type { Dispatch, SetStateAction } from "react";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { PORTAL_ROLE_LABELS, type PortalMembership } from "../tipos";

type Props = {
  portalEditing: PortalMembership;
  setPortalEditing: Dispatch<SetStateAction<PortalMembership | null>>;
  portalRoleDraft: string;
  setPortalRoleDraft: Dispatch<SetStateAction<string>>;
  updatePortalMembership: { isPending: boolean; isError: boolean; mutate: (vars: { id: string; patch: { role?: string; status?: string } }) => void };
  actionError: string | null;
  setActionError: Dispatch<SetStateAction<string | null>>;
};

export function PanelEditarAcceso({ portalEditing, setPortalEditing, portalRoleDraft, setPortalRoleDraft, updatePortalMembership, actionError, setActionError }: Props) {
  return (
    <ActionDrawer
      isOpen
      onClose={() => setPortalEditing(null)}
      title="Editar acceso"
      description={`Cambiar el rol de ${portalEditing.user?.name ?? "esta persona"}.`}
    >
      <form
        className="study-form study-form--compact"
        onSubmit={(event) => {
          event.preventDefault();
          setActionError(null);
          updatePortalMembership.mutate({
            id: portalEditing.id,
            patch: { role: portalRoleDraft },
          });
        }}
      >
        <div className="ds-field">
          <span className="ds-field__label">Rol del portal</span>
          <SearchSelect
            hideLabel
            label="Rol del portal"
            value={portalRoleDraft}
            onChange={(value) => setPortalRoleDraft(value)}
            allowEmpty={false}
            options={Object.entries(PORTAL_ROLE_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </div>
        {updatePortalMembership.isError && actionError ? (
          <p className="form-error" role="alert">{actionError}</p>
        ) : null}
        <div className="study-form__actions">
          <Button type="submit" loading={updatePortalMembership.isPending}>
            Guardar cambios
          </Button>
          <Button type="button" variant="ghost" onClick={() => setPortalEditing(null)}>
            Cancelar
          </Button>
        </div>
      </form>
    </ActionDrawer>
  );
}
