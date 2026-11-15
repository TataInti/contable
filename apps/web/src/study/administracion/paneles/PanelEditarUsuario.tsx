import { Button, Field } from "@contable/design-system";
import type { Dispatch, SetStateAction } from "react";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import type { InternalMember } from "../tipos";
import { isValidEmail } from "../utilidades";

type Props = {
  identityEditing: InternalMember;
  setIdentityEditing: Dispatch<SetStateAction<InternalMember | null>>;
  identityName: string;
  setIdentityName: Dispatch<SetStateAction<string>>;
  identityEmail: string;
  setIdentityEmail: Dispatch<SetStateAction<string>>;
  setIdentitySubmitted: Dispatch<SetStateAction<boolean>>;
  identityNameError: string | undefined;
  identityEmailError: string | undefined;
  updateMemberIdentity: { isPending: boolean; isError: boolean; mutate: (vars: { userId: string; name: string; email: string }) => void };
  actionError: string | null;
  setActionError: Dispatch<SetStateAction<string | null>>;
};

export function PanelEditarUsuario({ identityEditing, setIdentityEditing, identityName, setIdentityName, identityEmail, setIdentityEmail, setIdentitySubmitted, identityNameError, identityEmailError, updateMemberIdentity, actionError, setActionError }: Props) {
  return (
    <ActionDrawer
      isOpen
      onClose={() => setIdentityEditing(null)}
      title="Editar usuario"
      description="Actualizá el nombre y el correo de la cuenta."
      footer={
        <>
          <Button type="submit" form="member-edit-form" loading={updateMemberIdentity.isPending}>
            Guardar cambios
          </Button>
          <Button type="button" variant="ghost" onClick={() => setIdentityEditing(null)}>
            Cancelar
          </Button>
        </>
      }
    >
      <form
        id="member-edit-form"
        className="study-form study-form--compact administration-user-edit-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setIdentitySubmitted(true);
          if (!identityName.trim() || !isValidEmail(identityEmail)) return;
          setActionError(null);
          updateMemberIdentity.mutate({
            userId: identityEditing.userId,
            name: identityName,
            email: identityEmail,
          });
        }}
      >
        <Field
          id="member-edit-name"
          label="Nombre"
          value={identityName}
          onChange={(event) => setIdentityName(event.target.value)}
          error={identityNameError}
          required
        />
        <Field
          id="member-edit-email"
          label="Correo"
          type="email"
          value={identityEmail}
          onChange={(event) => setIdentityEmail(event.target.value)}
          error={identityEmailError}
          required
        />
        {updateMemberIdentity.isError && actionError ? (
          <p className="form-error" role="alert">{actionError}</p>
        ) : null}
      </form>
    </ActionDrawer>
  );
}
