import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { Button, SearchSelect } from "@contable/design-system";
import { DenseSection } from "../../ui/Dense";
import type { Credential, RuleVersion } from "./tipos";
import { ErrorAccion, ErrorConsulta } from "./Errores";

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
              <DenseSection
                id="rule-approval"
                title="Flujo de revisión anterior"
                description="La activación directa es el recorrido principal. Las versiones históricas pueden conservar revisión profesional; las versiones vigentes siguen siendo inmutables."
              >
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
                  {submitMutation.error ? <ErrorAccion error={submitMutation.error} /> : null}
                  {selectedVersion.status === "IN_REVIEW" &&
                  capabilities.has("tax.rules.approve") ? (
                    <>
                      {credentialQuery.isError ? (
                        <ErrorConsulta
                          titulo="No se pudieron cargar las matrículas"
                          descripcion="Sin ese catálogo no se puede elegir la matrícula para aprobar."
                          onRetry={() => void credentialQuery.refetch()}
                        />
                      ) : credentialQuery.data?.length === 0 ? (
                        <p className="muted-copy">No hay matrículas profesionales cargadas para el estudio; sin una no se puede aprobar esta versión.</p>
                      ) : (
                      <SearchSelect
                        label="Matrícula para aprobar"
                        hideLabel
                        className="ds-field__input"
                        value={credentialId}
                        onChange={(value) => setCredentialId(value)}
                        placeholder="Seleccioná matrícula…"
                        options={(credentialQuery.data ?? []).map((credential) => ({
                          value: credential.id,
                          label: `${credential.registrationNumber} · ${credential.jurisdiction.name}`,
                        }))}
                      />
                      )}
                      <Button
                        variant="secondary"
                        disabled={!credentialId}
                        loading={approveMutation.isPending}
                        onClick={() => approveMutation.mutate()}
                      >
                        Aprobar
                      </Button>
                      {!credentialId && credentialQuery.data?.length ? (
                        <p className="form-submit-hint" role="note">
                          Seleccioná la matrícula profesional para habilitar la aprobación.
                        </p>
                      ) : null}
                      {approveMutation.error ? <ErrorAccion error={approveMutation.error} /> : null}
                    </>
                  ) : null}
                  {selectedVersion.status === "IN_REVIEW" && !capabilities.has("tax.rules.approve") ? (
                    <p className="muted-copy">Esta versión está en revisión. Solo quien tiene permiso para aprobar reglas puede aprobarla.</p>
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
              </DenseSection>
    </>
  );
}
