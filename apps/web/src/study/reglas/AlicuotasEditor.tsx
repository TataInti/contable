import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import type { CatalogEconomicActivity, TaxRuleKindOption } from "@contable/contracts";
import { MONOTRIBUTO_CATEGORY_CODES } from "@contable/contracts";
import { Button, MoneyField, Table } from "@contable/design-system";
import { Icon } from "../../ui/Icon";
import type { RuleJurisdictionOption, RulePackDetail, RuleRow, RuleVersion } from "./tipos";

interface AlicuotasEditorProps {
  editable: boolean;
  canStartNewVersion: boolean;
  regimeMissingFamily: boolean;
  detailQuery: UseQueryResult<RulePackDetail, Error>;
  selectedVersion: RuleVersion;
  validFrom: string;
  setShowCloneForm: Dispatch<SetStateAction<boolean>>;
  cloneMutation: UseMutationResult<unknown, Error, void>;
  draftRows: RuleRow[];
  setDraftRows: Dispatch<SetStateAction<RuleRow[]>>;
  rowFieldErrors: Record<string, string>;
  setRowFieldErrors: Dispatch<SetStateAction<Record<string, string>>>;
  ruleKindsQuery: UseQueryResult<TaxRuleKindOption[], Error>;
  activitiesQuery: UseQueryResult<CatalogEconomicActivity[], Error>;
  jurisdictionsQuery: UseQueryResult<RuleJurisdictionOption[], Error>;
  saveMutation: UseMutationResult<unknown, Error, void>;
}

