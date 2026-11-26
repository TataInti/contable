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
  /** Abre el cajón del impuesto (presentación, declaración jurada y pago). */
  onOpenTax?: (obligationId: string) => void;
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
  onOpenTax,
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
  const centavos = (campo: "accrued" | "paid" | "totalPayable") =>
    positions.reduce((sum, position) => sum + Math.round(Number(position[campo] ?? 0) * 100), 0);
  const totalDeterminado = centavos("accrued") / 100;
  const totalPagado = centavos("paid") / 100;
  const saldoPendiente = centavos("totalPayable") / 100;
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
      <p className="workpaper-close-summary"><strong>{periodLabel}</strong> · {positions.map((position) => position.regime.taxType.name).filter((name, index, all) => all.indexOf(name) === index).join(" / ") || "Impuestos sin posición"} · Total determinado {formatMoney(totalDeterminado.toFixed(2))} · Pagado {formatMoney(totalPagado.toFixed(2))} · Saldo {formatMoney(saldoPendiente.toFixed(2))} · Vence {formatearFecha(vence, "sin fecha cargada")} · {pasosHechos} de 4 pasos</p>
      <ol className="workpaper-close-checklist" aria-label="Pasos para cerrar el período">
        {paso(1, "Finalizar", "Congela la liquidación y genera los saldos de cierre.", finalized, readyToFinalize && canFinalize && !readOnly,
          readyToFinalize ? readOnly ? null : <>{control("Finalizar", canFinalize, onFinalize)}{canFinalize ? null : <p>Tu perfil no tiene permiso para finalizar este legajo.</p>}</> :
            !finalized ? <><p>{blocking.length ? "Falta resolver los controles bloqueantes." : "Falta revisar la liquidación."}</p><Button variant="secondary" onClick={blocking.length ? onGoToControls : onGoToCalculation}>{blocking.length ? "Ir a Controles" : "Ir a Cálculo"}</Button></> : null)}
        {paso(2, "Presentación y acuse", "Fecha, importe y acuse emitido por el organismo, por impuesto.", hasFiling, finalized && canFile && !readOnly,
          finalized ? <p>{hasFiling ? "Presentación registrada." : "Se registra en el cajón de cada impuesto."}</p> : <p>Falta finalizar la liquidación.</p>)}
        {paso(3, "Declaración jurada", "Documento y saldos que informa, por impuesto.", hasDeclaration, hasFiling && canDeclare && !readOnly,
          hasFiling ? <p>{hasDeclaration ? "Declaración jurada cargada." : "Se carga en el cajón de cada impuesto."}</p> : <p>Falta registrar la presentación y su acuse.</p>)}
        {paso(4, "Pago (opcional)", "Registrá el pago o indicá que no hubo importe a pagar.", hasPayment || paymentNotRequired, paymentNotRequired || (hasFiling && canPay && !readOnly),
          paymentNotRequired ? <p>{hasPayment ? `Pagado: ${formatMoney(totalPagado.toFixed(2))}.` : "No requiere pago: el saldo es cero o a favor."}</p> :
            hasPayment ? <p>Pago registrado.</p> : hasFiling ? <p>Se registra en el cajón de cada impuesto.</p> : <p>Falta registrar la presentación.</p>)}
      </ol>
      {finalized && positions.length > 0 ? (
        <section aria-label="Impuestos del mes" className="workpaper-close-taxes">
          <h3>Un cajón por impuesto</h3>
          <ul className="workpaper-close-taxes__list">
            {positions.map((position) => {
              const presentada = Boolean(position.filingId);
              const conDj = Boolean(position.hasDeclaration);
              const pagado = Number(position.paid) > 0;
              const sinPago = Number(position.totalPayable) <= 0;
              const completo = presentada && conDj && (pagado || sinPago);
              const nombre = position.regime.taxType.name;
              const puede = canFile || canPay;
              return (
                <li key={position.obligationId} className="workpaper-close-tax">
                  <div className="workpaper-close-tax__title">
                    <strong>{nombre}</strong>
                    <small>{position.regime.jurisdiction.name}</small>
                  </div>
                  <ul className="workpaper-close-tax__states" aria-label={`Estado de ${nombre}`}>
                    <li>Presentación: <strong>{presentada ? "Hecha" : "Pendiente"}</strong></li>
                    <li>Declaración jurada: <strong>{conDj ? "Cargada" : "Pendiente"}</strong></li>
                    <li>Pago: <strong>{pagado && sinPago ? "Pagado" : sinPago ? "No requiere" : "Pendiente"}</strong></li>
                  </ul>
                  <div className="workpaper-close-tax__action">
                    {readOnly ? null : puede ? (
                      <Button variant={completo ? "secondary" : "primary"} aria-label={`${completo ? "Ver o corregir" : "Completar"} ${nombre}`} onClick={() => onOpenTax?.(position.obligationId)}>
                        {completo ? "Ver o corregir" : "Completar"}
                      </Button>
                    ) : <p>Tu perfil no tiene permiso para registrar presentaciones ni pagos.</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <section aria-label="Saldo para el mes siguiente">
        <h3>Saldo para el mes siguiente</h3>
        <p>{nextBalance !== null && nextBalance !== "" && Number.isFinite(Number(nextBalance)) ? `${formatMoney(nextBalance)} · pasa a ${nextPeriod}.` : `El saldo se informa al cargar la declaración jurada y pasa a ${nextPeriod}.`}</p>
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
