import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { Button } from "@contable/design-system";
import type { Credential, RuleVersion } from "./tipos";

interface TabControlProfesionalProps {
  selectedVersion: RuleVersion;
  canPropose: boolean;
  submitMutation: UseMutationResult<unknown, Error, void>;
  capabilities: ReadonlySet<string>;
  credentialId: string;
  setCredentialId: Dispatch<SetStateAction<string>>;
  credentialQuery: UseQueryResult<Credential[], Error>;
  approveMutation: UseMutationResult<unknown, Error, void>;
}

export function TabControlProfesional({
  selectedVersion,
  canPropose,
  submitMutation,
  capabilities,
  credentialId,
  setCredentialId,
  credentialQuery,
  approveMutation,
}: TabControlProfesionalProps) {
  return (
    <>
              <section id="rule-approval" className="study-panel fiscal-rule-approval">
                <div>
                  <h2>Flujo de revisión anterior</h2>
                  <p>
                    La activación directa es el recorrido principal. Las versiones históricas pueden
                    conservar revisión profesional; las versiones activas siguen siendo inmutables.
                  </p>
                </div>
                <div className="fiscal-rule-approval__actions">
                  {selectedVersion.status === "DRAFT" && canPropose ? (
                    <Button
                      variant="secondary"
                      onClick={() => submitMutation.mutate()}
                      loading={submitMutation.isPending}
                    >
                      Enviar a revisión (flujo anterior)
                    </Button>
                  ) : null}
                  {selectedVersion.status === "IN_REVIEW" &&
                  capabilities.has("tax.rules.approve") ? (
                    <>
                      <select
                        className="ds-field__input"
                        aria-label="Matrícula para aprobar"
                        value={credentialId}
                        onChange={(event) => setCredentialId(event.target.value)}
                      >
                        <option value="">Seleccioná matrícula…</option>
                        {credentialQuery.data?.map((credential) => (
                          <option key={credential.id} value={credential.id}>
                            {credential.registrationNumber} · {credential.jurisdiction.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        disabled={!credentialId}
                        loading={approveMutation.isPending}
                        onClick={() => approveMutation.mutate()}
                      >
                        Aprobar
                      </Button>
                      {!credentialId ? (
                        <p className="form-submit-hint" role="note">
                          Seleccioná la matrícula profesional para habilitar la aprobación.
                        </p>
                      ) : null}
                    </>
                  ) : null}
                </div>
                {selectedVersion.sources.length > 0 ? (
                  <p className="fiscal-rule-approval__sources">
                    Fuentes:{" "}
                    {selectedVersion.sources
                      .map((source) => source.reference || source.title)
                      .join(" · ")}
                  </p>
                ) : (
                  <p className="fiscal-rule-approval__sources">Sin fuente normativa cargada.</p>
                )}
              </section>
    </>
  );
}
