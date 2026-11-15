import type { Dispatch, RefObject, SetStateAction } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import { Button } from "@contable/design-system";
import { ErrorAccion } from "./Errores";
import { getStatusBadgeMeta, StatusBadge } from "../../ui/StatusBadge";
import type { RulePackDetail, RuleVersion } from "./tipos";
import { shortDate } from "./utilidades";

interface ResumenVersionProps {
  detail: RulePackDetail;
  selectedVersion: RuleVersion;
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
}

export function ResumenVersion({
  detail,
  selectedVersion,
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
}: ResumenVersionProps) {
  return (
    <>
              <section className="study-panel fiscal-rule-summary fiscal-rule-context">
                <div className="study-panel__heading">
                  <div>
                    <p className="fiscal-rule-context__regime">
                      {detail.regime.taxType.name}{!detail.regime.taxType.isActive ? " (oculto)" : ""} ·{" "}
                      {detail.regime.jurisdiction.name}{!detail.regime.jurisdiction.isActive ? " (oculto)" : ""}
                    </p>
                    <h2>{detail.name}</h2>
                    <p>
                      {detail.code} · Régimen {detail.regime.name}{!detail.regime.isActive ? " (oculto)" : ""} · Organismo recaudador {detail.regime.authority.name}{!detail.regime.authority.isActive ? " (oculto)" : ""}
                    </p>
                  </div>
                  <div className="table-actions">
                    <StatusBadge status={selectedVersion.status} />
                    {canActivateSelectedVersion ? (
                      <Button
                        size="sm"
                        loading={activateMutation.isPending}
                        onClick={() => requestActivation(selectedVersion)}
                      >
                        Activar
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
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={requestPackDeletion}
                      >
                        Eliminar paquete
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="fiscal-rule-summary__meta">
                  {detail.versions.length > 1 ? (
                    <label className="ds-field">
                      <span className="ds-field__label">Versión del paquete</span>
                      <select
                        className="ds-field__input"
                        aria-label="Versión del paquete"
                        value={selectedVersion.id}
                        onChange={(event) => setSelectedVersionId(event.target.value)}
                      >
                        {detail.versions.map((version) => (
                          <option key={version.id} value={version.id}>
                            v{version.version} · {getStatusBadgeMeta(version.status).label} · {shortDate(version.validFrom)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <span>
                    Régimen <strong>{detail.regime.name}</strong>
                  </span>
                  <span>
                    {selectedVersion.status === "DRAFT" ? "Editando borrador" : "Versión"}{" "}
                    <strong>v{selectedVersion.version}</strong>
                  </span>
                  {selectedVersion.status === "DRAFT" && activeVersion ? (
                    <span>
                      Versión activa <strong>v{activeVersion.version}</strong>
                    </span>
                  ) : null}
                  <span>
                    Vigencia{" "}
                    <strong>
                      {shortDate(selectedVersion.validFrom)} — {shortDate(selectedVersion.validTo)}
                    </strong>
                  </span>
                  <span>
                    Motor <strong>{selectedVersion.engineVersion}</strong>
                  </span>
                </div>
                {activationError ? (
                  <div ref={activationFeedbackRef} className="activation-feedback" tabIndex={-1}>
                    <ErrorAccion error={activationError} />
                  </div>
                ) : null}
              </section>
    </>
  );
}
