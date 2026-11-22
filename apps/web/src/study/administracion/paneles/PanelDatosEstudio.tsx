import { Button, Field, SearchSelect } from "@contable/design-system";
import type { Dispatch, SetStateAction } from "react";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import type { FirmProfile } from "../tipos";
import type { groupTimeZones } from "../zonasHorarias";

type Props = {
  setShowProfileForm: Dispatch<SetStateAction<boolean>>;
  profileDraft: FirmProfile;
  setProfileDraft: Dispatch<SetStateAction<FirmProfile | null>>;
  profileTimeZoneGroups: ReturnType<typeof groupTimeZones>;
  updateFirmProfile: { isPending: boolean; isError: boolean; mutate: (profile: FirmProfile) => void };
  actionError: string | null;
  setActionError: Dispatch<SetStateAction<string | null>>;
};

export function PanelEditarDatosEstudio({ setShowProfileForm, profileDraft, setProfileDraft, profileTimeZoneGroups, updateFirmProfile, actionError, setActionError }: Props) {
  return (
    <ActionDrawer
      isOpen
      onClose={() => {
        setShowProfileForm(false);
        setProfileDraft(null);
      }}
      title="Editar datos del estudio"
      description="Actualizá la razón social, el nombre, el CUIT y la zona horaria."
    >
      <form
        className="study-form study-form--compact"
        onSubmit={(event) => {
          event.preventDefault();
          setActionError(null);
          updateFirmProfile.mutate(profileDraft);
        }}
      >
        <Field
          id="firm-profile-legal-name"
          label="Razón social"
          value={profileDraft.legalName}
          onChange={(event) => setProfileDraft({ ...profileDraft, legalName: event.target.value })}
        />
        <Field
          id="firm-profile-display-name"
          label="Nombre del estudio"
          value={profileDraft.displayName}
          onChange={(event) => setProfileDraft({ ...profileDraft, displayName: event.target.value })}
        />
        <Field
          id="firm-profile-tax-id"
          label="CUIT"
          value={profileDraft.taxId ?? ""}
          onChange={(event) => setProfileDraft({ ...profileDraft, taxId: event.target.value })}
        />
        <div className="ds-field">
          <span className="ds-field__label">Zona horaria</span>
          <SearchSelect
            id="firm-profile-timezone"
            label="Zona horaria"
            hideLabel
            value={profileDraft.timezone}
            onChange={(value) => setProfileDraft({ ...profileDraft, timezone: value })}
            groups={profileTimeZoneGroups.map((group) => ({ label: group.label, options: group.options }))}
          />
        </div>
        {updateFirmProfile.isError && actionError ? (
          <p className="form-error" role="alert">{actionError}</p>
        ) : null}
        <div className="study-form__actions">
          <Button type="submit" loading={updateFirmProfile.isPending}>
            Guardar cambios
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setShowProfileForm(false);
              setProfileDraft(null);
            }}
          >
            Cancelar
          </Button>
        </div>
      </form>
    </ActionDrawer>
  );
}