export function AlicuotasEditor({
  editable,
  canStartNewVersion,
  regimeMissingFamily,
  detailQuery,
  selectedVersion,
  validFrom,
  setShowCloneForm,
  cloneMutation,
  draftRows,
  setDraftRows,
  rowFieldErrors,
  setRowFieldErrors,
  ruleKindsQuery,
  activitiesQuery,
  jurisdictionsQuery,
  saveMutation,
}: AlicuotasEditorProps) {
  // Los campos de cada regla se nombran por su posición, no por un identificador interno.
  const rowNumber = (row: { id: string }) => draftRows.findIndex((item) => item.id === row.id) + 1;

  const updateDraftRule = (ruleId: string, changes: Partial<RuleRow>) => {
    setDraftRows((rows) => rows.map((row) => row.id === ruleId ? { ...row, ...changes } : row));
    setRowFieldErrors((previous) => Object.fromEntries(
      Object.entries(previous).filter(([key]) => !key.startsWith(`${ruleId}.`)),
    ));
  };

  return (
    <>
              <section className="study-panel" aria-labelledby="rule-rates-title">
                <div className="study-panel__heading">
                  <div>
                    <h2 id="rule-rates-title">Alícuotas y porcentajes</h2>
                    <p>
                      Elegí el tipo y el sujeto desde los catálogos del régimen. Concepto identifica
                      la regla para el estudio y es opcional.
                    </p>
                    {canStartNewVersion && regimeMissingFamily ? (
                      <p className="muted-copy">
                        Este régimen no tiene familia de cálculo, así que no se puede abrir una
                        versión nueva ni calcular con él. Asignale una familia en Catálogos fiscales.
                      </p>
                    ) : canStartNewVersion ? (
                      <p className="muted-copy">
                        Esta versión es de sólo lectura porque ya se usa para calcular. Para cambiar
                        valores se abre un borrador nuevo; la versión actual sigue aplicando hasta
                        que actives la nueva.
                      </p>
                    ) : null}
                  </div>
                  {editable ? (
                    <Button
                      size="sm"
                      onClick={() =>
                        setDraftRows((rows) => [
                          ...rows,
                          {
                            id: crypto.randomUUID(),
                            concept: "",
                            kindId: null,
                            activityId: null,
                            categoryCode: null,
                            isDefault: false,
                            activityCode: null,
                            jurisdictionId: null,
                            rate: null,
                            minAmount: null,
                            validFrom,
                            validTo: null,
                          },
                        ])
                      }
                    >
                      <Icon name="plus" size={15} /> Agregar regla
                    </Button>
                  ) : canStartNewVersion && regimeMissingFamily ? (
                    <a
                      className="dense-link"
                      href={`/catalogos-fiscales?editRegime=${encodeURIComponent(detailQuery.data?.regime.id ?? "")}`}
                    >
                      Asignar familia de cálculo
                    </a>
                  ) : canStartNewVersion ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        cloneMutation.reset();
                        setShowCloneForm(true);
                      }}
                    >
                      Modificar alícuotas
                    </Button>
                  ) : null}
                </div>
                <Table<RuleRow>
                  rows={editable ? draftRows : selectedVersion.rateRules}
                  rowKey={(row) => row.id}
                  empty="Esta versión no tiene alícuotas configuradas."
                  columns={[
                    {
                      key: "concept",
                      header: "Concepto",
                      render: (row) =>
                        editable ? (
                          <input
                            className="fiscal-rule-input fiscal-rule-input--concept"
                            aria-label={`Concepto de la fila ${rowNumber(row)}`}
                            value={row.concept}
                            placeholder="Etiqueta opcional"
                            onChange={(event) => updateDraftRule(row.id, { concept: event.target.value })}
                          />
                        ) : (
                          row.concept
                        ),
                    },
                    {
                      key: "kind",
                      header: "Tipo de regla",
                      render: (row) => {
                        const kinds = ruleKindsQuery.data ?? [];
                        const currentKind = kinds.find((kind) => kind.id === row.kindId);
                        if (!editable) return currentKind?.label ?? "Tipo sin resolver";
                        const error = rowFieldErrors[`${row.id}.kindId`];
                        return (
                          <div>
                            <select
                              className="fiscal-rule-input fiscal-rule-input--select"
                              aria-label={`Tipo de regla de la fila ${rowNumber(row)}`}
                              aria-invalid={Boolean(error)}
                              value={row.kindId ?? ""}
                              onChange={(event) => updateDraftRule(row.id, {
                                kindId: event.target.value || null,
                                activityId: null,
                                activityCode: null,
                                jurisdictionId: null,
                                categoryCode: null,
                                isDefault: false,
                              })}
                            >
                              <option value="">Seleccioná un tipo…</option>
                              {kinds.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
                            </select>
                            {error ? <p className="fiscal-rule-row-error" role="alert">{error}</p> : null}
                          </div>
                        );
                      },
                    },
                    ...((ruleKindsQuery.data ?? []).some((option) => option.subject === "ACTIVITY" || option.subject === "ACTIVITY_OR_DEFAULT") ? [{
                      key: "activity",
                      header: "Actividad",
                      render: (row: RuleRow) => {
                        const kind = (ruleKindsQuery.data ?? []).find((option) => option.id === row.kindId);
                        if (kind?.subject !== "ACTIVITY_OR_DEFAULT" && kind?.subject !== "ACTIVITY") return "—";
                        if (!editable) {
                          const currentActivity = (activitiesQuery.data ?? []).find(
                            (activity) => activity.id === row.activityId,
                          );
                          return row.activityId
                            ? `${currentActivity?.code ?? row.activityCode ?? "Actividad"}${currentActivity && !currentActivity.isActive ? " (oculta)" : ""}`
                            : row.isDefault ? "Todas las actividades" : row.activityCode ?? "Sin actividad específica";
                        }
                        // La opción actual oculta o ajena a la jurisdicción se
                        // conserva como lectura deshabilitada; para elegirla
                        // nuevamente hay que mostrarla en el catálogo.
                        const packJurisdictionId = detailQuery.data?.regime.jurisdiction.id;
                        const catalogActivities = activitiesQuery.data ?? [];
                        const options = catalogActivities.filter(
                          (activity) =>
                            activity.isActive &&
                            (!packJurisdictionId || activity.jurisdictionId === packJurisdictionId),
                        );
                        const currentCode = row.activityCode ?? "";
                        const currentActivity = catalogActivities.find(
                          (activity) => activity.id === row.activityId,
                        );
                        const isLegacyCode =
                          Boolean(row.activityId || currentCode) &&
                          !options.some((activity) => activity.id === row.activityId);
                        const rowError = rowFieldErrors[`${row.id}.activityId`];
                        return (
                          <div>
                            <select
                              className="fiscal-rule-input fiscal-rule-input--select"
                              aria-label={`Actividad de la fila ${rowNumber(row)}`}
                              aria-invalid={Boolean(rowError)}
                                  value={row.isDefault && kind.subject === "ACTIVITY_OR_DEFAULT" ? "__all__" : row.activityId ?? row.activityCode ?? ""}
                              onChange={(event) => {
                                const value = event.target.value;
                                const selected = options.find((activity) => activity.id === value);
                                updateDraftRule(row.id, {
                                  activityId: selected?.id ?? null,
                                  activityCode: selected?.code ?? null,
                                  isDefault: kind.subject === "ACTIVITY_OR_DEFAULT" && value === "__all__",
                                });
                              }}
                            >
                              <option value="">{kind.subject === "ACTIVITY" ? "Sin actividad específica" : "Seleccioná una actividad…"}</option>
                              {kind.subject === "ACTIVITY_OR_DEFAULT" ? <option value="__all__">Todas las actividades</option> : null}
                              {options.map((activity) => (
                                <option key={activity.id} value={activity.id}>
                                  {activity.code} · {activity.name}
                                </option>
                              ))}
                              {isLegacyCode ? (
                                <option value={row.activityId ?? row.activityCode ?? ""} disabled>
                                  {currentActivity && !currentActivity.isActive
                                    ? `${row.activityCode} (oculto)`
                                    : `${row.activityCode} — código histórico fuera de la jurisdicción del paquete`}
                                </option>
                              ) : null}
                            </select>
                            {rowError ? (
                              <p className="fiscal-rule-row-error" role="alert">
                                {rowError}
                              </p>
                            ) : null}
                          </div>
                        );
                      },
                    }] : []),
                    ...((ruleKindsQuery.data ?? []).some((option) => option.subject === "JURISDICTION" || option.subject === "JURISDICTION_OR_DEFAULT") ? [{
                      key: "jurisdiction",
                      header: "Jurisdicción",
                      render: (row: RuleRow) => {
                        const kind = (ruleKindsQuery.data ?? []).find((option) => option.id === row.kindId);
                        if (kind?.subject !== "JURISDICTION" && kind?.subject !== "JURISDICTION_OR_DEFAULT") return "—";
                        const options = jurisdictionsQuery.data ?? [];
                        const error = rowFieldErrors[`${row.id}.jurisdictionId`];
                        const current = options.find((option) => option.id === row.jurisdictionId);
                        if (!editable) return current?.name ?? row.jurisdictionId ?? "Sin jurisdicción";
                        return (
                          <div>
                            <select
                              className="fiscal-rule-input fiscal-rule-input--select"
                              aria-label={`Jurisdicción de la fila ${rowNumber(row)}`}
                              aria-invalid={Boolean(error)}
                              value={row.isDefault && kind.subject === "JURISDICTION_OR_DEFAULT" ? "__all__" : row.jurisdictionId ?? ""}
                              onChange={(event) => updateDraftRule(row.id, {
                                jurisdictionId: event.target.value && event.target.value !== "__all__" ? event.target.value : null,
                                isDefault: event.target.value === "__all__",
                              })}
                            >
                              <option value="">Seleccioná una jurisdicción…</option>
                              {kind.subject === "JURISDICTION_OR_DEFAULT" ? <option value="__all__">Todas las jurisdicciones</option> : null}
                              {options.filter((option) => option.isActive).map((option) => (
                                <option key={option.id} value={option.id}>{option.name}</option>
                              ))}
                              {current && !current.isActive ? <option value={current.id} disabled>{current.name} (oculta)</option> : null}
                            </select>
                            {error ? <p className="fiscal-rule-row-error" role="alert">{error}</p> : null}
                          </div>
                        );
                      },
                    }] : []),
                    ...((ruleKindsQuery.data ?? []).some((option) => option.subject === "CATEGORY") ? [{
                      key: "category",
                      header: "Categoría",
                      render: (row: RuleRow) => {
                        const kind = (ruleKindsQuery.data ?? []).find((option) => option.id === row.kindId);
                        if (kind?.subject !== "CATEGORY") return "—";
                        const error = rowFieldErrors[`${row.id}.categoryCode`];
                        if (!editable) return row.categoryCode ?? "Sin categoría";
                        return (
                          <div>
                            <select
                              className="fiscal-rule-input fiscal-rule-input--select"
                              aria-label={`Categoría de la fila ${rowNumber(row)}`}
                              aria-invalid={Boolean(error)}
                              value={row.categoryCode ?? ""}
                              onChange={(event) => updateDraftRule(row.id, { categoryCode: event.target.value || null })}
                            >
                              <option value="">Seleccioná una categoría…</option>
                              {MONOTRIBUTO_CATEGORY_CODES.map((code) => <option key={code} value={code}>Categoría {code}</option>)}
                            </select>
                            {error ? <p className="fiscal-rule-row-error" role="alert">{error}</p> : null}
                          </div>
                        );
                      },
                    }] : []),
                    {
                      key: "rate",
                      header: "Alícuota",
                      align: "right",
                      render: (row) =>
                        editable ? (
                          <MoneyField
                            className="fiscal-rule-input fiscal-rule-input--number"
                            aria-label={`Alícuota de la fila ${rowNumber(row)}`}
                            prefix="%"
                            maxDecimals={4}
                            value={row.rate ?? ""}
                            onChange={(value) =>
                              setDraftRows((rows) =>
                                rows.map((item) =>
                                  item.id === row.id
                                    ? { ...item, rate: value || null }
                                    : item,
                                ),
                              )
                            }
                          />
                        ) : row.rate ? (
                          `${row.rate}%`
                        ) : (
                          "—"
                        ),
                    },
                    {
                      key: "minimum",
                      header: "Mínimo",
                      align: "right",
                      render: (row) =>
                        editable ? (
                          <MoneyField
                            className="fiscal-rule-input fiscal-rule-input--number"
                            aria-label={`Mínimo de la fila ${rowNumber(row)}`}
                            value={row.minAmount ?? ""}
                            onChange={(value) =>
                              setDraftRows((rows) =>
                                rows.map((item) =>
                                  item.id === row.id
                                    ? { ...item, minAmount: value || null }
                                    : item,
                                ),
                              )
                            }
                          />
                        ) : (
                          (row.minAmount ?? "—")
                        ),
                    },
                    {
                      key: "actions",
                      header: "",
                      render: (row) =>
                        editable ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setDraftRows((rows) => rows.filter((item) => item.id !== row.id))
                            }
                          >
                            Quitar
                          </Button>
                        ) : null,
                    },
                  ]}
                />
                {editable ? (
                  <div className="study-page__actions fiscal-rule-actions">
                    <Button
                      onClick={() => {
                        const missingKindRows = draftRows.filter((row) => !row.kindId);
                        if (missingKindRows.length > 0) {
                          setRowFieldErrors(Object.fromEntries(missingKindRows.map((row) => [
                            `${row.id}.kindId`, "Seleccioná un tipo de regla.",
                          ])));
                          return;
                        }
                        saveMutation.mutate();
                      }}
                      loading={saveMutation.isPending}
                      disabled={draftRows.some(
                        (row) => !row.rate && !row.minAmount,
                      )}
                    >
                      Guardar borrador
                    </Button>
                  </div>
                ) : null}
                {editable && draftRows.some((row) => !row.rate && !row.minAmount) ? (
                  <p className="form-submit-hint" role="note">
                    Completá la tasa, cuota o importe de cada fila para guardar el borrador.
                  </p>
                ) : null}
              </section>
    </>
  );
}
