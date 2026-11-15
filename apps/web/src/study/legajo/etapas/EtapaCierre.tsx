// Etapa Cierre del Legajo: texto de cierre y arrastre, hashes y controles bloqueantes (Foco 2.3d).
import type { Workpaper } from "../tipos";

export function EtapaCierre({ wp }: { wp: Workpaper }) {
  const blocking = wp.controls.filter((c) => c.severity === "BLOCKING" && c.status === "OPEN");

  return (
    <div className="workpaper-stage">
      <div className="workpaper-stage__heading">
        <div>
          <strong>Cierre y arrastre</strong>
          <small>
            Finalizar congela los hashes y genera los saldos de cierre para el siguiente período.
          </small>
        </div>
      </div>
      <dl className="workpaper-close-details">
        <div>
          <dt>Hash de entrada</dt>
          <dd>{wp.inputHash ? `${wp.inputHash.slice(0, 16)}…` : "Se genera al calcular"}</dd>
        </div>
        <div>
          <dt>Hash de salida</dt>
          <dd>{wp.outputHash ? `${wp.outputHash.slice(0, 16)}…` : "Se genera al finalizar"}</dd>
        </div>
        <div>
          <dt>Controles bloqueantes</dt>
          <dd>{blocking.length}</dd>
        </div>
      </dl>
    </div>
  );
}
