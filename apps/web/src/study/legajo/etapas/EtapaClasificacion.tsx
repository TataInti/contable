// Etapa Clasificación e imputación del Legajo: clasificación de comprobantes e imputación de retenciones y percepciones (Foco 2.3c).
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { AsyncState, Button, EmptyState, Field, Table, type TableColumn } from "@contable/design-system";
import { Link } from "react-router-dom";
import { StatusBadge } from "../../../ui/StatusBadge";
import { CLASSIFICATION_ORIGIN_LABELS } from "../etiquetas";
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
  activityOptions: (currentCode: string) => Array<{ code: string; name: string }>;
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

const fechaCorta = (value: string) => new Date(value).toLocaleDateString("es-AR", { timeZone: "UTC" });

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
  const motivoEditar = !capabilities.has("tax.vouchers.prepare")
    ? "Tu rol no puede clasificar comprobantes ni imputar retenciones."
    : !canEditSources && !canEditClassifications
      ? "El legajo no admite cambios de fuentes en su estado actual."
      : null;
  // Antes de responder, el indicador dice «pendiente»; si la consulta falla, «no disponible» (C03).
  const indicador = (valor: number | undefined) =>
    classificationQuery.isSuccess
      ? (valor ?? 0)
      : classificationQuery.isError
        ? "no disponible"
        : "pendiente";

  return (
    <div className="workpaper-stage">
      <p className="muted-copy">
        Las actividades adheridas determinan la alícuota aplicable. Completá las que falten antes de
        calcular.
        {motivoEditar ? ` ${motivoEditar}` : null}
      </p>
      <div className="workpaper-classification-summary">
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
            <StatusBadge
              status={
                classificationQuery.data.ready && (classificationQuery.data.activityPending ?? 0) === 0
                  ? "READY"
                  : "WAITING_INPUTS"
              }
            />
          ) : (
            <strong>{classificationQuery.isError ? "no disponible" : "pendiente"}</strong>
          )}
          <small>Listo para calcular</small>
        </span>
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
          {asignadasSolas.length > 0 ? (
            <p className="workpaper-stage__note">
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
          {motivoClasificacionBloqueada ? (
            <p className="workpaper-stage__note">{motivoClasificacionBloqueada}</p>
          ) : null}
          <div className="workpaper-stage__actions">
            <label>
              Filtrar comprobantes
              <select aria-label="Filtrar comprobantes" value={filter} onChange={(event) => setFilter(event.target.value)}>
                <option value="ALL">Todos</option>
                <option value="PENDING">Sin clasificar</option>
                <option value="EXCLUDED">Excluidos</option>
              </select>
            </label>
            {puedeClasificar ? (
              <label>
                <input
                  type="checkbox"
                  checked={rememberRule}
                  onChange={(event) => setRememberRule(event.target.checked)}
                />{" "}
                Recordar para este proveedor/cliente
              </label>
            ) : null}
          </div>
          {puedeClasificar ? (
            <div className="workpaper-stage__actions" role="group" aria-label="Acciones sobre los comprobantes seleccionados">
              <strong>
                {seleccionados.length} {seleccionados.length === 1 ? "seleccionado" : "seleccionados"}
              </strong>
              {seleccionadosActivos.length > 0 && !sentidos.has("SALE") ? (
                <select
                  aria-label="Rubro de las compras seleccionadas"
                  value={bulkCategory}
                  onChange={(event) => setBulkCategory(event.target.value)}
                >
                  <option value="">Rubro…</option>
                  <option value="SUPER">SUPER · Minimercados</option>
                  <option value="TRANSPORTE">TRANSPORTE</option>
                </select>
              ) : null}
              {seleccionadosActivos.length > 0 && !sentidos.has("PURCHASE") ? (
                <select
                  aria-label="Actividad de las ventas seleccionadas"
                  value={bulkActivity}
                  onChange={(event) => setBulkActivity(event.target.value)}
                >
                  <option value="">Elegí la actividad…</option>
                  {activityOptions(bulkActivity).map((activity) => (
                    <option key={activity.code} value={activity.code}>
                      {activity.name ? `${activity.code} · ${activity.name}` : activity.code}
                    </option>
                  ))}
                </select>
              ) : null}
              <Button
                size="sm"
                variant="secondary"
                disabled={bulkClassifyMutation.isPending}
                onClick={clasificarSeleccionados}
              >
                Clasificar seleccionados
              </Button>
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
                key: "voucher",
                header: "Comprobante",
                render: (classification) => (
                  <>
                    <strong>
                      {classification.voucher.letter ?? classification.voucher.type} ·{" "}
                      {String(classification.voucher.pointOfSale).padStart(4, "0")}-
                      {String(classification.voucher.number).padStart(8, "0")}
                    </strong>
                    <br />
                    <small>
                      {classification.direction === "PURCHASE" ? "Compra" : "Venta"} ·{" "}
                      {classification.counterpartyCuit}
                    </small>
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
                key: "treatment",
                header: "Tratamiento",
                render: (classification) => (
                  <>
                    {classification.documentKind === "CREDIT_NOTE"
                      ? "Nota de crédito (resta)"
                      : classification.documentKind === "DEBIT_NOTE"
                        ? "Nota de débito"
                        : "Factura"}
                    <br />
                    <small>
                      {classification.rateBuckets.length > 0
                        ? classification.rateBuckets
                            .map((bucket) => `${bucket.rate}%: ${formatMoney(bucket.amount)}`)
                            .join(" · ")
                        : "Sin componentes por alícuota"}
                    </small>
                  </>
                ),
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
                  // Mismo texto que el cálculo; «Desde» se corrige en Configuración fiscal y la venta se reclasifica aquí.
                  const aviso = classification.activityIssue ? (
                    <div className="workpaper-classification-issue">
                      <small>{classification.activityIssue.message}</small>{" "}
                      {classification.activityIssue.kind === "NOT_IN_FORCE" ? (
                        <Link to="/configuracion-fiscal">Corregir la fecha «Desde»</Link>
                      ) : puedeClasificar ? (
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
                      {!puedeClasificar ? (
                    <>
                      <strong>{classification.categoryCode ?? classification.activityCode}</strong>
                      {classification.categoryCode && classification.activityCode ? (
                        <small> · {classification.activityCode}</small>
                      ) : null}
                      <br />
                      <small>
                        {CLASSIFICATION_ORIGIN_LABELS[classification.origin ?? ""] ??
                          "Clasificación guardada"}
                      </small>
                    </>
                  ) : (
                    <div className="workpaper-classification-fields">
                      {classification.origin === "RULE" ? (
                        <StatusBadge status="INFO" label="Por regla" />
                      ) : null}
                      {classification.direction === "PURCHASE" ? (
                        <select
                          aria-label="Rubro del proveedor"
                          value={draft.categoryCode}
                          onChange={(event) =>
                            setClassificationDrafts((current) => ({
                              ...current,
                              [classification.id]: {
                                ...draft,
                                categoryCode: event.target.value,
                              },
                            }))
                          }
                        >
                          <option value="">Rubro…</option>
                          <option value="SUPER">SUPER · Minimercados</option>
                          <option value="TRANSPORTE">TRANSPORTE</option>
                        </select>
                      ) : null}
                      <select
                        id={`actividad-${classification.id}`}
                        aria-label="Actividad"
                        value={draft.activityCode}
                        onChange={(event) =>
                          setClassificationDrafts((current) => ({
                            ...current,
                            [classification.id]: {
                              ...draft,
                              activityCode: event.target.value,
                            },
                          }))
                        }
                      >
                        <option value="">
                          {classification.direction === "SALE"
                            ? "Elegí la actividad…"
                            : "Sin actividad (opcional)"}
                        </option>
                        {activityOptions(draft.activityCode).map((activity) => (
                          <option key={activity.code} value={activity.code}>
                            {activity.name ? `${activity.code} · ${activity.name}` : activity.code}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
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
          <p className="workpaper-stage__note">
            El cálculo queda bloqueado mientras exista una compra sin rubro o una venta sin
            actividad. El rubro manual se guarda en el maestro del proveedor para los próximos
            períodos. Los comprobantes excluidos quedan fuera del cálculo hasta que los reincluyas.
          </p>
          <div className="workpaper-stage__heading workpaper-stage__heading--subsection">
            <div>
              <strong>Reglas recordadas</strong>
              <small>
                Cada regla clasifica sola los comprobantes nuevos de un mismo proveedor o cliente; los
                ya clasificados no cambian.
              </small>
            </div>
          </div>
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
        </>
      )}
      <div className="workpaper-stage__heading workpaper-stage__heading--subsection">
        <div>
          <strong>Imputación de retenciones y percepciones</strong>
          <small>
            Cada certificado queda asignado a una obligación, jurisdicción y período concretos antes
            de entrar al motor.
          </small>
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
                    <br />
                    <small>
                      {allocation.obligation?.regime.name}
                      {allocation.obligation && !allocation.obligation.regime.isActive
                        ? " (oculto)"
                        : ""}
                    </small>
                  </>
                ),
              },
              {
                key: "jurisdiction",
                header: "Jurisdicción imputada",
                render: (allocation) =>
                  canEditSources && capabilities.has("tax.vouchers.prepare") ? (
                    <select
                      className="workpaper-allocation-select"
                      aria-label="Jurisdicción de la imputación"
                      value={
                        allocationDrafts[allocation.id] ??
                        allocation.allocatedJurisdiction?.code ??
                        ""
                      }
                      onChange={(event) =>
                        setAllocationDrafts((current) => ({
                          ...current,
                          [allocation.id]: event.target.value,
                        }))
                      }
                    >
                      <option value="">Jurisdicción…</option>
                      {[
                        ...(jurisdictionsQuery.data ?? []).filter(
                          (jurisdiction) => jurisdiction.isActive,
                        ),
                        ...(allocation.allocatedJurisdiction &&
                        !allocation.allocatedJurisdiction.isActive
                          ? [allocation.allocatedJurisdiction]
                          : []),
                      ].map((jurisdiction) => (
                        <option
                          key={jurisdiction.id}
                          value={jurisdiction.code}
                          disabled={!jurisdiction.isActive}
                        >
                          {jurisdiction.code} · {jurisdiction.name}
                          {!jurisdiction.isActive ? " (oculto)" : ""}
                        </option>
                      ))}
                    </select>
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
