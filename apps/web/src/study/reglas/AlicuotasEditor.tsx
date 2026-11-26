import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import type { CatalogEconomicActivity, TaxRuleKindOption } from "@contable/contracts";
import { MONOTRIBUTO_CATEGORY_CODES } from "@contable/contracts";
import { Button, MoneyField, Notice, Table, SearchSelect } from "@contable/design-system";
import { Icon } from "../../ui/Icon";
import { ErrorConsulta } from "./Errores";
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
  canPropose: boolean;
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
  canPropose,
}: AlicuotasEditorProps) {
  // Las columnas de actividad y jurisdicción dependen de los tipos de regla que devuelve el catálogo.
  const subjetosTipo = new Set((ruleKindsQuery.data ?? []).map((option) => option.subject));
  const usaActividades = subjetosTipo.has("ACTIVITY") || subjetosTipo.has("ACTIVITY_OR_DEFAULT");
  const usaJurisdicciones = subjetosTipo.has("JURISDICTION") || subjetosTipo.has("JURISDICTION_OR_DEFAULT");
  const reglasSinTipo = !editable && ruleKindsQuery.isSuccess && selectedVersion.rateRules.some(
    (row) => !(ruleKindsQuery.data ?? []).some((kind) => kind.id === row.kindId),
  );
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
                    <Button variant="secondary"
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
                    <Button variant="secondary"
                      size="sm"
                      onClick={() => {
                        cloneMutation.reset();
                        setShowCloneForm(true);
                      }}
                    >
                      Crear a partir de este
                    </Button>
                  ) : null}
                </div>
                {reglasSinTipo ? (
                  <Notice tone="warning">
                    Hay reglas sin tipo identificable. Antes de usar esta versión, revisá sus alícuotas con quien administra el estudio y creá una versión corregida si corresponde.
                  </Notice>
                ) : null}
                {ruleKindsQuery.isError ? (
                  <ErrorConsulta
                    titulo="No se pudieron cargar los tipos de regla"
                    descripcion="Sin ese catálogo no se puede elegir el tipo de cada regla."
                    onRetry={() => void ruleKindsQuery.refetch()}
                  />
                ) : null}
                {activitiesQuery.isError && usaActividades ? (
                  <ErrorConsulta
                    titulo="No se pudieron cargar las actividades"
                    descripcion="Sin ese catálogo no se puede elegir la actividad de la regla."
                    onRetry={() => void activitiesQuery.refetch()}
                  />
                ) : null}
                {jurisdictionsQuery.isError && usaJurisdicciones ? (
                  <ErrorConsulta
                    titulo="No se pudieron cargar las jurisdicciones"
                    descripcion="Sin ese catálogo no se puede elegir la jurisdicción de la regla."
                    onRetry={() => void jurisdictionsQuery.refetch()}
                  />
                ) : null}
                {!editable && selectedVersion.status === "DRAFT" && !canPropose ? (
                  <p className="muted-copy">Este borrador es de solo lectura: tu permiso no incluye proponer cambios.</p>
                ) : null}
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
                        if (ruleKindsQuery.isLoading) return <span className="muted-copy">Cargando…</span>;
                        if (ruleKindsQuery.isError) return <span className="muted-copy">No disponible</span>;
                        const kinds = ruleKindsQuery.data ?? [];
                        const currentKind = kinds.find((kind) => kind.id === row.kindId);
                        if (!editable) return currentKind?.label ?? "Tipo sin resolver";
                        const error = rowFieldErrors[`${row.id}.kindId`];
                        return (
                          <div>
                            <SearchSelect
                              label={`Tipo de regla de la fila ${rowNumber(row)}`}
                              hideLabel
                              className="fiscal-rule-input fiscal-rule-input--select"
                              invalid={Boolean(error)}
                              value={row.kindId ?? ""}
                              onChange={(value) => updateDraftRule(row.id, {
                                kindId: value || null,
                                activityId: null,
                                activityCode: null,
                                jurisdictionId: null,
                                categoryCode: null,
                                isDefault: false,
                              })}
                              placeholder="Seleccioná un tipo…"
                              options={kinds.map((kind) => ({ value: kind.id, label: kind.label }))}
                            />
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
                        if (activitiesQuery.isError) return <span className="muted-copy">No disponible</span>;
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
                            <SearchSelect
                              label={`Actividad de la fila ${rowNumber(row)}`}
                              hideLabel
                              className="fiscal-rule-input fiscal-rule-input--select"
                              invalid={Boolean(rowError)}
                              value={row.isDefault && kind.subject === "ACTIVITY_OR_DEFAULT" ? "__all__" : row.activityId ?? row.activityCode ?? ""}
                              onChange={(value) => {
                                const selected = options.find((activity) => activity.id === value);
                                updateDraftRule(row.id, {
                                  activityId: selected?.id ?? null,
                                  activityCode: selected?.code ?? null,
                                  isDefault: kind.subject === "ACTIVITY_OR_DEFAULT" && value === "__all__",
                                });
                              }}
                              placeholder={kind.subject === "ACTIVITY" ? "Sin actividad específica" : "Seleccioná una actividad…"}
                              options={[
                                ...(kind.subject === "ACTIVITY_OR_DEFAULT" ? [{ value: "__all__", label: "Todas las actividades" }] : []),
                                ...options.map((activity) => ({ value: activity.id, label: `${activity.code} · ${activity.name}` })),
                                ...(isLegacyCode
                                  ? [{
                                    value: row.activityId ?? row.activityCode ?? "",
                                    label: currentActivity && !currentActivity.isActive
                                      ? `${row.activityCode} (oculto)`
                                      : `${row.activityCode} — código histórico fuera de la jurisdicción del paquete`,
                                    disabled: true,
                                  }]
                                  : []),
                              ]}
                            />
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
                        if (jurisdictionsQuery.isError) return <span className="muted-copy">No disponible</span>;
                        const options = jurisdictionsQuery.data ?? [];
                        const error = rowFieldErrors[`${row.id}.jurisdictionId`];
                        const current = options.find((option) => option.id === row.jurisdictionId);
                        if (!editable) return current?.name ?? row.jurisdictionId ?? "Sin jurisdicción";
                        return (
                          <div>
                            <SearchSelect
                              label={`Jurisdicción de la fila ${rowNumber(row)}`}
                              hideLabel
                              className="fiscal-rule-input fiscal-rule-input--select"
                              invalid={Boolean(error)}
                              value={row.isDefault && kind.subject === "JURISDICTION_OR_DEFAULT" ? "__all__" : row.jurisdictionId ?? ""}
                              onChange={(value) => updateDraftRule(row.id, {
                                jurisdictionId: value && value !== "__all__" ? value : null,
                                isDefault: value === "__all__",
                              })}
                              placeholder="Seleccioná una jurisdicción…"
                              options={[
                                ...(kind.subject === "JURISDICTION_OR_DEFAULT" ? [{ value: "__all__", label: "Todas las jurisdicciones" }] : []),
                                ...options.filter((option) => option.isActive).map((option) => ({ value: option.id, label: option.name })),
                                ...(current && !current.isActive ? [{ value: current.id, label: `${current.name} (oculta)`, disabled: true }] : []),
                              ]}
                            />
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
                            <SearchSelect
                              label={`Categoría de la fila ${rowNumber(row)}`}
                              hideLabel
                              className="fiscal-rule-input fiscal-rule-input--select"
                              invalid={Boolean(error)}
                              value={row.categoryCode ?? ""}
                              onChange={(value) => updateDraftRule(row.id, { categoryCode: value || null })}
                              placeholder="Seleccioná una categoría…"
                              options={MONOTRIBUTO_CATEGORY_CODES.map((code) => ({ value: code, label: `Categoría ${code}` }))}
                            />
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
              </section>
    </>
  );
}
