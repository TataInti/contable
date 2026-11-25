// Etapa Clasificación e imputación del Legajo: clasificación de comprobantes e imputación de retenciones y percepciones (Foco 2.3c).
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { AsyncState, Button, EmptyState, Field, Table, type TableColumn, SearchSelect, ObjectPanel } from "@contable/design-system";
import { StatusBadge } from "../../../ui/StatusBadge";
import { formatCuit } from "../../../lib/cuit";
import { formatMoney } from "../formato";
import type {
  AllocationCoverage,
  ClassificationCoverage,
  ClassificationRule,
  TaxJurisdiction,
  WorkpaperAllocation,
  WorkpaperClassification,
} from "../tipos";
import { WorkpaperActionError } from "../WorkpaperActionError";

type BorradorClasificacion = { categoryCode: string; activityCode: string };

export interface EtapaClasificacionProps {
  capabilities: ReadonlySet<string>;
  canEditSources: boolean;
  classificationQuery: UseQueryResult<ClassificationCoverage, Error>;
  allocationQuery: UseQueryResult<AllocationCoverage, Error>;
  jurisdictionsQuery: UseQueryResult<TaxJurisdiction[], Error>;
  activityOptions: (currentCode: string) => Array<{ code: string; name: string; level?: string }>;
  classificationDrafts: Record<string, BorradorClasificacion>;
  setClassificationDrafts: Dispatch<SetStateAction<Record<string, BorradorClasificacion>>>;
  allocationDrafts: Record<string, string>;
  setAllocationDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  classifyVoucherMutation: UseMutationResult<unknown, Error, WorkpaperClassification>;
  reallocateInputMutation: UseMutationResult<unknown, Error, WorkpaperAllocation>;
  /** Corte 3B: clasificar, excluir y reglas «recordar». Las reglas se leen aparte de la cobertura. */
  canEditClassifications: boolean;
  /** Por qué el mes no admite cambios de clasificación (cerrado o en revisión); null si los admite. */
  motivoClasificacionBloqueada: string | null;
  rememberRule: boolean;
  setRememberRule: Dispatch<SetStateAction<boolean>>;
  rulesQuery: UseQueryResult<ClassificationRule[], Error>;
  bulkClassifyMutation: UseMutationResult<unknown, Error, BloqueClasificacion>;
  excludeMutation: UseMutationResult<unknown, Error, { ids: string[]; reason: string }>;
  includeMutation: UseMutationResult<unknown, Error, { ids: string[] }>;
  deleteRuleMutation: UseMutationResult<unknown, Error, ClassificationRule>;
}

/** Un mismo rubro (compras) o una misma actividad (ventas) para varios comprobantes. */
export type BloqueClasificacion = {
  ids: string[];
  categoryCode: string;
  activityCode: string;
};

// Asignaciones que hace el sistema solo cuando el cliente tiene una única actividad (por cliente o por nivel).
const ORIGENES_AUTOMATICOS = ["SINGLE_CLIENT_ACTIVITY", "SINGLE_ACTIVITY_PER_LEVEL"];

const numeroComprobante = (classification: WorkpaperClassification) =>
  `${classification.voucher.letter ?? classification.voucher.type} · ${String(classification.voucher.pointOfSale).padStart(4, "0")}-${String(classification.voucher.number).padStart(8, "0")}`;

/** El régimen repite al impuesto cuando uno contiene al otro (ej.: «Ingresos Brutos» / «IIBB Contribuyente Local Tucumán»). */
const nombreRedundante = (regimen: string, impuesto: string) => {
  const a = regimen.trim().toLowerCase();
  const b = impuesto.trim().toLowerCase();
  return a === b || a.includes(b) || b.includes(a);
};

const fechaCorta = (value: string) => new Date(value).toLocaleDateString("es-AR", { timeZone: "UTC" });

/** Importes del comprobante: neto (base de las alícuotas), IVA y total. Las notas de crédito restan en los totales. */
const importesDe = (classification: WorkpaperClassification) => {
  const total = Number(classification.voucher.total ?? 0);
  const iva = classification.rateBuckets.reduce((sum, bucket) => sum + Number(bucket.amount), 0);
  const neto = classification.rateBuckets.length > 0
    ? classification.rateBuckets.reduce((sum, bucket) => sum + Number(bucket.base), 0)
    : total;
  const signo = classification.documentKind === "CREDIT_NOTE" ? -1 : 1;
  return { neto, iva, total, signo };
};
const tipoComprobante = (classification: WorkpaperClassification) =>
  classification.documentKind === "CREDIT_NOTE"
    ? "Nota de crédito (resta)"
    : classification.documentKind === "DEBIT_NOTE"
      ? "Nota de débito"
      : null;

