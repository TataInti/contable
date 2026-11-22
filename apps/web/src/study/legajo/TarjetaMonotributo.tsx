import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Field } from "@contable/design-system";
import { ActionDrawer, ActionDrawerFooter } from "../../ui/ActionDrawer";
import { StatusBadge } from "../../ui/StatusBadge";
import { ApiError } from "../../lib/api";
import { formatearFecha } from "../../lib/formatoFechas";
import { CampoFecha } from "../fiscal/CampoFecha";
import { MutationError } from "../fiscal/MutationError";
import { importeEnPesos } from "../fiscal/categoriaTem";
import {
  etiquetaMes,
  importeDeEntrada,
  importeParaEntrada,
  textoCategoriaMonotributo,
  useMonotributoMes,
  type EstadoMonotributo,
} from "../fiscal/monotributo";

/**
 * Tarjeta «Monotributo — cuota de <mes>» del Legajo (corte 3F): categoría, cuota, vencimiento y pagos.
 * No crea liquidación ni declaración. La categoría se elige en Configuración fiscal, Regímenes; aquí
 * se registran los pagos de la cuota.
 */

interface Props {
  firmId: string;
  clientId: string;
  /** Mes de la cuota, «AAAA-MM». */
  month: string;
  /** ¿El rol puede registrar pagos (permiso de pagos y revisión no cerrada)? */
  puedePagar: boolean;
}

function mensajeDelCampo(error: unknown, campo: string): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const detalle = error.details?.details;
  const ruta = detalle && !Array.isArray(detalle) && typeof detalle === "object" ? (detalle as { path?: unknown }).path : null;
  return Array.isArray(ruta) && ruta[0] === campo ? error.message : undefined;
}

function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function etiquetaEstado(estado: EstadoMonotributo): string {
  if (estado.status === "PAGADA") return "Pagada";
  if (estado.status === "PENDIENTE") return "Pendiente de pago";
  if (estado.status === "SIN_CUOTA") return "Sin cuota oficial para este mes";
  return "Falta la categoría";
}

