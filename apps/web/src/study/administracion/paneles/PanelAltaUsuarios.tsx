import { Button, Field } from "@contable/design-system";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { DenseTabs, type DenseTab } from "../../../ui/Dense";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { Icon } from "../../../ui/Icon";
import type { BatchUserLine } from "../../batch-users.js";
import {
  INTERNAL_MODULES,
  INTERNAL_MODULES_BY_ROLE,
  INTERNAL_ROLE_OPTIONS,
  type BatchResult,
  type CreatedInternalUser,
} from "../tipos";

type Props = {
  showInternalInviteForm: boolean;
  closeInternalDrawer: () => void;
  createMode: "single" | "batch";
  setCreateMode: Dispatch<SetStateAction<"single" | "batch">>;
  createTabs: DenseTab<"single" | "batch">[];
  createdInternalUser: CreatedInternalUser | null;
  setCreatedInternalUser: Dispatch<SetStateAction<CreatedInternalUser | null>>;
  internalName: string;
  setInternalName: Dispatch<SetStateAction<string>>;
  internalEmail: string;
  setInternalEmail: Dispatch<SetStateAction<string>>;
  internalRole: string;
  setInternalRole: Dispatch<SetStateAction<string>>;
  inviteInternal: { isPending: boolean; isError: boolean; mutate: () => void };
  actionError: string | null;
  setActionError: Dispatch<SetStateAction<string | null>>;
  batchResults: BatchResult[] | null;
  batchText: string;
  setBatchText: Dispatch<SetStateAction<string>>;
  batchLines: BatchUserLine[];
  validBatchLines: BatchUserLine[];
  batchRunning: boolean;
  runBatch: () => Promise<void>;
  downloadBatchCredentials: () => void;
  tablaResultadoLote: ReactNode;
  tablaVistaPreviaLote: ReactNode;
};

