import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { cajaFiscalDataSchema } from "@contable/contracts";
import {
  AsyncState,
  Button,
  EmptyState,
  Notice,
  StatusBadge,
  Table,
  type TableColumn,
} from "@contable/design-system";
import { useClientContext } from "../../context/ClientContext";
import { ApiError, api, type FiscalYear } from "../../lib/api";
import { formatearMes } from "../../lib/formatoFechas";
import { abrirClienteDelPanel } from "../panel/abrirCliente";

/*
 * Saldo de caja fiscal en Rentabilidad (corte 8b). Bloque fiscal propio, debajo del resultado
 * gerencial (A10 D7C-8 a) y separado de Devengado y Caja (A25 decisión 3). Lee el cálculo en vivo
 * GET …/profitability/caja-fiscal (corte 8a). COMPLETO: cifra. PARCIAL: sin cifra, con las DJ que
 * faltan y el enlace al Legajo (A13 D13-3 a). SIN_DATOS: el motivo, nunca un cero.
 */

// La forma de `data` sale del contrato (cajaFiscalDataSchema): no se duplica a mano.
type Datos = (typeof cajaFiscalDataSchema)["_output"];
type Faltante = Datos["faltantes"][number];
type Desglose = NonNullable<Datos["desglose"]>;

// StatusBadge toma el tono (ok, aviso, neutro) de la clave del catálogo; el rótulo va en `label`.
const ESTADO: Record<Datos["estado"], { status: string; label: string }> = {
  COMPLETO: { status: "COMPLETED", label: "Completo" },
  PARCIAL: { status: "PENDING", label: "Parcial" },
  SIN_DATOS: { status: "NOT_APPLICABLE", label: "Sin datos" },
};

const formatoPesos = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });
const pesos = (valor: string) => formatoPesos.format(Number(valor));
const nombresRegimen: Record<string, string> = {
  IIBB_LOCAL_TUC: "Ingresos Brutos Tucumán",
  TEM_SMT: "Tributo Económico Municipal",
  IVA_GENERAL: "IVA",
  CONVENIO_MULTILATERAL: "Ingresos Brutos Convenio Multilateral",
};
const mesFiscal = (periodo: string) => {
  const match = /^(\d{2})\/(\d{4})$/.exec(periodo);
  return match ? formatearMes(`${match[2]}-${match[1]}-01`) : periodo;
};
const etiqueta = (f: Faltante) => `${nombresRegimen[f.regimen] ?? f.impuesto} · ${mesFiscal(f.periodo)}`;

interface Fila {
  clave: string;
  concepto: string;
  detalle: string;
  importe: string;
}

function filasDesglose(datos: Datos, d: Desglose): Fila[] {
  const total = d.impuestos.length + datos.faltantes.length;
  const filas: Fila[] = [
    {
      clave: "ventas",
      concepto: "Ventas con IVA",
      detalle: `Comprobantes aprobados: ${datos.comprobantes.ventas}`,
      importe: d.ventasConIva,
    },
    {
      clave: "compras",
      concepto: "Compras con IVA (se restan)",
      detalle: `Comprobantes aprobados: ${datos.comprobantes.compras}`,
      importe: d.comprasConIva,
    },
    {
      clave: "impuestos",
      concepto: "Impuestos según declaración jurada (se restan)",
      detalle: `Declaraciones juradas cargadas: ${d.impuestos.length} de ${total}`,
      importe: d.totalImpuestos,
    },
  ];
  for (const i of d.impuestos) {
    // S-8.4: con total a pagar ≤ 0 la declaración no deduce nada.
    const nota = Number(i.totalAPagar) > 0 ? "" : ": no deduce";
    filas.push({
      clave: i.presentacionId,
      concepto: etiqueta(i),
      detalle: `Total a pagar ${pesos(i.totalAPagar)}${nota}`,
      importe: i.deduccion,
    });
  }
  return filas;
}

const COLUMNAS: TableColumn<Fila>[] = [
  { key: "concepto", header: "Concepto", render: (f) => f.concepto },
  { key: "detalle", header: "Detalle", render: (f) => f.detalle },
  { key: "importe", header: "Importe", align: "right", render: (f) => pesos(f.importe) },
];

interface Props {
  periodo: { id: string; startDate: string; endDate: string };
}

