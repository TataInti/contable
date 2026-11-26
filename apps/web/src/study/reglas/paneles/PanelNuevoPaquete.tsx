import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { Button, Field, SearchSelect } from "@contable/design-system";
import { ActionDrawer, ActionDrawerFooter } from "../../../ui/ActionDrawer";
import type { RulePack, RuleRegimeOption } from "../tipos";
import { ErrorAccion, ErrorConsulta } from "../Errores";

type NuevoPaquete = { code: string; name: string; regimeId: string };

interface PanelNuevoPaqueteProps {
  showPackForm: boolean;
  setShowPackForm: Dispatch<SetStateAction<boolean>>;
  newPack: NuevoPaquete;
  setNewPack: Dispatch<SetStateAction<NuevoPaquete>>;
  createPackMutation: UseMutationResult<RulePack, Error, void>;
  regimesQuery: UseQueryResult<RuleRegimeOption[], Error>;
}

export function PanelNuevoPaquete({
  showPackForm,
  setShowPackForm,
  newPack,
  setNewPack,
  createPackMutation,
  regimesQuery,
}: PanelNuevoPaqueteProps) {
  // El motivo del botón deshabilitado va junto a la acción, en el pie fijo del cajón (P4, P5).
  const motivoCrear =
    !newPack.code.trim() || !newPack.name.trim() || !newPack.regimeId
      ? "Completá código, nombre y régimen para poder crear el paquete."
      : null;
  const footerNuevo = (
    <ActionDrawerFooter
      primary={
        <Button
          type="submit"
          form="new-rule-pack-form"
          loading={createPackMutation.isPending}
          disabled={motivoCrear !== null}
        >
          Crear paquete
        </Button>
      }
      hint={motivoCrear}
      onCancel={() => setShowPackForm(false)}
    />
  );
  return (
    <>
      <ActionDrawer
        isOpen={showPackForm}
        onClose={() => setShowPackForm(false)}
        title="Nuevo paquete de reglas"
        description="Iniciá la configuración para un régimen y luego abrí su primera versión."
        size="wide"
        footer={footerNuevo}
      >
        <form
          id="new-rule-pack-form"
          className="study-form fiscal-action-form"
          onSubmit={(event) => {
            event.preventDefault();
            createPackMutation.mutate();
          }}
        >
          <Field
            label="Código"
            id="new-rule-pack-code"
            value={newPack.code}
            onChange={(event) => setNewPack({ ...newPack, code: event.target.value.toUpperCase() })}
            placeholder="IVA-RI-ARCA"
            required
          />
          <Field
            label="Nombre"
            id="new-rule-pack-name"
            value={newPack.name}
            onChange={(event) => setNewPack({ ...newPack, name: event.target.value })}
            placeholder="IVA Responsable Inscripto"
            required
          />
          <div className="ds-field">
            <label className="ds-field__label" htmlFor="new-rule-pack-regime">
              Régimen <span aria-hidden="true">*</span>
            </label>
            <SearchSelect
              id="new-rule-pack-regime"
              label="Régimen"
              hideLabel
              value={newPack.regimeId}
              onChange={(value) => setNewPack({ ...newPack, regimeId: value })}
              required
              placeholder="Seleccioná un régimen…"
              options={(regimesQuery.data ?? []).map((regime) => ({
                value: regime.id,
                label: `${regime.name} · ${regime.taxType.name} · ${regime.jurisdiction.name}`,
              }))}
            />
            {regimesQuery.isError ? (
              <ErrorConsulta
                titulo="No pudimos consultar los regímenes"
                descripcion="Reintentá la consulta para elegir el régimen del paquete."
                onRetry={() => void regimesQuery.refetch()}
              />
            ) : regimesQuery.isSuccess && regimesQuery.data.length === 0 ? (
              <p className="form-submit-hint" role="note">
                Todavía no hay regímenes. Creá uno en{" "}
                <a
                  className="dense-link"
                  href="/catalogos-fiscales"
                >
                  Catálogos fiscales
                </a>.
              </p>
            ) : null}
          </div>
          {createPackMutation.error ? <ErrorAccion error={createPackMutation.error} /> : null}
        </form>
      </ActionDrawer>
    </>
  );
}