export function PanelAltaUsuarios({
  showInternalInviteForm,
  closeInternalDrawer,
  createMode,
  setCreateMode,
  createTabs,
  createdInternalUser,
  setCreatedInternalUser,
  internalName,
  setInternalName,
  internalEmail,
  setInternalEmail,
  internalRole,
  setInternalRole,
  inviteInternal,
  actionError,
  setActionError,
  batchResults,
  batchText,
  setBatchText,
  batchLines,
  validBatchLines,
  batchRunning,
  runBatch,
  downloadBatchCredentials,
  tablaResultadoLote,
  tablaVistaPreviaLote,
}: Props) {
  return (
    <ActionDrawer
      isOpen={showInternalInviteForm}
      onClose={closeInternalDrawer}
      title="Crear usuarios del estudio"
      description="Se genera una contraseña temporal por cuenta, que se muestra una sola vez. Cada persona deberá cambiarla al ingresar."
      size={createMode === "batch" ? "wide" : "default"}
    >
      <DenseTabs<"single" | "batch">
        label="Modo de alta"
        idPrefix="create-user-mode"
        tabs={createTabs}
        active={createMode}
        onChange={setCreateMode}
      />
      <div className="dense-drawer-body">
        {createMode === "single" ? (
          createdInternalUser ? (
            <div className="study-form study-form--compact" role="status">
              <p>
                Cuenta creada para <strong>{createdInternalUser.email}</strong>.
              </p>
              <Field
                id="internal-temporary-password"
                label="Contraseña temporal"
                type="text"
                readOnly
                value={createdInternalUser.temporaryPassword}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  void navigator.clipboard.writeText(createdInternalUser.temporaryPassword)
                }
              >
                Copiar contraseña
              </Button>
              <div className="study-form__actions">
                <Button type="button" onClick={closeInternalDrawer}>
                  Terminar
                </Button>
                <Button type="button" variant="ghost" onClick={() => setCreatedInternalUser(null)}>
                  Crear otro
                </Button>
              </div>
            </div>
          ) : (
            <form
              className="study-form study-form--compact dense-form"
              onSubmit={(event) => {
                event.preventDefault();
                setActionError(null);
                inviteInternal.mutate();
              }}
            >
              <Field
                id="internal-invite-name"
                label="Nombre *"
                value={internalName}
                onChange={(event) => setInternalName(event.target.value)}
                required
              />
              <Field
                id="internal-invite-email"
                label="Correo *"
                type="email"
                value={internalEmail}
                onChange={(event) => setInternalEmail(event.target.value)}
                required
              />
              <fieldset className="dense-roles dense-form__full">
                <legend className="ds-field__label">Rol interno</legend>
                {INTERNAL_ROLE_OPTIONS.map(([value, label]) => (
                  <label
                    key={value}
                    className={`dense-role${internalRole === value ? " dense-role--on" : ""}`}
                  >
                    <input
                      type="radio"
                      name="internal-role"
                      value={value}
                      checked={internalRole === value}
                      onChange={() => setInternalRole(value)}
                    />
                    <span>
                      <strong>{label}</strong>{" "}
                      <small>
                        · {(INTERNAL_MODULES_BY_ROLE[value] ?? []).length} de{" "}
                        {INTERNAL_MODULES.length} módulos
                      </small>
                    </span>
                  </label>
                ))}
                <small className="muted-copy">
                  {(INTERNAL_MODULES_BY_ROLE[internalRole] ?? []).join(" · ")}
                </small>
              </fieldset>
              {inviteInternal.isError && actionError ? (
                <p className="form-error" role="alert">
                  {actionError}
                </p>
              ) : null}
              {!internalEmail.trim() || !internalName.trim() ? (
                <p className="form-submit-hint" role="note">
                  Ingresá nombre y correo para poder crear el usuario.
                </p>
              ) : null}
              <div className="study-form__actions">
                <Button
                  type="submit"
                  loading={inviteInternal.isPending}
                  disabled={!internalEmail.trim() || !internalName.trim()}
                >
                  <Icon name="plus" size={17} /> Crear usuario
                </Button>
                <Button type="button" variant="ghost" onClick={closeInternalDrawer}>
                  Cancelar
                </Button>
              </div>
            </form>
          )
        ) : batchResults ? (
          <div className="dense-stack" role="status">
            <p>
              Se crearon <strong>{batchResults.filter((item) => item.created).length}</strong> de{" "}
              {batchResults.length} usuarios. Las contraseñas temporales se muestran una sola vez:
              descargalas ahora.
            </p>
            <div className="dense-batch-preview">{tablaResultadoLote}</div>
            <div className="study-form__actions">
              <Button
                type="button"
                variant="secondary"
                onClick={downloadBatchCredentials}
                disabled={!batchResults.some((item) => item.created)}
              >
                Descargar CSV
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setBatchText("");
                  closeInternalDrawer();
                }}
              >
                Terminar
              </Button>
            </div>
          </div>
        ) : (
          <div className="dense-stack">
            <label className="ds-field">
              <span className="ds-field__label">Una persona por línea: nombre, correo, rol</span>
              <textarea
                className="ds-field__input dense-textarea"
                rows={6}
                value={batchText}
                onChange={(event) => setBatchText(event.target.value)}
                placeholder={
                  "Lucía Fernández, lucia@estudio.com, Preparador\nMartín Acosta, martin@estudio.com, Revisor"
                }
              />
              <span className="ds-field__hint">
                Si falta el rol se asigna Preparador. Podés cambiarlo después desde la tabla.
              </span>
            </label>
            {batchLines.length > 0 ? (
              <div className="dense-batch-preview">
                <p>
                  {validBatchLines.length} de {batchLines.length} líneas válidas para crear.
                </p>
                {tablaVistaPreviaLote}
              </div>
            ) : null}
            {validBatchLines.length === 0 ? (
              <p className="form-submit-hint" role="note">
                Ingresá al menos una línea válida para crear usuarios.
              </p>
            ) : null}
            <div className="study-form__actions">
              <Button
                type="button"
                loading={batchRunning}
                disabled={validBatchLines.length === 0}
                onClick={() => void runBatch()}
              >
                <Icon name="plus" size={17} />{" "}
                {validBatchLines.length === 0
                  ? "Crear usuarios"
                  : `Crear ${validBatchLines.length} ${validBatchLines.length === 1 ? "usuario" : "usuarios"}`}
              </Button>
              <Button type="button" variant="ghost" onClick={closeInternalDrawer}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </div>
    </ActionDrawer>
  );
}
