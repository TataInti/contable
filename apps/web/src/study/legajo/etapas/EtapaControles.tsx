// Etapa Controles del Legajo: hallazgos, resolución y evidencia por control (Foco 2.3d).
import { useState, type Dispatch, type SetStateAction } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { AsyncState, Button, EmptyState, getStatusBadgeMeta, ObjectPanel, WorkQueue, WorkQueueRow, SearchSelect } from "@contable/design-system";
import { CONTROL_LABELS, CONTROL_SEVERITY_LABELS } from "../etiquetas";
import { formatMoney } from "../formato";
import type { EvidenceDocument, Workpaper, WorkpaperClassification } from "../tipos";
import { WorkpaperActionError } from "../WorkpaperActionError";
import type { GrupoPerfilVariables } from "./GrupoPerfilControl";
import { PREFIJO_CONTROL_PERFIL, GRUPO_LABELS } from "../../fiscal/comprobantesPermitidos";
import { SalidaConfiguracionFiscal } from "../../resumen/Piezas";

export interface ResolverControlVariables {
  workpaperId: string;
  findingId: string;
  status: "RESOLVED" | "WAIVED";
  evidenceDocumentId?: string;
}

/** Pedido de confirmación que arma la pantalla (ConfirmDialog, C09). */
export interface SolicitudConfirmacion {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}

export interface EtapaControlesProps {
  capabilities: ReadonlySet<string>;
  wp: Workpaper;
  controlResolutions: Record<string, string>;
  setControlResolutions: Dispatch<SetStateAction<Record<string, string>>>;
  controlEvidence: Record<string, string>;
  setControlEvidence: Dispatch<SetStateAction<Record<string, string>>>;
  documentsQuery: UseQueryResult<EvidenceDocument[], Error>;
  affectedVouchers?: WorkpaperClassification[];
  onGoToClassification?: () => void;
  resolveControlMutation: UseMutationResult<unknown, Error, ResolverControlVariables>;
  /** Excluir o aceptar un grupo «no corresponde al perfil» (corte 4B). */
  grupoPerfilMutation?: UseMutationResult<unknown, Error, GrupoPerfilVariables>;
  confirmar: (solicitud: SolicitudConfirmacion) => void;
}

const CARGA_DOCUMENTOS = "Cargando documentos de respaldo…";