export function TarjetaMonotributo({ firmId, clientId, month, puedePagar }: Props) {
  const navigate = useNavigate();
  const { query, registrarPago } = useMonotributoMes(firmId, clientId, month);
  const [pagoAbierto, setPagoAbierto] = useState(false);
  const estado = query.data;
  if (!estado || !estado.applies) return null;
  const etiqueta = etiquetaMes(month);
  const sinCategoria = estado.status === "SIN_CATEGORIA";

  return (
    <section className="monotributo-card" aria-labelledby="monotributo-card-titulo">
      <div className="monotributo-card__cabecera">
        <h2 id="monotributo-card-titulo">Monotributo — cuota de {etiqueta}</h2>
        {sinCategoria ? (
          <StatusBadge status="MISSING" label="Falta la categoría" variant="plain" />
        ) : (
          <span className="monotributo-card__estado">{etiquetaEstado(estado)}</span>
        )}
      </div>
      {sinCategoria ? (
        <div className="monotributo-card__falta">
          <p>Falta elegir la categoría de monotributo para {etiqueta}. Se elige en Configuración fiscal, Regímenes.</p>
          <Button size="sm" variant="secondary" onClick={() => navigate("/configuracion-fiscal")}>
            Ir a Configuración fiscal
          </Button>
        </div>
      ) : (
        <dl className="monotributo-card__datos">
          <div><dt>Categoría</dt><dd>{estado.category ? textoCategoriaMonotributo(estado.category) : "—"}</dd></div>
          <div><dt>Cuota del mes</dt><dd>{estado.fee ? importeEnPesos(estado.fee) : "Sin cuota oficial cargada para este mes"}</dd></div>
          <div><dt>Vencimiento</dt><dd>{formatearFecha(estado.dueDate)}</dd></div>
          <div><dt>Pagado</dt><dd>{importeEnPesos(estado.paid)}{estado.pending && estado.status !== "PAGADA" ? ` · faltan ${importeEnPesos(estado.pending)}` : ""}</dd></div>
        </dl>
      )}
      {estado.payments.length > 0 ? (
        <div className="monotributo-card__pagos">
          <h3>Pagos registrados</h3>
          <ul>
            {estado.payments.map((pago) => (
              <li key={pago.id}>
                {formatearFecha(pago.paidAt)} · {importeEnPesos(pago.amount)}{pago.comprobante ? ` · comprobante ${pago.comprobante}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {puedePagar && estado.fee && !sinCategoria ? (
        <div className="monotributo-card__acciones">
          <Button size="sm" onClick={() => { registrarPago.reset(); setPagoAbierto(true); }}>Registrar pago</Button>
        </div>
      ) : null}
      <CajonPagoMonotributo
        isOpen={pagoAbierto}
        onClose={() => setPagoAbierto(false)}
        month={month}
        estado={estado}
        guardar={registrarPago}
      />
    </section>
  );
}

interface CajonProps {
  isOpen: boolean;
  onClose: () => void;
  month: string;
  estado: EstadoMonotributo;
  guardar: {
    mutate: (entrada: { month: string; paidAt: string; amount: string; comprobante?: string }, opciones?: { onSuccess?: () => void }) => void;
    reset: () => void;
    isPending: boolean;
    error: unknown;
  };
}

function CajonPagoMonotributo({ isOpen, onClose, month, estado, guardar }: CajonProps) {
  const [fecha, setFecha] = useState(hoyIso());
  const [importe, setImporte] = useState("");
  const [comprobante, setComprobante] = useState("");
  const [intento, setIntento] = useState(false);
  const pendiente = estado.pending;

  useEffect(() => {
    if (!isOpen) return;
    setFecha(hoyIso());
    setImporte(pendiente ? importeParaEntrada(pendiente) : "");
    setComprobante("");
    setIntento(false);
  }, [isOpen, pendiente]);

  const importeNormal = importeDeEntrada(importe);
  const errorFecha = (intento && !fecha ? "Ingresá la fecha del pago." : undefined) ?? mensajeDelCampo(guardar.error, "paidAt");
  const errorImporte =
    (importe.trim() === "" ? (intento ? "Ingresá el importe del pago." : undefined) : importeNormal ? undefined : "El importe debe ser mayor que cero, con hasta dos decimales.") ??
    mensajeDelCampo(guardar.error, "amount");
  const campoDelServidor = Boolean(mensajeDelCampo(guardar.error, "paidAt") || mensajeDelCampo(guardar.error, "amount"));

  const enviar = (event: FormEvent) => {
    event.preventDefault();
    setIntento(true);
    if (!fecha || !importeNormal) return;
    guardar.mutate(
      { month, paidAt: fecha, amount: importeNormal, ...(comprobante.trim() ? { comprobante: comprobante.trim() } : {}) },
      { onSuccess: onClose },
    );
  };

  return (
    <ActionDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Registrar pago de monotributo"
      description={`Cuota de ${etiquetaMes(month)}. Vence el ${formatearFecha(estado.dueDate)}.`}
      footer={
        <ActionDrawerFooter
          primary={<Button type="submit" form="monotributo-pago-form" loading={guardar.isPending}>Registrar pago</Button>}
          onCancel={onClose}
        />
      }
    >
      <form id="monotributo-pago-form" className="study-form study-form--compact" noValidate onSubmit={enviar}>
        <CampoFecha
          id="monotributo-pago-fecha"
          label="Fecha del pago"
          value={fecha}
          onChange={(event) => { setFecha(event.target.value); guardar.reset(); }}
          {...(errorFecha ? { error: errorFecha } : {})}
        />
        <Field
          id="monotributo-pago-importe"
          label="Importe"
          prefix="$"
          inputMode="decimal"
          value={importe}
          onChange={(event) => { setImporte(event.target.value); guardar.reset(); }}
          hint="Con dos decimales si hace falta, por ejemplo 34.530,58."
          {...(errorImporte ? { error: errorImporte } : {})}
        />
        <Field
          id="monotributo-pago-comprobante"
          label="Comprobante (opcional)"
          maxLength={80}
          value={comprobante}
          onChange={(event) => { setComprobante(event.target.value); guardar.reset(); }}
        />
        {campoDelServidor ? null : <MutationError error={guardar.error} />}
      </form>
    </ActionDrawer>
  );
}
