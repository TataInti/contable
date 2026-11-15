import { Button, Field } from "@contable/design-system";
import type { Dispatch, SetStateAction } from "react";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { Icon } from "../../../ui/Icon";

type Props = {
  showInviteForm: boolean;
  setShowInviteForm: Dispatch<SetStateAction<boolean>>;
  email: string;
  setEmail: Dispatch<SetStateAction<string>>;
  role: string;
  setRole: Dispatch<SetStateAction<string>>;
  invite: { isPending: boolean; isError: boolean; mutate: () => void };
  actionError: string | null;
  setActionError: Dispatch<SetStateAction<string | null>>;
};

export function PanelInvitarPortal({ showInviteForm, setShowInviteForm, email, setEmail, role, setRole, invite, actionError, setActionError }: Props) {
  return (
    <ActionDrawer
      isOpen={showInviteForm}
      onClose={() => setShowInviteForm(false)}
      title="Invitar al portal"
      description="Invitación para el cliente seleccionado. Vence a los siete días y sólo puede usarse con el correo indicado."
    >
      <form
        className="study-form study-form--compact dense-form"
        onSubmit={(event) => {
          event.preventDefault();
          setActionError(null);
          invite.mutate();
        }}
      >
        <div className="dense-form__full">
          <Field
            id="portal-invite-email"
            label="Correo"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <label className="ds-field dense-form__full">
          <span className="ds-field__label">Rol</span>
          <select
            className="ds-field__input"
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            <option value="OWNER">Titular</option>
            <option value="COLLABORATOR">Colaborador</option>
            <option value="READONLY">Sólo lectura</option>
          </select>
        </label>
        {invite.isError && actionError ? (
          <p className="form-error" role="alert">
            {actionError}
          </p>
        ) : null}
        <div className="study-form__actions">
          <Button type="submit" loading={invite.isPending} disabled={!email.trim()}>
            <Icon name="plus" size={17} /> Enviar invitación
          </Button>
          <Button type="button" variant="ghost" onClick={() => setShowInviteForm(false)}>
            Cancelar
          </Button>
        </div>
      </form>
    </ActionDrawer>
  );
}