export function EtapaControles({ capabilities, wp, controlResolutions, setControlResolutions, controlEvidence, setControlEvidence, documentsQuery, affectedVouchers = [], onGoToClassification, resolveControlMutation, grupoPerfilMutation, confirmar }: EtapaControlesProps) {
  const [params, setParams] = useSearchParams();
  const [showResolved, setShowResolved] = useState(false);
  const [motivosGrupo, setMotivosGrupo] = useState<Record<string, string>>({});
  const [accionGrupo, setAccionGrupo] = useState<"accept" | "exclude" | null>(null);
  const selectedId = params.get("panel")?.startsWith("control-") ? params.get("panel")!.slice(8) : null;
  const selected = wp.controls.find((item) => item.id === selectedId) ?? null;
  const puedeResolver = capabilities.has("tax.settlements.review");
  const eligibleEvidenceDocuments = (documentsQuery.data ?? []).filter((document) => ["READY", "APPLIED", "REVIEWED"].includes(document.status));
  const open = wp.controls.filter((item) => item.status === "OPEN");
  const resolved = wp.controls.filter((item) => item.status !== "OPEN");
  const labelFor = (control: Workpaper["controls"][number]) => control.code.startsWith(PREFIJO_CONTROL_PERFIL)
    ? `${GRUPO_LABELS[control.code.slice(PREFIJO_CONTROL_PERFIL.length)] ?? control.code}: ${Number(control.actual ?? 0)} comprobantes`
    : CONTROL_LABELS[control.code] ?? control.message ?? control.code;
  const openPanel = (id: string) => { setAccionGrupo(null); setParams((current) => { current.set("panel", `control-${id}`); return current; }, { replace: true }); };
  const closePanel = () => { setAccionGrupo(null); setParams((current) => { current.delete("panel"); return current; }, { replace: true }); };
  const count = (control: Workpaper["controls"][number]) => control.code.startsWith(PREFIJO_CONTROL_PERFIL) ? Number(control.actual ?? 0) : null;
  const nombre = selected ? labelFor(selected) : "";
  const grupo = selected?.code.startsWith(PREFIJO_CONTROL_PERFIL) ? selected.code.slice(PREFIJO_CONTROL_PERFIL.length) : null;
  const controlVouchers = grupo ? affectedVouchers.filter((item) => {
    const letter = item.voucher.letter;
    if (!letter) return grupo === "TIPO_NO_RECONOCIDO";
    const note = item.documentKind !== "INVOICE";
    return grupo === `${note ? "NOTAS" : "FACTURA"}_${letter}`;
  }) : [];
  const motivoId = `${selected?.id ?? "control"}-motivo`;
  const motivoHelpId = `${motivoId}-help`;
  const motivo = selected ? (grupo ? motivosGrupo[selected.id] ?? "" : controlResolutions[selected.id] ?? "") : "";
  const selectReason = (value: string) => selected && setMotivosGrupo((prev) => ({ ...prev, [selected.id]: value }));
  const actionGroup = (action: "accept" | "exclude") => {
    if (!selected || !grupo || !grupoPerfilMutation || !motivo.trim()) return;
    grupoPerfilMutation.mutate({ workpaperId: wp.id, grupo, accion: action, reason: motivo.trim() }, { onSuccess: closePanel });
  };
  const primary = selected?.status === "OPEN" && puedeResolver && !grupo ? (
    <Button variant="primary" disabled={!motivo.trim()} loading={resolveControlMutation.isPending} onClick={() => resolveControlMutation.mutate({ workpaperId: wp.id, findingId: selected.id, status: "RESOLVED", ...(controlEvidence[selected.id] ? { evidenceDocumentId: controlEvidence[selected.id] } : {}) }, { onSuccess: closePanel })}>Resolver</Button>
  ) : undefined;
  const pideRespaldo = puedeResolver && open.some((control) => control.severity === "BLOCKING");
  return <div className="workpaper-controls">
    {pideRespaldo && documentsQuery.isError ? <AsyncState loading={false} error errorTitle="No se pudieron leer los documentos de respaldo" errorDescription="Reintentá la lectura. Mientras tanto, el control puede resolverse sin respaldo." onRetry={() => void documentsQuery.refetch()} loadingLabel={CARGA_DOCUMENTOS} /> : null}
    {pideRespaldo && !documentsQuery.isError && !documentsQuery.isSuccess ? <AsyncState loading error={false} errorTitle="" errorDescription="" onRetry={() => void documentsQuery.refetch()} loadingLabel={CARGA_DOCUMENTOS} /> : null}
    <WorkQueue label={showResolved ? "Controles resueltos" : "Controles abiertos"} empty={<EmptyState size="inline" title={showResolved ? "Todavía no hay controles resueltos." : "No hay controles abiertos para este legajo."} />}>
      {(showResolved ? resolved : open).map((control) => <WorkQueueRow key={control.id} id={control.id} title={labelFor(control)} decision={control.status === "OPEN" ? "Revisar decisión pendiente" : control.resolution ?? "Decisión registrada"} status={control.status} amount={!control.code.startsWith(PREFIJO_CONTROL_PERFIL) && (control.expected ?? control.actual) ? formatMoney(control.expected ?? control.actual!) : undefined} onOpen={() => openPanel(control.id)} actionLabel="Abrir" />)}
    </WorkQueue>
    <Button variant="text" onClick={() => setShowResolved((value) => !value)}>{showResolved ? `Abiertos (${open.length})` : `Resueltos (${resolved.length})`}</Button>
    <ObjectPanel kind="control" isOpen={Boolean(selected)} onClose={closePanel} title={nombre} description={selected ? `Estado: ${getStatusBadgeMeta(selected.status).label}` : undefined} primaryAction={primary} primaryHint={primary && !motivo.trim() ? "Escribí el motivo o cómo se resolvió." : null} returnFocusTo={selected ? Array.from(document.querySelectorAll<HTMLElement>("[data-row-key]")).find((row) => row.dataset.rowKey === selected.id)?.querySelector("button") : null}>
      {selected ? <>
        <h3>Comprobantes afectados</h3>
        {grupo ? controlVouchers.length ? <ul className="workpaper-control__affected" aria-label="Comprobantes afectados">{controlVouchers.map((item) => <li key={item.id}><strong>{item.voucher.letter ?? item.voucher.type} · {String(item.voucher.pointOfSale).padStart(4, "0")}-{String(item.voucher.number).padStart(8, "0")}</strong><span>{new Date(item.voucher.issuedOn).toLocaleDateString("es-AR", { timeZone: "UTC" })} · {formatMoney(item.voucher.total)}</span><Button variant="link" onClick={() => { closePanel(); onGoToClassification?.(); }}>Abrir en Clasificación</Button></li>)}</ul> : <p>{count(selected)} comprobantes afectados; el detalle no está disponible.</p> : <p>{selected.actual ? `Importe observado: ${formatMoney(selected.actual)}.` : "No hay comprobantes asociados en los datos del control."}</p>}
        {selected.message ? <p>{selected.message}</p> : null}
        <p>{selected.severity === "BLOCKING" ? "Bloquea el cierre" : (CONTROL_SEVERITY_LABELS[selected.severity] ?? selected.severity)}</p>
        {selected.status === "OPEN" && !puedeResolver ? <p role="status">Tu perfil no puede resolver controles de este legajo.</p> : null}
        {selected.expected !== null ? <p>Esperado: {formatMoney(selected.expected)}{selected.actual !== null ? ` · Actual: ${formatMoney(selected.actual)}` : selected.status === "OPEN" ? " · Pendiente de respaldo" : ""}{selected.tolerance !== null ? ` · Tolerancia: ${formatMoney(selected.tolerance)}` : ""}</p> : null}
        {selected.status === "OPEN" && puedeResolver && grupo ? <>
          <h3>Resolver este control</h3>
          <div className="workpaper-control__acciones">
            <Button size="sm" variant="secondary" onClick={() => setAccionGrupo("accept")}>Aceptar con motivo</Button>
            <Button size="sm" variant="secondary" onClick={() => setAccionGrupo("exclude")}>Excluir del cálculo con motivo</Button>
            <SalidaConfiguracionFiscal />
          </div>
          {accionGrupo ? <>
            <label className="ds-field__label" htmlFor={motivoId}>Motivo</label>
            <textarea className="study-textarea" id={motivoId} value={motivo} placeholder="Escribí el motivo." onChange={(event) => selectReason(event.target.value)} />
            <Button size="sm" variant="primary" disabled={!motivo.trim()} onClick={() => actionGroup(accionGrupo)}>{accionGrupo === "accept" ? "Confirmar aceptación" : "Confirmar exclusión"}</Button>
            {!motivo.trim() ? <small role="note">Falta escribir el motivo.</small> : null}
          </> : null}
          <WorkpaperActionError error={grupoPerfilMutation?.variables?.grupo === grupo ? grupoPerfilMutation.error : null} />
        </> : null}
        {selected.status === "OPEN" && puedeResolver && !grupo ? <>
          <label className="ds-field__label" htmlFor={motivoId}>Motivo</label><textarea className="study-textarea" id={motivoId} value={controlResolutions[selected.id] ?? ""} placeholder="Escribí cómo se resolvió." onChange={(event) => setControlResolutions((v) => ({ ...v, [selected.id]: event.target.value }))} />
          {selected.severity === "BLOCKING" && documentsQuery.isSuccess ? <>
            <SearchSelect label={`Evidencia ${selected.code}`} value={controlEvidence[selected.id] ?? ""} onChange={(value) => setControlEvidence((v) => ({ ...v, [selected.id]: value }))} placeholder="Sin documento de respaldo" options={eligibleEvidenceDocuments.map((doc) => ({ value: doc.id, label: `${doc.fileVersions?.[0]?.originalName ?? doc.category ?? "Documento"} · ${getStatusBadgeMeta(doc.status).label}` }))} />
            {eligibleEvidenceDocuments.length === 0 ? <small className="muted-copy workpaper-control__ayuda">El respaldo es opcional. Para adjuntar uno, aprobá la extracción del documento en Bandeja.</small> : null}
          </> : null}
          {selected.severity !== "BLOCKING" ? <Button size="sm" variant="secondary" disabled={!motivo.trim()} aria-describedby={motivo.trim() ? undefined : motivoHelpId} onClick={() => confirmar({ title: "Eximir el control", description: `Vas a eximir el control «${nombre}» con el motivo «${motivo.trim()}». Quedará registrado como eximido.`, confirmLabel: "Sí, eximir", onConfirm: () => resolveControlMutation.mutate({ workpaperId: wp.id, findingId: selected.id, status: "WAIVED" }, { onSuccess: closePanel }) })}>Eximir</Button> : null}
          {!motivo.trim() ? <small id={motivoHelpId} role="note">Falta escribir el motivo o cómo se resolvió.</small> : null}
          <WorkpaperActionError error={resolveControlMutation.variables?.findingId === selected.id ? resolveControlMutation.error : null} />
        </> : null}
        {selected.status !== "OPEN" ? <p>{selected.resolution ?? "Control resuelto."}</p> : null}
        <h3>Actividad del control</h3>
        <p>{selected.resolution ? `${selected.resolution} · estado ${getStatusBadgeMeta(selected.status).label}` : "La API no entrega quién y cuándo resolvió este control; se muestra el estado disponible."}</p>
        <p>Los comentarios por control no están disponibles en este legajo.</p>
      </> : null}
    </ObjectPanel>
  </div>;
}
