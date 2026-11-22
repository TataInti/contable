import type { Dispatch, RefObject, SetStateAction } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import { Button, Notice, SearchSelect } from "@contable/design-system";
import { DenseSection } from "../../ui/Dense";
import { StatusBadge } from "../../ui/StatusBadge";
import { ErrorAccion } from "./Errores";
import type { RulePackDetail, RuleVersion } from "./tipos";
import { formatearFecha, formatearRango } from "../../lib/formatoFechas";

interface ResumenVersionProps {
  detail: RulePackDetail;
  selectedVersion?: RuleVersion;
  canPropose: boolean;
  canActivateSelectedVersion: boolean;
  activateMutation: UseMutationResult<unknown, Error, string>;
  requestActivation: (version: RuleVersion) => void;
  canDeleteVersion: boolean;
  canDeletePack: boolean;
  firmId: string | null;
  setDeletingTarget: Dispatch<SetStateAction<{ path: string; kind: "pack" | "version" } | null>>;
  requestPackDeletion: () => void;
  setSelectedVersionId: Dispatch<SetStateAction<string | null>>;
  activeVersion: RuleVersion | undefined;
  activationError: Error | null;
  activationFeedbackRef: RefObject<HTMLDivElement | null>;
  editable: boolean;
  bloqueadaPorCambios: boolean;
  saveMutation: UseMutationResult<unknown, Error, void>;
  saveError: Error | null;
  guardarIncompleto: boolean;
  onGuardar: () => void;
  onNuevaVersion: () => void;
  onEditarBorrador: () => void;
}

// Encabezado del resumen (D-R3-2): la acción primaria es el próximo paso de la versión
// (D-R3-1). El estado de la versión aparece una sola vez (D-R3-5), «Eliminar paquete» en
// una sola entrada (D-R3-6) y el resumen va sin caja (D-R3-7).
export function ResumenVersion({
  detail,
  selectedVersion,
  canPropose,
  canActivateSelectedVersion,
  activateMutation,
  requestActivation,
  canDeleteVersion,
  canDeletePack,
  firmId,
  setDeletingTarget,
  requestPackDeletion,
  setSelectedVersionId,
  activeVersion,
  activationError,
  activationFeedbackRef,
  editable,
  bloqueadaPorCambios,
  saveMutation,
  saveError,
  guardarIncompleto,
  onGuardar,
  onNuevaVersion,
  onEditarBorrador,
}: ResumenVersionProps) {
  const oculto = (activo: boolean) => (activo ? "" : " (oculto)");
  const descripcion =
    `${detail.code} · Régimen ${detail.regime.name}${oculto(detail.regime.isActive)} · ` +
    `Organismo recaudador ${detail.regime.authority.name}${oculto(detail.regime.authority.isActive)}`;
  const guardarEsPrimaria = Boolean(selectedVersion && editable && bloqueadaPorCambios);
  const activarEsPrimaria = Boolean(
    selectedVersion && canActivateSelectedVersion && !bloqueadaPorCambios,
  );

  // Orientación del próximo paso: son los textos vigentes del aviso «Próximo paso», que sale del
  // detalle y queda como línea de ayuda del encabezado (C01, D-R3-2).
  const ayuda = !selectedVersion
    ? canPropose
      ? "Abrí un borrador para cargar alícuotas, vencimientos y fuentes."
      : null
    : editable
      ? "Revisá las reglas y guardá los cambios; después podés activar directamente esta versión."
      : canActivateSelectedVersion
        ? "La versión quedará vigente para los próximos cálculos."
        : null;
  const acciones = selectedVersion ? (
    <>
      {editable && guardarIncompleto ? (
        <p className="form-submit-hint" role="note">
          Completá la tasa, cuota o importe de cada fila para guardar el borrador.
        </p>
      ) : null}
      {editable ? (
        <Button
          size="sm"
          variant={guardarEsPrimaria ? "primary" : "secondary"}
          loading={saveMutation.isPending}
          disabled={guardarIncompleto}
          onClick={onGuardar}
        >
          Guardar borrador
        </Button>
      ) : null}
      {canActivateSelectedVersion ? (
        <Button
          size="sm"
          variant={activarEsPrimaria ? "primary" : "secondary"}
          loading={activateMutation.isPending}
          disabled={bloqueadaPorCambios}
          onClick={() => requestActivation(selectedVersion)}
        >
          Activar
        </Button>
      ) : null}
      {editable ? (
        <Button size="sm" variant="secondary" onClick={onEditarBorrador}>
          Editar borrador v{selectedVersion.version}
        </Button>
      ) : null}
      {canDeleteVersion ? (
        <Button
          size="sm"
          variant="danger"
          onClick={() => {
            if (firmId) {
              setDeletingTarget({
                path: `/firms/${firmId}/tax/rule-versions/${selectedVersion.id}`,
                kind: "version",
              });
            }
          }}
        >
          Eliminar borrador v{selectedVersion.version}
        </Button>
      ) : null}
      {canDeletePack ? (
        <Button size="sm" variant="danger" onClick={requestPackDeletion}>
          Eliminar paquete
        </Button>
      ) : null}
    </>
  ) : (
    <>
      {canPropose ? (
        <Button size="sm" variant="primary" onClick={onNuevaVersion}>
          Crear primera versión
        </Button>
      ) : null}
      {canDeletePack ? (
        <Button size="sm" variant="danger" onClick={requestPackDeletion}>
          Eliminar paquete
        </Button>
      ) : null}
    </>
  );

  return (
    <DenseSection
      id="rule-summary"
      title={detail.name}
      description={descripcion}
      actions={acciones}
    >
      {ayuda ? <p>{ayuda}</p> : null}
      {selectedVersion ? (
        <>
          <p>
            {`${detail.regime.taxType.name}${oculto(detail.regime.taxType.isActive)} · `}
            {`${detail.regime.jurisdiction.name}${oculto(detail.regime.jurisdiction.isActive)}`}
          </p>
          {bloqueadaPorCambios ? (
            <Notice tone="warning">Guardá los cambios del borrador antes de activarlo.</Notice>
          ) : null}
          {saveError ? <ErrorAccion error={saveError} /> : null}
          <div className="fiscal-rule-summary__meta">
            {detail.versions.length > 1 ? (
              <label className="ds-field">
                <span className="ds-field__label">Versión del paquete</span>
                <SearchSelect
                  label="Versión del paquete"
                  hideLabel
                  className="ds-field__input"
                  value={selectedVersion.id}
                  onChange={(value) => setSelectedVersionId(value)}
                  allowEmpty={false}
                  options={detail.versions.map((version) => ({ value: version.id, label: `v${version.version} · ${formatearFecha(version.validFrom)}` }))}
                />
              </label>
            ) : null}
            <span>
              Versión <strong>v{selectedVersion.version}</strong>
            </span>
            <StatusBadge status={selectedVersion.status} />
            {selectedVersion.status === "DRAFT" && activeVersion ? (
              <span>
                Versión vigente <strong>v{activeVersion.version}</strong>
              </span>
            ) : null}
            <span>
              Vigencia{" "}
              <strong>{formatearRango(selectedVersion.validFrom, selectedVersion.validTo)}</strong>
            </span>
            <span>
              Motor de cálculo <strong>{selectedVersion.engineVersion}</strong>
            </span>
          </div>
          {activationError ? (
            <div ref={activationFeedbackRef} tabIndex={-1}>
              <ErrorAccion error={activationError} />
            </div>
          ) : null}
        </>
      ) : null}
    </DenseSection>
  );
}
