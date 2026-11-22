// Etapa Clasificación e imputación del Legajo: clasificación de comprobantes e imputación de retenciones y percepciones (Foco 2.3c).
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { AsyncState, Button, EmptyState, Table } from "@contable/design-system";
import { StatusBadge } from "../../../ui/StatusBadge";
import { CLASSIFICATION_ORIGIN_LABELS } from "../etiquetas";
import { formatMoney } from "../formato";
import type {
  AllocationCoverage,
  ClassificationCoverage,
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
}

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
}: EtapaClasificacionProps) {
  const [filter, setFilter] = useState("ALL");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const visibleClassifications = useMemo(() => {
    const items = classificationQuery.data?.items ?? [];
    return filter === "PENDING" ? items.filter((item) => item.status !== "CLASSIFIED") : items;
  }, [classificationQuery.data?.items, filter]);
  // Motivo visible junto a la tabla cuando la pantalla no deja clasificar ni imputar (P1).
  const motivoEditar = !capabilities.has("tax.vouchers.prepare")
    ? "Tu rol no puede clasificar comprobantes ni imputar retenciones."
    : !canEditSources
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
          <strong>{indicador(classificationQuery.data?.pending)}</strong>
          <small>Pendientes</small>
        </span>
        <span>
          {classificationQuery.isSuccess ? (
            <StatusBadge status={classificationQuery.data.ready ? "READY" : "WAITING_INPUTS"} />
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
          <div className="workpaper-stage__actions">
            <label>
              Filtrar comprobantes
              <select aria-label="Filtrar comprobantes" value={filter} onChange={(event) => setFilter(event.target.value)}>
                <option value="ALL">Todos</option>
                <option value="PENDING">Sin clasificar</option>
              </select>
            </label>
            <Button
              size="sm"
              variant="secondary"
              disabled={!canEditSources || !capabilities.has("tax.vouchers.prepare") || selectedIds.length === 0 || classifyVoucherMutation.isPending}
              onClick={() => {
                const selected = classificationQuery.data?.items.filter((item) => selectedIds.includes(item.id)) ?? [];
                selected.forEach((item) => classifyVoucherMutation.mutate(item));
              }}
            >
              Clasificar seleccionados
            </Button>
          </div>
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
                  return !canEditSources || !capabilities.has("tax.vouchers.prepare") ? (
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
                  );
                },
              },
              {
                key: "state",
                header: "Estado",
                render: (classification) =>
                  classification.status === "CLASSIFIED" ? (
                    canEditSources && capabilities.has("tax.vouchers.prepare") ? (
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
                  ) : canEditSources && capabilities.has("tax.vouchers.prepare") ? (
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
            períodos.
          </p>
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
