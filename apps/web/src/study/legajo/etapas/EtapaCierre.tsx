// Etapa Cierre del Legajo: texto de cierre y arrastre, hashes y controles bloqueantes (Foco 2.3d).
import { Button } from "@contable/design-system";
import { formatMoney } from "../formato";
import { formatearFecha } from "../../../lib/formatoFechas";
import type { TaxPosition, Workpaper } from "../tipos";

interface EtapaCierreProps {
  wp: Workpaper;
  periodLabel?: string;
  positions?: TaxPosition[];
  onFinalize?: () => void;
  onRectify?: () => void;
  onGoToCalculation?: () => void;
  onGoToControls?: () => void;
  onPresentation?: () => void;
  onDeclaration?: () => void;
  onPayment?: () => void;
  hasFiling?: boolean;
  hasDeclaration?: boolean;
  hasPayment?: boolean;
  paymentNotRequired?: boolean;
  canFinalize?: boolean;
  canRectify?: boolean;
  canFile?: boolean;
  canDeclare?: boolean;
  canPay?: boolean;
  nextPeriod?: string;
  nextBalance?: string | null;
  readOnly?: boolean;
}

export function EtapaCierre({
  wp,
  periodLabel = "Período sin identificar",
  positions = [],
  onFinalize,
  onRectify,
  onGoToCalculation,
  onGoToControls,
  onPresentation,
  onDeclaration,
  onPayment,
  hasFiling = false,
  hasDeclaration = false,
  hasPayment = false,
  paymentNotRequired = false,
  canFinalize = false,
  canRectify = false,
  canFile = false,
  canDeclare = false,
  canPay = false,
  nextPeriod = "el período siguiente",
  nextBalance = null,
  readOnly = false,
}: EtapaCierreProps) {
  const blocking = wp.controls.filter((c) => c.severity === "BLOCKING" && c.status === "OPEN");
  const finalized = wp.status === "FINALIZED";
  const readyToFinalize = wp.status === "REVIEWED" && blocking.length === 0;
  const pasosHechos = Number(finalized) + Number(hasFiling) + Number(hasDeclaration) + Number(hasPayment || paymentNotRequired);
  const totalIngresar = positions.reduce((sum, position) => sum + Math.round(Number(position.totalPayable) * 100), 0) / 100;
  const vence = positions.find((position) => position.dueDate)?.dueDate ?? null;
  const control = (label: string, allowed: boolean, handler?: () => void) => (
    <Button variant="secondary" onClick={handler} disabled={!allowed}>{label}</Button>
  );
  const paso = (n: number, titulo: string, descripcion: string, hecho: boolean, disponible: boolean, accion: React.ReactNode) => (
    <li className="workpaper-close-step" key={n}>
      <span className="workpaper-close-step__number">{n}</span>
      <div className="workpaper-close-step__title"><strong>{titulo}</strong><small>{descripcion}</small></div>
      <span className="workpaper-close-step__status" role="status">{hecho ? "Hecho" : disponible ? "Disponible" : "Bloqueado"}</span>
      <div className="workpaper-close-step__action">{accion}</div>
    </li>
  );

  return (
    <div className="workpaper-stage">
      <p className="workpaper-close-summary"><strong>{periodLabel}</strong> · {positions.map((position) => position.regime.taxType.name).filter((name, index, all) => all.indexOf(name) === index).join(" / ") || "Impuestos sin posición"} · Total a ingresar {formatMoney(totalIngresar.toFixed(2))} · Vence {formatearFecha(vence, "sin fecha cargada")} · {pasosHechos} de 4 pasos</p>
      <ol className="workpaper-close-checklist" aria-label="Pasos para cerrar el período">
        {paso(1, "Finalizar", "Congela la liquidación y genera los saldos de cierre.", finalized, readyToFinalize && canFinalize && !readOnly,
          readyToFinalize ? readOnly ? null : <>{control("Finalizar", canFinalize, onFinalize)}{canFinalize ? null : <p>Tu perfil no tiene permiso para finalizar este legajo.</p>}</> :
            !finalized ? <><p>{blocking.length ? "Falta resolver los controles bloqueantes." : "Falta revisar la liquidación."}</p><Button variant="secondary" onClick={blocking.length ? onGoToControls : onGoToCalculation}>{blocking.length ? "Ir a Controles" : "Ir a Cálculo"}</Button></> : null)}
        {paso(2, "Registrar presentación y acuse", "Guardá la fecha, el número y el acuse emitido por el organismo.", hasFiling, finalized && canFile && !readOnly,
          finalized ? readOnly ? null : <>{control("Registrar presentación y acuse", canFile, onPresentation)}{canFile ? null : <p>Tu perfil no tiene permiso para registrar la presentación.</p>}</> : <p>Falta finalizar la liquidación.</p>)}
        {paso(3, "Cargar la declaración jurada", "Adjuntá la declaración y registrá los saldos que informa.", hasDeclaration, hasFiling && canDeclare && !readOnly,
          hasFiling ? readOnly ? null : <>{control("Cargar la declaración jurada", canDeclare, onDeclaration)}{canDeclare ? null : <p>Tu perfil no tiene permiso para cargar la declaración jurada.</p>}</> : <p>Falta registrar la presentación y su acuse.</p>)}
        {paso(4, "Pago (opcional)", "Registrá el pago o indicá que no hubo importe a pagar.", hasPayment || paymentNotRequired, paymentNotRequired || (hasFiling && canPay && !readOnly),
          paymentNotRequired ? <p>No requiere pago: el saldo es cero o a favor.</p> :
            hasFiling ? readOnly ? null : <>{control("Registrar pago", canPay, onPayment)}{canPay ? null : <p>Tu perfil no tiene permiso para registrar el pago.</p>}</> : <p>Falta registrar la presentación.</p>)}
      </ol>
      <section aria-label="Saldo para el mes siguiente">
        <h3>Saldo para el mes siguiente</h3>
        <p>{nextBalance ?? "El saldo se informa al cargar la declaración jurada."} · pasa a {nextPeriod}.</p>
      </section>
      {finalized && !readOnly ? <div>
        <p>Reabrí con una rectificativa cuando necesites corregir una liquidación ya cerrada.</p>
        <Button variant="secondary" onClick={onRectify} disabled={!canRectify}>Crear rectificativa</Button>
        {!canRectify ? <p role="status">Tu perfil no tiene permiso para crear una rectificativa.</p> : null}
      </div> : null}
      <details>
        <summary>Detalle técnico</summary>
        <p>Huella que prueba que lo presentado es lo calculado.</p>
        <dl className="workpaper-close-details">
          <div><dt>Huella de entrada</dt><dd>{wp.inputHash ?? "Se genera al calcular"}</dd></div>
          <div><dt>Huella de salida</dt><dd>{wp.outputHash ?? "Se genera al finalizar"}</dd></div>
          <div><dt>Controles bloqueantes</dt><dd>{blocking.length}</dd></div>
        </dl>
      </details>
    </div>
  );
}
