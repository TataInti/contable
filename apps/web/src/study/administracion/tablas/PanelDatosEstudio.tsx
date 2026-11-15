import { Button } from "@contable/design-system";
import type { FirmProfile } from "../tipos";
import { timeZoneLabel } from "../zonasHorarias";

export function PanelDatosEstudio({ firmProfile, openProfileEdit }: { firmProfile: { data: FirmProfile }; openProfileEdit: () => void }) {
  return (
    <section className="administration-profile" aria-label="Datos del estudio">
      <div className="administration-profile__heading">
        <h2>Datos del estudio</h2>
        <Button size="sm" variant="secondary" onClick={openProfileEdit}>
          Editar datos
        </Button>
      </div>
      <dl className="administration-profile__facts">
        <div>
          <dt>Razón social</dt>
          <dd>{firmProfile.data.legalName || "—"}</dd>
        </div>
        <div>
          <dt>Nombre del estudio</dt>
          <dd>{firmProfile.data.displayName || "—"}</dd>
        </div>
        <div>
          <dt>CUIT</dt>
          <dd>{firmProfile.data.taxId || "—"}</dd>
        </div>
        <div>
          <dt>Zona horaria</dt>
          <dd>{timeZoneLabel(firmProfile.data.timezone)}</dd>
        </div>
      </dl>
    </section>
  );
}
