import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { Button, Field } from "@contable/design-system";
import { ActionDrawer } from "../../../ui/ActionDrawer";
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
  return (
    <>
      <ActionDrawer
        isOpen={showPackForm}
        onClose={() => setShowPackForm(false)}
        title="Nuevo paquete de reglas"
        description="Iniciá la configuración para un régimen y luego abrí su primera versión."
        size="wide"
      >
        <form
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
              Régimen
            </label>
            <select
              id="new-rule-pack-regime"
              className="ds-field__input"
              value={newPack.regimeId}
              onChange={(event) => setNewPack({ ...newPack, regimeId: event.target.value })}
              required
            >
              <option value="">Seleccioná un régimen…</option>
              {regimesQuery.data?.map((regime) => (
                <option key={regime.id} value={regime.id}>
                  {regime.name} · {regime.taxType.name} · {regime.jurisdiction.name}
                </option>
              ))}
            </select>
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
          <div className="study-form__actions">
            <Button
              type="submit"
              loading={createPackMutation.isPending}
              disabled={!newPack.code.trim() || !newPack.name.trim() || !newPack.regimeId}
            >
              Crear paquete
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowPackForm(false)}>
              Cancelar
            </Button>
          </div>
          {!newPack.code.trim() || !newPack.name.trim() || !newPack.regimeId ? (
            <p className="form-submit-hint" role="note">
              Completá código, nombre y régimen para poder crear el paquete.
            </p>
          ) : null}
        </form>
      </ActionDrawer>
    </>
  );
}
