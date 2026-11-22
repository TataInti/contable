import { useState } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import { Button } from "@contable/design-system";
import { StatusBadge } from "../../../ui/StatusBadge";
import { GRUPO_LABELS, PREFIJO_CONTROL_PERFIL } from "../../fiscal/comprobantesPermitidos";
import { SalidaConfiguracionFiscal } from "../../resumen/Piezas";
import type { Workpaper } from "../tipos";
import { WorkpaperActionError } from "../WorkpaperActionError";

export interface GrupoPerfilVariables {
  workpaperId: string;
  grupo: string;
  accion: "exclude" | "accept";
  reason: string;
}

export interface GrupoPerfilControlProps {
  wp: Workpaper;
  control: Workpaper["controls"][number];
  puedeResolver: boolean;
  mutation?: UseMutationResult<unknown, Error, GrupoPerfilVariables> | undefined;
}

/**
 * Un grupo de comprobantes de venta que no corresponden al perfil (corte 4B): se resuelve por grupo,
 * excluyéndolo del cálculo o aceptándolo, con motivo. Tildar el tipo en la configuración también lo resuelve.
 */
export function GrupoPerfilControl({ wp, control, puedeResolver, mutation }: GrupoPerfilControlProps) {
  const grupo = control.code.slice(PREFIJO_CONTROL_PERFIL.length);
  const nombre = GRUPO_LABELS[grupo] ?? grupo;
  const cantidad = Number(control.actual ?? 0);
  const [motivo, setMotivo] = useState("");
  const motivoId = `${control.id}-motivo`;
  const abierto = control.status === "OPEN";
  const puedeActuar = abierto && puedeResolver && Boolean(mutation);

  return (
    <div className="workpaper-control" key={control.id}>
      <span>
        <strong>
          {nombre}: {cantidad} {cantidad === 1 ? "comprobante" : "comprobantes"}
        </strong>
        <small>
          No corresponde al perfil del cliente. Tildá el tipo en Comprobantes de la configuración fiscal o resolvelo acá.
        </small>
      </span>
      <StatusBadge status={control.status} />
      <span className="muted-copy">{control.status === "OPEN" ? "Bloquea el cierre" : "Resuelto"}</span>
      {abierto && !puedeResolver ? (
        <small className="muted-copy" role="status">
          Tu perfil no puede resolver controles de este legajo.
        </small>
      ) : null}
      {puedeActuar && mutation ? (
        <span className="workpaper-control__resolution">
          <input
            aria-label={`Motivo ${grupo}`}
            value={motivo}
            placeholder="Escribí el motivo."
            onChange={(event) => setMotivo(event.target.value)}
          />
          <span className="workpaper-control__acciones">
            <Button
              size="sm"
              variant="secondary"
              disabled={!motivo.trim()}
              loading={mutation.isPending && mutation.variables?.accion === "exclude" && mutation.variables?.grupo === grupo}
              aria-describedby={motivo.trim() ? undefined : motivoId}
              onClick={() => mutation.mutate({ workpaperId: wp.id, grupo, accion: "exclude", reason: motivo.trim() })}
            >
              Excluir del cálculo
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!motivo.trim()}
              loading={mutation.isPending && mutation.variables?.accion === "accept" && mutation.variables?.grupo === grupo}
              aria-describedby={motivo.trim() ? undefined : motivoId}
              onClick={() => mutation.mutate({ workpaperId: wp.id, grupo, accion: "accept", reason: motivo.trim() })}
            >
              Aceptar con motivo
            </Button>
            <SalidaConfiguracionFiscal />
            {!motivo.trim() ? (
              <small id={motivoId} className="form-submit-hint" role="note">
                Falta escribir el motivo.
              </small>
            ) : null}
          </span>
          <WorkpaperActionError
            error={mutation.variables?.grupo === grupo ? mutation.error : null}
          />
        </span>
      ) : null}
    </div>
  );
}
