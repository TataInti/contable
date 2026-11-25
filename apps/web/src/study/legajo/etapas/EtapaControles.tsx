// Etapa Controles del Legajo: hallazgos, resolución y evidencia por control (Foco 2.3d).
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { AsyncState, Button, EmptyState, getStatusBadgeMeta, ObjectPanel, WorkQueue, WorkQueueRow, SearchSelect } from "@contable/design-system";
import { CONTROL_CAUSAS, CONTROL_LABELS } from "../etiquetas";
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
/** Resolver de una vez todos los controles bloqueantes abiertos con un solo motivo (13-4). */
export interface ResolverAbiertosVariables {
  workpaperId: string;
  resolution: string;
}

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
  resolveOpenMutation?: UseMutationResult<unknown, Error, ResolverAbiertosVariables>;
  /** Excluir o aceptar un grupo «no corresponde al perfil» (corte 4B). */
  grupoPerfilMutation?: UseMutationResult<unknown, Error, GrupoPerfilVariables>;
  confirmar: (solicitud: SolicitudConfirmacion) => void;
}

const CARGA_DOCUMENTOS = "Cargando documentos de respaldo…";

export function EtapaControles({ capabilities, wp, controlResolutions, setControlResolutions, controlEvidence, setControlEvidence, documentsQuery, affectedVouchers = [], onGoToClassification, resolveControlMutation, resolveOpenMutation, grupoPerfilMutation, confirmar }: EtapaControlesProps) {
  const [params, setParams] = useSearchParams();
  const [showResolved, setShowResolved] = useState(false);
  const [motivosGrupo, setMotivosGrupo] = useState<Record<string, string>>({});
  const [resolverJuntos, setResolverJuntos] = useState(false);
  const [motivoJuntos, setMotivoJuntos] = useState("");
  const [accionGrupo, setAccionGrupo] = useState<"accept" | "exclude" | null>(null);
  const [accionControl, setAccionControl] = useState<{ findingId: string; action: "resolve" | "waive" } | null>(null);
  const selectedId = params.get("panel")?.startsWith("control-") ? params.get("panel")!.slice(8) : null;
  const selected = wp.controls.find((item) => item.id === selectedId) ?? null;
  const puedeResolver = capabilities.has("tax.settlements.review");
  useEffect(() => {
    if (!selected) return;
    const content = document.querySelector<HTMLElement>(".action-drawer__content");
    if (content) content.scrollTop = 0;
  }, [selected?.id, accionGrupo, accionControl]);
  const eligibleEvidenceDocuments = (documentsQuery.data ?? []).filter((document) => ["READY", "APPLIED", "REVIEWED"].includes(document.status));
  const open = wp.controls.filter((item) => item.status === "OPEN");
  const resolved = wp.controls.filter((item) => item.status !== "OPEN");
  // Controles cuya fuente no tiene datos: no bloquean y quedan visibles como «Omitido: …».
  // Un cálculo nuevo genera otro control con el mismo código: se muestra solo el más reciente de cada uno (la API los entrega del más nuevo al más viejo).
  const omitidos = resolved.filter((item) => item.resolution?.startsWith("Omitido:")).filter((item, index, lista) => lista.findIndex((otro) => otro.code === item.code) === index);
  const juntos = open.filter((item) => item.severity === "BLOCKING" && !item.code.startsWith(PREFIJO_CONTROL_PERFIL));
  const resolverTodos = () => {
    if (!resolveOpenMutation || !motivoJuntos.trim()) return;
    resolveOpenMutation.mutate({ workpaperId: wp.id, resolution: motivoJuntos.trim() }, { onSuccess: () => { setResolverJuntos(false); setMotivoJuntos(""); } });
  };
  const labelFor = (control: Workpaper["controls"][number]) => control.code.startsWith(PREFIJO_CONTROL_PERFIL)
    ? (GRUPO_LABELS[control.code.slice(PREFIJO_CONTROL_PERFIL.length)] ?? control.code)
    : CONTROL_LABELS[control.code] ?? control.message ?? control.code;
  const summaryFor = (control: Workpaper["controls"][number]) => {
    if (control.status !== "OPEN" && control.resolution?.startsWith("Omitido:")) return control.resolution;
    if (control.message?.trim()) return control.message;
    if (control.code.startsWith(PREFIJO_CONTROL_PERFIL)) return "Los comprobantes no corresponden al perfil fiscal del cliente.";
    if (control.actual !== null && control.expected !== null) return `Esperado: ${formatMoney(control.expected)} · Actual: ${formatMoney(control.actual)}`;
    if (control.actual !== null) return `Importe observado: ${formatMoney(control.actual)}.`;
    if (control.expected !== null) return `Importe esperado: ${formatMoney(control.expected)}.`;
    return Object.entries(CONTROL_CAUSAS).find(([codigo]) => codigo === control.code)?.[1] ?? "Revisá este control antes de cerrar.";
  };
  const count = (control: Workpaper["controls"][number]) => control.code.startsWith(PREFIJO_CONTROL_PERFIL) ? Number(control.actual ?? 0) : null;
  const amountFor = (control: Workpaper["controls"][number]) => control.code.startsWith(PREFIJO_CONTROL_PERFIL)
    ? `${count(control)} ${count(control) === 1 ? "comprobante" : "comprobantes"}`
    : control.actual !== null || control.expected !== null
      ? formatMoney(control.actual ?? control.expected!)
      : undefined;
  const openPanel = (id: string) => { setAccionGrupo(null); setAccionControl(null); setParams((current) => { current.set("panel", `control-${id}`); return current; }, { replace: true }); };
  const closePanel = () => { setAccionGrupo(null); setAccionControl(null); setParams((current) => { current.delete("panel"); return current; }, { replace: true }); };
  const nombre = selected ? labelFor(selected) : "";
  const grupo = selected?.code.startsWith(PREFIJO_CONTROL_PERFIL) ? selected.code.slice(PREFIJO_CONTROL_PERFIL.length) : null;
  const controlVouchers = grupo ? affectedVouchers.filter((item) => {
    const letter = item.voucher.letter;
    if (!letter) return grupo === "TIPO_NO_RECONOCIDO";
    const note = item.documentKind !== "INVOICE";
    return grupo === `${note ? "NOTAS" : "FACTURA"}_${letter}`;
  }) : [];
  const motivoId = `${selected?.id ?? "control"}-motivo`;
  const motivo = selected ? (grupo ? motivosGrupo[selected.id] ?? "" : controlResolutions[selected.id] ?? "") : "";
  const selectReason = (value: string) => selected && setMotivosGrupo((prev) => ({ ...prev, [selected.id]: value }));
  const actionGroup = (action: "accept" | "exclude") => {
    if (!selected || !grupo || !grupoPerfilMutation || !motivo.trim()) return;
    grupoPerfilMutation.mutate({ workpaperId: wp.id, grupo, accion: action, reason: motivo.trim() }, { onSuccess: closePanel });
  };
  const accionControlActiva = accionControl && accionControl.findingId === selected?.id ? accionControl.action : null;
  const resolverControl = () => {
    if (!selected || !accionControlActiva || !motivo.trim()) return;
    if (accionControlActiva === "resolve") {
      resolveControlMutation.mutate({ workpaperId: wp.id, findingId: selected.id, status: "RESOLVED", ...(controlEvidence[selected.id] ? { evidenceDocumentId: controlEvidence[selected.id] } : {}) }, { onSuccess: closePanel });
      return;
    }
    confirmar({ title: "Eximir el control", description: `Vas a eximir el control «${nombre}» con el motivo «${motivo.trim()}». Quedará registrado como eximido.`, confirmLabel: "Sí, eximir", onConfirm: () => resolveControlMutation.mutate({ workpaperId: wp.id, findingId: selected.id, status: "WAIVED" }, { onSuccess: closePanel }) });
  };
  const primary = selected?.status === "OPEN" && puedeResolver ? grupo ? accionGrupo ? (
    <Button variant="primary" disabled={!motivo.trim()} loading={grupoPerfilMutation?.isPending} onClick={() => actionGroup(accionGrupo)}>{accionGrupo === "accept" ? "Confirmar aceptación" : "Confirmar exclusión"}</Button>
  ) : undefined : accionControlActiva ? (
    <Button variant="primary" disabled={!motivo.trim()} loading={resolveControlMutation.isPending} onClick={resolverControl}>{accionControlActiva === "resolve" ? "Confirmar resolución" : "Eximir"}</Button>
  ) : undefined : undefined;
  const pideRespaldo = puedeResolver && open.some((control) => control.severity === "BLOCKING");
  return <div className="workpaper-controls">
    {pideRespaldo && documentsQuery.isError ? <AsyncState loading={false} error errorTitle="No se pudieron leer los documentos de respaldo" errorDescription="Reintentá la lectura. Mientras tanto, el control puede resolverse sin respaldo." onRetry={() => void documentsQuery.refetch()} loadingLabel={CARGA_DOCUMENTOS} /> : null}
    {pideRespaldo && !documentsQuery.isError && !documentsQuery.isSuccess ? <AsyncState loading error={false} errorTitle="" errorDescription="" onRetry={() => void documentsQuery.refetch()} loadingLabel={CARGA_DOCUMENTOS} /> : null}
    {omitidos.length ? <ul className="workpaper-controls__omitidos" aria-label="Controles omitidos">{omitidos.map((control) => <li key={control.id}><strong>{labelFor(control)}</strong> · {control.resolution}</li>)}</ul> : null}
    {puedeResolver && resolveOpenMutation && juntos.length >= 2 && !showResolved ? <div className="workpaper-controls__juntos">
      {!resolverJuntos ? <Button variant="secondary" onClick={() => setResolverJuntos(true)}>{`Resolver los ${juntos.length} con un solo motivo`}</Button> : <>
        <label className="ds-field__label" htmlFor="controles-motivo-juntos">{`Motivo para los ${juntos.length} controles`}</label>
        <textarea className="study-textarea" id="controles-motivo-juntos" value={motivoJuntos} placeholder="Escribí el motivo." onChange={(event) => setMotivoJuntos(event.target.value)} />
        <Button variant="primary" disabled={!motivoJuntos.trim()} loading={resolveOpenMutation.isPending} onClick={resolverTodos}>{`Confirmar resolución de ${juntos.length} controles`}</Button>
        <Button variant="ghost" onClick={() => setResolverJuntos(false)}>Cancelar</Button>
        {!motivoJuntos.trim() ? <small className="muted-copy">Escribí el motivo para resolver los {juntos.length} controles.</small> : null}
        <WorkpaperActionError error={resolveOpenMutation.error} />
      </>}
    </div> : null}
    <WorkQueue label={showResolved ? "Controles resueltos" : "Controles abiertos"} empty={<EmptyState size="inline" title={showResolved ? "Todavía no hay controles resueltos." : "No hay controles abiertos para este legajo."} />}>
      {(showResolved ? resolved : open).map((control) => <WorkQueueRow key={control.id} id={control.id} title={labelFor(control)} decision={summaryFor(control)} status={control.status === "OPEN" ? control.severity : control.status} amount={amountFor(control)} onOpen={() => openPanel(control.id)} actionLabel="Abrir" />)}
    </WorkQueue>
    {resolved.length || showResolved ? <Button variant="link" className="workpaper-controls__resueltos" onClick={() => setShowResolved((value) => !value)}>{showResolved ? `Abiertos (${open.length})` : `Resueltos (${resolved.length})`}</Button> : null}
    <ObjectPanel kind="control" isOpen={Boolean(selected)} onClose={closePanel} title={nombre} description={selected ? `Estado: ${getStatusBadgeMeta(selected.status === "OPEN" ? selected.severity : selected.status).label}${selected.status === "OPEN" && selected.severity === "BLOCKING" ? " · Bloquea el cierre" : ""}` : undefined} primaryAction={primary} primaryHint={primary && !motivo.trim() ? grupo ? `Escribí el motivo para confirmar ${accionGrupo === "accept" ? "la aceptación" : "la exclusión"}.` : accionControlActiva === "waive" ? "Escribí el motivo para eximir este control." : "Escribí el motivo para confirmar la resolución." : null} returnFocusTo={selected ? Array.from(document.querySelectorAll<HTMLElement>("[data-row-key]")).find((row) => row.dataset.rowKey === selected.id)?.querySelector("button") : null}>
      {selected ? <>
        {grupo || selected.actual ? <h3>Comprobantes afectados</h3> : null}
        {grupo ? controlVouchers.length ? <ul className="workpaper-control__affected" aria-label="Comprobantes afectados">{controlVouchers.map((item) => <li key={item.id}><strong>{item.voucher.letter ?? item.voucher.type} · {String(item.voucher.pointOfSale).padStart(4, "0")}-{String(item.voucher.number).padStart(8, "0")}</strong><span>{new Date(item.voucher.issuedOn).toLocaleDateString("es-AR", { timeZone: "UTC" })} · {formatMoney(item.voucher.total)}</span><Button variant="link" onClick={() => { closePanel(); onGoToClassification?.(); }}>Abrir en Clasificación</Button></li>)}</ul> : <p>{count(selected)} comprobantes afectados; el detalle no está disponible.</p> : selected.actual ? <p>{`Importe observado: ${formatMoney(selected.actual)}.`}</p> : null}
        {selected.message ? <p>{selected.message}</p> : null}

        {selected.status === "OPEN" && !puedeResolver ? <p role="status">Tu perfil no puede resolver controles de este legajo.</p> : null}
        {selected.expected !== null ? <p>Esperado: {formatMoney(selected.expected)}{selected.actual !== null ? ` · Actual: ${formatMoney(selected.actual)}` : selected.status === "OPEN" ? " · Pendiente de respaldo" : ""}{selected.tolerance !== null ? ` · Tolerancia: ${formatMoney(selected.tolerance)}` : ""}</p> : null}
        {grupo || selected.resolution || selected.resolvedByUserId || selected.updatedAt && selected.createdAt && selected.updatedAt !== selected.createdAt ? <h3>Actividad del control</h3> : null}
        {selected.resolution || selected.resolvedByUserId || selected.updatedAt && selected.createdAt && selected.updatedAt !== selected.createdAt ? <ol className="workpaper-control__activity">
          {selected.resolution ? <li>{selected.resolution}</li> : null}
          {selected.resolvedByUserId ? <li>Usuario que resolvió: {selected.resolvedByUserId}{selected.updatedAt ? ` · ${new Date(selected.updatedAt).toLocaleString("es-AR")}` : ""}</li> : null}
          {!selected.resolvedByUserId && selected.updatedAt && selected.createdAt && selected.updatedAt !== selected.createdAt ? <li>Control actualizado · {new Date(selected.updatedAt).toLocaleString("es-AR")}</li> : null}
        </ol> : grupo ? <p className="muted-copy">Sin actividad todavía</p> : null}
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
          </> : null}
          <WorkpaperActionError error={grupoPerfilMutation?.variables?.grupo === grupo ? grupoPerfilMutation.error : null} />
        </> : null}
        {selected.status === "OPEN" && puedeResolver && !grupo ? <>
          {!accionControlActiva ? <div className="workpaper-control__acciones" aria-label="Acciones del control">
            <Button size="sm" variant="secondary" onClick={() => setAccionControl({ findingId: selected.id, action: "resolve" })}>Resolver</Button>
            {selected.severity !== "BLOCKING" ? <Button size="sm" variant="secondary" onClick={() => setAccionControl({ findingId: selected.id, action: "waive" })}>Eximir</Button> : null}
          </div> : <>
            <label className="ds-field__label" htmlFor={motivoId}>Motivo</label>
            <textarea className="study-textarea" id={motivoId} value={controlResolutions[selected.id] ?? ""} placeholder="Escribí el motivo." onChange={(event) => setControlResolutions((v) => ({ ...v, [selected.id]: event.target.value }))} />
            {accionControlActiva === "resolve" && selected.severity === "BLOCKING" && documentsQuery.isSuccess ? <>
              <span className="ds-field__label">Respaldo (opcional)</span>
              <SearchSelect label={`Evidencia ${selected.code}`} hideLabel value={controlEvidence[selected.id] ?? ""} onChange={(value) => setControlEvidence((v) => ({ ...v, [selected.id]: value }))} placeholder="Sin documento de respaldo" options={eligibleEvidenceDocuments.map((doc) => ({ value: doc.id, label: `${doc.fileVersions?.[0]?.originalName ?? doc.category ?? "Documento"} · ${getStatusBadgeMeta(doc.status).label}` }))} />
              {eligibleEvidenceDocuments.length === 0 ? <small className="muted-copy workpaper-control__ayuda">El respaldo es opcional. Para adjuntar uno, aprobá la extracción del documento en Bandeja.</small> : null}
            </> : null}
            <Button size="sm" variant="secondary" onClick={() => setAccionControl(null)}>Cambiar acción</Button>
          </>}
          <WorkpaperActionError error={resolveControlMutation.variables?.findingId === selected.id ? resolveControlMutation.error : null} />
        </> : null}
      </> : null}
    </ObjectPanel>
  </div>;
}