export function CajaFiscal({ periodo }: Props) {
  const { firmId, clientId, setClientId, setPeriodId, capabilities } = useClientContext();
  const navigate = useNavigate();
  const consulta = useQuery({
    queryKey: ["caja-fiscal", firmId, clientId, periodo.id],
    queryFn: () =>
      api.get<Datos>(
        `/firms/${firmId}/clients/${clientId}/profitability/caja-fiscal?periodId=${encodeURIComponent(periodo.id)}`,
      ),
    enabled: Boolean(firmId && clientId && periodo.id),
    retry: false, // el error muestra el motivo y «Reintentar»; no reintenta solo
  });
  const datos = consulta.data;

  const abrirLegajo = async () => {
    if (!firmId || !clientId) return;
    // Mismo destino que «Abrir cliente» del Panel: el Legajo del período contable equivalente.
    await abrirClienteDelPanel({
      firmId,
      clientId,
      rango: { periodStart: periodo.startDate, periodEnd: periodo.endDate },
      cargarAnios: (f, c) => api.get<FiscalYear[]>(`/firms/${f}/clients/${c}/fiscal-years`),
      setClientId,
      setPeriodId,
      navigate: (to) => navigate(to),
    });
  };

  return (
    <section className="caja-fiscal" aria-labelledby="caja-fiscal-titulo">
      <header className="caja-fiscal__header">
        <div>
          <h3 id="caja-fiscal-titulo" className="caja-fiscal__title">
            Saldo fiscal del mes
          </h3>
          <p className="caja-fiscal__meta">
            {datos ? `Período fiscal ${mesFiscal(datos.periodo.etiqueta)} · ` : ""}
            Cálculo fiscal independiente del flujo de caja
          </p>
        </div>
        {datos ? (
          <StatusBadge status={ESTADO[datos.estado].status} label={ESTADO[datos.estado].label} />
        ) : null}
      </header>

      <AsyncState
        loading={consulta.isLoading}
        error={consulta.isError}
        loadingLabel="Calculando el saldo fiscal…"
        errorTitle="No se pudo calcular el saldo fiscal"
        errorDescription={
          consulta.error instanceof ApiError ? consulta.error.message : "Reintentá en unos minutos."
        }
        onRetry={() => void consulta.refetch()}
      />

      {datos?.estado === "COMPLETO" && datos.cifra !== null ? (
        <>
          <p className="caja-fiscal__cifra">{pesos(datos.cifra)}</p>
          <p className="caja-fiscal__meta">
            Ventas con IVA, menos compras con IVA, menos impuestos según declaración jurada.
          </p>
        </>
      ) : null}

      {datos?.estado === "PARCIAL" ? (
        <Notice
          tone="warning"
          title={
            datos.faltantes.length === 1
              ? "Falta cargar 1 declaración jurada"
              : `Faltan cargar ${datos.faltantes.length} declaraciones juradas`
          }
          action={
            capabilities.has("tax.settlements.read") ? (
              <Button size="sm" variant="secondary" onClick={() => void abrirLegajo()}>
                Abrir el Legajo
              </Button>
            ) : undefined
          }
        >
          <p>Sin ellas no hay cifra final. Cargalas en el Legajo del período:</p>
          <ul className="caja-fiscal__faltantes">
            {datos.faltantes.map((f) => (
              <li key={etiqueta(f)}>{etiqueta(f)}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {datos?.estado === "SIN_DATOS" ? (
        <EmptyState
          size="compact"
          title="Sin datos para calcular el saldo fiscal"
          description={`No hay comprobantes aprobados de ventas ni de compras en el período ${mesFiscal(datos.periodo.etiqueta)}. No se muestra un cero: no hay base para calcular.`}
        />
      ) : null}

      {datos?.desglose ? (
        <Table<Fila>
          aria-label="Desglose del saldo fiscal"
          columns={COLUMNAS}
          rows={filasDesglose(datos, datos.desglose)}
          rowKey={(f) => f.clave}
        />
      ) : null}

      {datos?.desglose && datos.cifra !== null ? (
        <p className="caja-fiscal__total">Total del saldo fiscal: <strong>{pesos(datos.cifra)}</strong></p>
      ) : null}

      {datos ? (
        <p className="caja-fiscal__meta">
          Cálculo en vivo: no se publica y el portal del cliente no lo muestra.
        </p>
      ) : null}
    </section>
  );
}