export function EtapaClasificacion({
  capabilities,
  canEditSources,
  classificationQuery,
  allocationQuery,
  jurisdictionsQuery,
  activityOptions,
  classificationDrafts,
  setClassificationDrafts,
  allocationDrafts,
  setAllocationDrafts,
  classifyVoucherMutation,
  reallocateInputMutation,
  canEditClassifications,
  motivoClasificacionBloqueada,
  rememberRule,
  setRememberRule,
  rulesQuery,
  bulkClassifyMutation,
  excludeMutation,
  includeMutation,
  deleteRuleMutation,
}: EtapaClasificacionProps) {
  const [filter, setFilter] = useState("ALL");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkActivity, setBulkActivity] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [excluyendo, setExcluyendo] = useState(false);
  const [motivoExclusion, setMotivoExclusion] = useState("");
  const [motivoError, setMotivoError] = useState<string | null>(null);
  const [reglasAbiertas, setReglasAbiertas] = useState(false);
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null);
  const visibleClassifications = useMemo(() => {
    const items = classificationQuery.data?.items ?? [];
    if (filter === "PENDING") {
      return items.filter(
        (item) => !item.excludedAt && (item.status !== "CLASSIFIED" || Boolean(item.activityIssue)),
      );
    }
    return filter === "EXCLUDED" ? items.filter((item) => item.excludedAt) : items;
  }, [classificationQuery.data?.items, filter]);
  const seleccionados = useMemo(
    () => (classificationQuery.data?.items ?? []).filter((item) => selectedIds.includes(item.id)),
    [classificationQuery.data?.items, selectedIds],
  );
  const seleccionadosActivos = seleccionados.filter((item) => !item.excludedAt);
  const seleccionadosExcluidos = seleccionados.filter((item) => item.excludedAt);
  const sentidos = new Set(seleccionadosActivos.map((item) => item.direction));
  // Ventas asignadas solas por tener una única actividad: se muestran y no cuentan como pendientes.
  const asignadasSolas = useMemo(() => {
    const porActividad = new Map<string, number>();
    for (const item of classificationQuery.data?.items ?? []) {
      if (item.excludedAt || !ORIGENES_AUTOMATICOS.includes(item.origin ?? "")) continue;
      const clave = item.activityCode ?? "";
      porActividad.set(clave, (porActividad.get(clave) ?? 0) + 1);
    }
    return [...porActividad.entries()];
  }, [classificationQuery.data?.items]);
  // Totales al pie (11-1): solo comprobantes incluidos en el cálculo; las notas de crédito restan.
  const totalesVisibles = useMemo(() => {
    const incluidos = visibleClassifications.filter((item) => !item.excludedAt);
    if (incluidos.length === 0) return null;
    return incluidos.reduce(
      (acc, item) => {
        const { neto, iva, total, signo } = importesDe(item);
        return { cantidad: acc.cantidad + 1, neto: acc.neto + signo * neto, iva: acc.iva + signo * iva, total: acc.total + signo * total };
      },
      { cantidad: 0, neto: 0, iva: 0, total: 0 },
    );
  }, [visibleClassifications]);
  const puedeClasificar = canEditClassifications && capabilities.has("tax.vouchers.prepare");

  const clasificarSeleccionados = () => {
    setBulkError(null);
    if (seleccionadosActivos.length === 0) {
      setBulkError("Elegí al menos un comprobante sin excluir");
      return;
    }
    if (sentidos.size > 1) {
      setBulkError("Elegí solo compras o solo ventas: cada grupo lleva su propio rubro o actividad");
      return;
    }
    if (seleccionadosActivos[0]!.direction === "PURCHASE" && !bulkCategory) {
      setBulkError("Seleccioná el rubro de las compras elegidas");
      return;
    }
    if (seleccionadosActivos[0]!.direction === "SALE" && !bulkActivity) {
      setBulkError("Indicá la actividad fiscal de las ventas elegidas");
      return;
    }
    bulkClassifyMutation.mutate(
      { ids: seleccionadosActivos.map((item) => item.id), categoryCode: bulkCategory, activityCode: bulkActivity },
      { onSuccess: () => setSelectedIds([]) },
    );
  };
  const confirmarExclusion = () => {
    if (!motivoExclusion.trim()) {
      setMotivoError("Indicá el motivo de la exclusión");
      return;
    }
    setMotivoError(null);
    excludeMutation.mutate(
      { ids: seleccionadosActivos.map((item) => item.id), reason: motivoExclusion.trim() },
      {
        onSuccess: () => {
          setSelectedIds([]);
          setExcluyendo(false);
          setMotivoExclusion("");
        },
      },
    );
  };
  // Motivo visible junto a la tabla cuando la pantalla no deja clasificar ni imputar (P1).
  const motivoEditarBase = !capabilities.has("tax.vouchers.prepare")
    ? "Tu rol no puede clasificar comprobantes ni imputar retenciones."
    : !canEditSources && !canEditClassifications
      ? "El legajo no admite cambios de fuentes en su estado actual."
      : null;
  // Un solo aviso por pantalla (11-4): con un mes cerrado alcanza el motivo de solo lectura (la barra ya ofrece «Crear rectificativa»).
  const motivoEditar = motivoEditarBase;
  // Antes de responder, el indicador dice «pendiente»; si la consulta falla, «no disponible» (C03).
  const indicador = (valor: number | undefined) =>
    classificationQuery.isSuccess
      ? (valor ?? 0)
      : classificationQuery.isError
        ? "no disponible"
        : "pendiente";

  return (
    <div className="workpaper-stage">
      <div className="workpaper-classification-head">
      <div className="workpaper-classification-summary" role="group" title="Las actividades adheridas determinan la alícuota aplicable. Completá las que falten antes de calcular." aria-label="Ayuda sobre clasificación">
        <span>
          <strong>{indicador(classificationQuery.data?.classified)}</strong>
          <small>Clasificados</small>
        </span>
        <span>
          <strong>
            {indicador(
              classificationQuery.data
                ? classificationQuery.data.pending + (classificationQuery.data.activityPending ?? 0)
                : undefined,
            )}
          </strong>
          <small>Pendientes</small>
        </span>
        <span>
          <strong>{indicador(classificationQuery.data?.excluded)}</strong>
          <small>Excluidos</small>
        </span>
        <span>
          {classificationQuery.isSuccess ? (
            classificationQuery.data.ready && (classificationQuery.data.activityPending ?? 0) === 0 ? (
              <StatusBadge status="READY" label="Listo para calcular" />
            ) : (
              <StatusBadge status="WAITING_INPUTS" label="Faltan clasificar comprobantes" />
            )
          ) : (
            <strong>{classificationQuery.isError ? "no disponible" : "pendiente"}</strong>
          )}
        </span>
      </div>
      <div className="workpaper-classification-topbar">
        <div>
          <SearchSelect
            label="Filtrar comprobantes"
            hideLabel
            value={filter}
            onChange={(value) => setFilter(value)}
            allowEmpty={false}
            options={[{ value: "ALL", label: "Todos" }, { value: "PENDING", label: "Sin clasificar" }, { value: "EXCLUDED", label: "Excluidos" }]}
          />
        </div>
        <div className="workpaper-classification-more">
          <details>
            <summary>Más</summary>
            <div className="workpaper-classification-more__menu">
              {puedeClasificar ? <label><input type="checkbox" checked={rememberRule} onChange={(event) => setRememberRule(event.target.checked)} /> Recordar para este proveedor/cliente</label> : null}
              <Button size="sm" variant="text" onClick={() => setReglasAbiertas(true)}>Reglas recordadas ({rulesQuery.data?.length ?? 0})</Button>
            </div>
          </details>
        </div>
        {puedeClasificar ? <Button size="sm" variant="secondary" disabled={bulkClassifyMutation.isPending || seleccionadosActivos.length === 0} onClick={clasificarSeleccionados}>Clasificar seleccionados ({seleccionadosActivos.length})</Button> : null}
      </div>
      </div>
      {classificationQuery.isError ? (
        <AsyncState
          loading={false}
          error
          errorTitle="No se pudo leer la clasificación"
          errorDescription="Reintentá la lectura. Hasta que responda, la etapa no muestra comprobantes."
          onRetry={() => void classificationQuery.refetch()}
          loadingLabel="Clasificando comprobantes respaldados…"
        />
      ) : !classificationQuery.isSuccess ? (
        <AsyncState
          loading
          error={false}
          errorTitle=""
          errorDescription=""
          onRetry={() => void classificationQuery.refetch()}
          loadingLabel="Clasificando comprobantes respaldados…"
        />
      ) : (
        <>
          {classificationQuery.isFetching ? (
            <small className="muted-copy">Dato del último corte; se está actualizando.</small>
          ) : null}
          {asignadasSolas.length > 0 && !motivoClasificacionBloqueada && !motivoEditar ? (
            <p className="workpaper-classification-auto muted-copy">
              {asignadasSolas
                .map(([actividad, cantidad]) =>
                  actividad
                    ? `${cantidad} ${cantidad === 1 ? "venta asignada" : "ventas asignadas"} a ${actividad} automáticamente`
                    : `${cantidad} ${cantidad === 1 ? "venta asignada" : "ventas asignadas"} automáticamente a la única actividad de cada nivel`,
                )
                .join(" · ")}
              . No cuentan como pendientes.
            </p>
          ) : null}
          {motivoEditar || motivoClasificacionBloqueada ? (
            <p className="workpaper-stage__note">
              {motivoEditar ? <span>{motivoEditar}</span> : null}
              {motivoEditar && motivoClasificacionBloqueada ? " " : null}
              {motivoClasificacionBloqueada ? <span>{motivoClasificacionBloqueada}</span> : null}
            </p>
          ) : null}
          {puedeClasificar && seleccionados.length > 0 ? (
            <div className="workpaper-stage__actions workpaper-classification-toolbar" role="group" aria-label="Acciones sobre los comprobantes seleccionados">
              {seleccionadosActivos.length > 0 && !sentidos.has("SALE") ? (
                <SearchSelect
                  label="Rubro de las compras seleccionadas"
                  hideLabel
                  value={bulkCategory}
                  onChange={(value) => setBulkCategory(value)}
                  placeholder="Rubro…"
                  options={[
                    { value: "SUPER", label: "SUPER · Minimercados" },
                    { value: "TRANSPORTE", label: "TRANSPORTE" },
                  ]}
                />
              ) : null}
              {seleccionadosActivos.length > 0 && !sentidos.has("PURCHASE") ? (
                <SearchSelect
                  label="Actividad de las ventas seleccionadas"
                  hideLabel
                  value={bulkActivity}
                  onChange={(value) => setBulkActivity(value)}
                  placeholder="Elegí la actividad…"
                  options={activityOptions(bulkActivity).map((activity) => ({
                    value: activity.code,
                    label: activity.name ? `${activity.code} · ${activity.name}` : activity.code,
                  }))}
                />
              ) : null}
              {seleccionadosActivos.length > 0 ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setExcluyendo((current) => !current)}
                >
                  Excluir seleccionados
                </Button>
              ) : null}
              {seleccionadosExcluidos.length > 0 ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={includeMutation.isPending}
                  onClick={() =>
                    includeMutation.mutate(
                      { ids: seleccionadosExcluidos.map((item) => item.id) },
                      { onSuccess: () => setSelectedIds([]) },
                    )
                  }
                >
                  Reincluir seleccionados
                </Button>
              ) : null}
              {seleccionados.length > 0 && seleccionadosActivos.length === 0 ? (
                <small className="muted-copy">Los comprobantes excluidos se reincluyen para clasificarlos.</small>
              ) : null}
              {bulkError ? (
                <p className="form-error" role="alert">
                  {bulkError}
                </p>
              ) : null}
              <WorkpaperActionError error={bulkClassifyMutation.error} />
              <WorkpaperActionError error={includeMutation.error} />
            </div>
          ) : null}
          {puedeClasificar && excluyendo && seleccionadosActivos.length > 0 ? (
            <div className="workpaper-stage__actions" role="group" aria-label="Excluir del cálculo">
              <Field
                id="clasificacion-motivo-exclusion"
                label="Motivo de la exclusión"
                value={motivoExclusion}
                maxLength={500}
                placeholder="Por ejemplo: factura duplicada"
                error={motivoError ?? undefined}
                onChange={(event) => {
                  setMotivoExclusion(event.target.value);
                  if (event.target.value.trim()) setMotivoError(null);
                }}
              />
              <Button size="sm" variant="secondary" disabled={excludeMutation.isPending} onClick={confirmarExclusion}>
                Confirmar exclusión
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setExcluyendo(false)}>
                Cancelar
              </Button>
              <WorkpaperActionError error={excludeMutation.error} />
            </div>
          ) : null}
          <Table<WorkpaperClassification>
            className="ds-table workpaper-classification-table"
            rows={visibleClassifications}
            rowKey={(classification) => classification.id}
            empty={
              <EmptyState
                size="inline"
                title="No hay comprobantes de fuentes revisadas para clasificar."
              />
            }
            columns={[
              ...(puedeClasificar
                ? ([
                    {
                  key: "selection",
                  header: "Seleccionar",
                  render: (classification) => (
                    <input
                      type="checkbox"
                      aria-label={`Seleccionar comprobante ${classification.voucher.letter ?? classification.voucher.type} · ${String(classification.voucher.pointOfSale).padStart(4, "0")}-${String(classification.voucher.number).padStart(8, "0")}`}
                      checked={selectedIds.includes(classification.id)}
                      onChange={(event) => setSelectedIds((current) => event.target.checked
                        ? [...new Set([...current, classification.id])]
                        : current.filter((id) => id !== classification.id))}
                    />
                  ),
                },
                  ] satisfies TableColumn<WorkpaperClassification>[])
                : []),
              {
                key: "date",
                header: "Fecha",
                render: (classification) => <span className="workpaper-classification-date">{fechaCorta(classification.voucher.issuedOn)}</span>,
              },
              {
                key: "voucher",
                header: "Comprobante",
                render: (classification) => (
                  <>
                    <strong className="workpaper-classification-voucher-number">{numeroComprobante(classification)}</strong>
                    <br />
                    <small>
                      {classification.direction === "PURCHASE" ? "Compra" : "Venta"} · {formatCuit(classification.counterpartyCuit)}
                    </small>
                    {tipoComprobante(classification) ? (
                      <>
                        <br />
                        <small>{tipoComprobante(classification)}</small>
                      </>
                    ) : null}
                    {classification.direction === "PURCHASE" && classification.ivaCredit === false ? (
                      <>
                        <br />
                        <StatusBadge status="INFO" label="Sin crédito de IVA" />
                      </>
                    ) : null}
                    {classification.excludedAt ? (
                      <>
                        <br />
                        <StatusBadge status="WAIVED" label="Excluido" />
                        <br />
                        <small>
                          {classification.excludedBy?.name ?? "Usuario"} ·{" "}
                          {fechaCorta(classification.excludedAt)} · {classification.excludedReason}
                        </small>
                      </>
                    ) : null}
                  </>
                ),
              },
              {
                key: "net",
                header: "Neto",
                align: "right",
                render: (classification) => formatMoney(String(importesDe(classification).neto)),
              },
              {
                key: "iva",
                header: "IVA",
                align: "right",
                render: (classification) => formatMoney(String(importesDe(classification).iva)),
              },
              {
                key: "total",
                header: "Total",
                align: "right",
                render: (classification) => <strong>{formatMoney(String(importesDe(classification).total))}</strong>,
              },
              {
                key: "classification",
                header: "Rubro / actividad",
                render: (classification) => {
                  const draft = classificationDrafts[classification.id] ?? {
                    categoryCode: classification.categoryCode ?? "",
                    activityCode: classification.activityCode ?? "",
                  };
                  if (classification.excludedAt) {
                    return <small>Fuera del cálculo</small>;
                  }
                  // Mismo texto que el cálculo: el mensaje dice a qué actividad reclasificar; la venta se reclasifica aquí.
                  const aviso = classification.activityIssue ? (
                    <div className="workpaper-classification-issue">
                      <small>{classification.activityIssue.message}</small>{" "}
                      {puedeClasificar ? (
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => document.getElementById(`actividad-${classification.id}`)?.focus()}
                        >
                          Reclasificar
                        </button>
                      ) : null}
                    </div>
                  ) : null;
                  return (
                    <>
                      {aviso}
                      {(() => {
                        const activity = activityOptions(draft.activityCode).find((item) => item.code === draft.activityCode);
                        const automatic = ORIGENES_AUTOMATICOS.includes(classification.origin ?? "") && draft.activityCode === (classification.activityCode ?? "");
                        const automaticLevels = automatic
                          ? activityOptions(draft.activityCode).filter((item) => item.level)
                          : [];
                        const manual = classification.origin === "MANUAL" || (ORIGENES_AUTOMATICOS.includes(classification.origin ?? "") && !automatic);
                        const fullActivity = automaticLevels.length
                          ? automaticLevels.map((item) => [item.level, item.code, item.name].filter(Boolean).join(" · ")).join(" · ")
                          : activity
                            ? [activity.level, activity.code, activity.name].filter(Boolean).join(" · ")
                            : classification.activityCode ?? "Actividad no informada";
                        // Nombre de la actividad (el código y el nivel quedan en el tooltip).
                        const nombreActividad =
                          (automaticLevels.length ? automaticLevels[0]?.name : activity?.name) ||
                          draft.activityCode ||
                          "Sin actividad";
                        const selector = (
                          <SearchSelect
                            id={`actividad-${classification.id}`}
                            label="Actividad"
                            hideLabel
                            value={draft.activityCode}
                            onChange={(value) => {
                              setClassificationDrafts((current) => ({
                                ...current,
                                [classification.id]: { ...draft, activityCode: value },
                              }));
                              setEditingActivityId(null);
                            }}
                            placeholder="Buscar actividad…"
                            options={activityOptions(draft.activityCode).map((item) => ({
                              value: item.code,
                              label: item.name ? `${item.code} · ${item.name}` : item.code,
                            }))}
                          />
                        );
                        return (
                          puedeClasificar && editingActivityId === classification.id ? (
                            <>
                              {classification.direction === "PURCHASE" ? (
                                <SearchSelect
                                  label="Rubro del proveedor"
                                  hideLabel
                                  value={draft.categoryCode}
                                  onChange={(value) => setClassificationDrafts((current) => ({
                                    ...current,
                                    [classification.id]: { ...draft, categoryCode: value },
                                  }))}
                                  placeholder="Rubro…"
                                  options={[{ value: "SUPER", label: "SUPER · Minimercados" }, { value: "TRANSPORTE", label: "TRANSPORTE" }]}
                                />
                              ) : null}
                              {selector}
                            </>
                          ) : (
                            <div className="workpaper-classification-inline" title={fullActivity}>
                              <span className="workpaper-classification-code">
                                {classification.categoryCode ? `${classification.categoryCode} · ` : ""}{nombreActividad}
                              </span>
                              {classification.origin === "RULE" ? <StatusBadge status="INFO" label="Por regla" /> : null}
                              {(automatic || manual) ? (
                                <small className="workpaper-classification-chip">{automatic ? "auto" : "manual"}</small>
                              ) : null}
                              {puedeClasificar ? (
                                <button type="button" className="link-button" onClick={() => setEditingActivityId(classification.id)}>Cambiar</button>
                              ) : null}
                            </div>
                          )
                        );
                      })()}
                    </>
                  );
                },
              },
              {
                key: "state",
                header: "Estado",
                render: (classification) =>
                  classification.excludedAt ? (
                    puedeClasificar ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={includeMutation.isPending}
                          aria-label={`Reincluir el comprobante ${numeroComprobante(classification)}`}
                          onClick={() => includeMutation.mutate({ ids: [classification.id] })}
                        >
                          Reincluir
                        </Button>
                        <WorkpaperActionError
                          error={
                            includeMutation.variables?.ids.includes(classification.id)
                              ? includeMutation.error
                              : null
                          }
                        />
                      </>
                    ) : (
                      <StatusBadge status="WAIVED" label="Excluido" />
                    )
                  ) : classification.status === "CLASSIFIED" ? (
                    puedeClasificar ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={classifyVoucherMutation.isPending}
                          aria-label={`Actualizar clasificación del comprobante ${classification.voucher.letter ?? classification.voucher.type} ${String(classification.voucher.pointOfSale).padStart(4, "0")}-${String(classification.voucher.number).padStart(8, "0")}`}
                          onClick={() => classifyVoucherMutation.mutate(classification)}
                        >
                          Actualizar
                        </Button>
                        <WorkpaperActionError
                          error={
                            classifyVoucherMutation.variables?.id === classification.id
                              ? classifyVoucherMutation.error
                              : null
                          }
                        />
                      </>
                    ) : (
                      <StatusBadge status="READY" />
                    )
                  ) : puedeClasificar ? (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={classifyVoucherMutation.isPending}
                        onClick={() => classifyVoucherMutation.mutate(classification)}
                      >
                        Guardar
                      </Button>
                      <WorkpaperActionError
                        error={
                          classifyVoucherMutation.variables?.id === classification.id
                            ? classifyVoucherMutation.error
                            : null
                        }
                      />
                    </>
                  ) : (
                    <StatusBadge status="WAITING_INPUTS" />
                  ),
              },
            ]}
          />
          {totalesVisibles ? (
            <p className="workpaper-classification-totals" aria-label="Totales de los comprobantes incluidos">
              <span>Total de {totalesVisibles.cantidad} {totalesVisibles.cantidad === 1 ? "comprobante" : "comprobantes"}</span>
              <span>Neto <strong>{formatMoney(String(totalesVisibles.neto))}</strong></span>
              <span>IVA <strong>{formatMoney(String(totalesVisibles.iva))}</strong></span>
              <span>Total <strong>{formatMoney(String(totalesVisibles.total))}</strong></span>
            </p>
          ) : null}
          {(classificationQuery.data.pending + (classificationQuery.data.activityPending ?? 0)) > 0 ? (
            <p className="workpaper-classification-auto muted-copy">El cálculo queda bloqueado mientras haya comprobantes sin rubro o actividad. Clasificalos o excluilos para continuar.</p>
          ) : null}
          <ObjectPanel
            kind="documento"
            isOpen={reglasAbiertas}
            onClose={() => setReglasAbiertas(false)}
            title={`Reglas recordadas (${rulesQuery.data?.length ?? 0})`}
            description="Las reglas se aplican a comprobantes nuevos del mismo proveedor o cliente."
          >
          {rulesQuery.isError ? (
            <AsyncState
              loading={false}
              error
              errorTitle="No se pudieron leer las reglas"
              errorDescription="Reintentá la lectura. Hasta que responda, la etapa no muestra reglas."
              onRetry={() => void rulesQuery.refetch()}
              loadingLabel="Leyendo reglas…"
            />
          ) : (
            <Table<ClassificationRule>
              rows={rulesQuery.data ?? []}
              rowKey={(rule) => rule.id}
              empty={
                <EmptyState
                  size="inline"
                  title="Todavía no hay reglas. Marcá «Recordar para este proveedor/cliente» al clasificar."
                />
              }
              columns={[
                {
                  key: "counterparty",
                  header: "Proveedor / cliente",
                  render: (rule) => (
                    <>
                      <strong>{rule.counterpartyCuit}</strong>
                      <br />
                      <small>{rule.direction === "PURCHASE" ? "Compras" : "Ventas"}</small>
                    </>
                  ),
                },
                {
                  key: "target",
                  header: "Rubro / actividad",
                  render: (rule) => (
                    <>
                      <strong>{rule.categoryCode ?? rule.activityCode}</strong>
                      {rule.categoryCode && rule.activityCode ? <small> · {rule.activityCode}</small> : null}
                    </>
                  ),
                },
                {
                  key: "createdBy",
                  header: "Creada por",
                  render: (rule) => (
                    <>
                      {rule.createdByName}
                      <br />
                      <small>{fechaCorta(rule.createdAt)}</small>
                    </>
                  ),
                },
                {
                  key: "delete",
                  header: "Acciones",
                  render: (rule) =>
                    capabilities.has("tax.vouchers.prepare") ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={deleteRuleMutation.isPending}
                          aria-label={`Borrar la regla de ${rule.counterpartyCuit}`}
                          onClick={() => deleteRuleMutation.mutate(rule)}
                        >
                          Borrar
                        </Button>
                        <WorkpaperActionError
                          error={
                            deleteRuleMutation.variables?.id === rule.id ? deleteRuleMutation.error : null
                          }
                        />
                      </>
                    ) : null,
                },
              ]}
            />
          )}
          </ObjectPanel>
        </>
      )}
      <div className="workpaper-stage__heading workpaper-stage__heading--subsection">
        <div>
          <strong>Retenciones y percepciones</strong>
          {allocationQuery.isSuccess && !allocationQuery.data.ready ? (
            <small>
              Cada certificado queda asignado a una obligación, jurisdicción y período concretos antes
              de entrar al motor.
            </small>
          ) : null}
        </div>
        <span className="workpaper-stage__actions">
          {allocationQuery.isSuccess ? (
            <StatusBadge status={allocationQuery.data.ready ? "READY" : "WAITING_INPUTS"} />
          ) : (
            <strong>{allocationQuery.isError ? "no disponible" : "pendiente"}</strong>
          )}
        </span>
      </div>
      {allocationQuery.isError ? (
        <AsyncState
          loading={false}
          error
          errorTitle="No se pudieron leer las imputaciones"
          errorDescription="Reintentá la lectura. Hasta que responda, la etapa no muestra certificados."
          onRetry={() => void allocationQuery.refetch()}
          loadingLabel="Imputando certificados revisados…"
        />
      ) : !allocationQuery.isSuccess ? (
        <AsyncState
          loading
          error={false}
          errorTitle=""
          errorDescription=""
          onRetry={() => void allocationQuery.refetch()}
          loadingLabel="Imputando certificados revisados…"
        />
      ) : (
        <>
          {allocationQuery.isFetching ? (
            <small className="muted-copy">Dato del último corte; se está actualizando.</small>
          ) : null}
          <Table<WorkpaperAllocation>
            rows={allocationQuery.data?.items ?? []}
            rowKey={(allocation) => allocation.id}
            empty={
              <EmptyState
                size="inline"
                title="No hay retenciones o percepciones revisadas para imputar."
              />
            }
            columns={[
              {
                key: "certificate",
                header: "Certificado",
                render: (allocation) => (
                  <>
                    <strong>
                      {allocation.sourceType === "WITHHOLDING" ? "Retención" : "Percepción"}
                    </strong>
                    <br />
                    <small>
                      {allocation.certificate?.certificateNumber ?? "Sin número"} ·{" "}
                      {allocation.certificate?.cuitAgent ?? "Sin agente"}
                    </small>
                  </>
                ),
              },
              {
                key: "obligation",
                header: "Obligación",
                render: (allocation) => (
                  <>
                    <strong>
                      {allocation.obligation?.regime.taxType.name ?? "Impuesto"}
                      {allocation.obligation && !allocation.obligation.regime.taxType.isActive
                        ? " (oculto)"
                        : ""}
                    </strong>
                    {/* El régimen se muestra solo si agrega algo al nombre del impuesto (11-7). */}
                    {allocation.obligation && !nombreRedundante(allocation.obligation.regime.name, allocation.obligation.regime.taxType.name) ? (
                      <>
                        <br />
                        <small>
                          {allocation.obligation.regime.name}
                          {!allocation.obligation.regime.isActive ? " (oculto)" : ""}
                        </small>
                      </>
                    ) : null}
                  </>
                ),
              },
              {
                key: "jurisdiction",
                header: "Jurisdicción imputada",
                render: (allocation) =>
                  canEditSources && capabilities.has("tax.vouchers.prepare") ? (
                    <SearchSelect
                      className="workpaper-allocation-select"
                      label="Jurisdicción de la imputación"
                      hideLabel
                      value={allocationDrafts[allocation.id] ?? allocation.allocatedJurisdiction?.code ?? ""}
                      onChange={(value) =>
                        setAllocationDrafts((current) => ({
                          ...current,
                          [allocation.id]: value,
                        }))
                      }
                      placeholder="Jurisdicción…"
                      options={[
                        ...(jurisdictionsQuery.data ?? []).filter((jurisdiction) => jurisdiction.isActive),
                        ...(allocation.allocatedJurisdiction && !allocation.allocatedJurisdiction.isActive
                          ? [allocation.allocatedJurisdiction]
                          : []),
                      ].map((jurisdiction) => ({
                        value: jurisdiction.code,
                        label: `${jurisdiction.code} · ${jurisdiction.name}${!jurisdiction.isActive ? " (oculto)" : ""}`,
                        disabled: !jurisdiction.isActive,
                      }))}
                    />
                  ) : allocation.allocatedJurisdiction ? (
                    `${allocation.allocatedJurisdiction.name}${
                      !allocation.allocatedJurisdiction.isActive ? " (oculto)" : ""
                    }`
                  ) : (
                    "Sin jurisdicción"
                  ),
              },
              {
                key: "amount",
                header: "Importe",
                align: "right",
                render: (allocation) => <strong>{formatMoney(allocation.amount)}</strong>,
              },
              {
                key: "state",
                header: "Estado",
                render: (allocation) =>
                  canEditSources && capabilities.has("tax.vouchers.prepare") ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={reallocateInputMutation.isPending}
                        onClick={() => reallocateInputMutation.mutate(allocation)}
                      >
                        Reimputar
                      </Button>
                      <WorkpaperActionError
                        error={
                          reallocateInputMutation.variables?.id === allocation.id
                            ? reallocateInputMutation.error
                            : null
                        }
                      />
                    </>
                  ) : (
                    <StatusBadge status="READY" />
                  ),
              },
            ]}
          />
        </>
      )}
    </div>
  );
}
