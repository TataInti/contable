import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, EmptyState, Notice } from "@contable/design-system";
import {
  TAX_PANEL_DEFAULT_LOOKBACK_DAYS,
  type TaxPanelResponse,
  type TaxPanelRow,
} from "@contable/contracts";
import { api, type FiscalYear } from "../lib/api";
import { formatCuit } from "../lib/cuit";
import { formatearFecha, formatearPeriodo } from "../lib/formatoFechas";
import { useClientContext } from "../context/ClientContext";
import { useSession } from "../session/SessionContext";
import {
  DenseHeader,
  DenseLoading,
  DensePage,
  DenseTable,
  DenseToggleGroup,
  DenseToolbar,
  StatStrip,
  useDensity,
  type DenseColumn,
  type StatItem,
} from "../ui/Dense";
import { StatusBadge } from "../ui/StatusBadge";
import { CUIT_ENDINGS } from "./clientes/terminacion";
import { abrirClienteDelPanel } from "./panel/abrirCliente";
import {
  PANEL_PAGE_SIZE,
  RESPONSABLE_MIS,
  RESPONSABLE_TODOS,
  escribirFiltros,
  hayFiltrosActivos,
  leerFiltros,
  rutaObligaciones,
  type FiltrosPanel,
} from "./panel/filtros";
import {
  badgeDj,
  conOpcionElegida,
  errorDelPanel,
  indicadoresDelPanel,
  opcionesEstado,
  opcionesResponsable,
  periodosDeFilas,
  sumarDias,
  textoResponsables,
  textoVencimiento,
} from "./panel/presentacion";
import "./study.css";
import "./panel/panel-trabajo.css";

/** Pantalla «Panel de trabajo» (corte 4b): lista global de obligaciones por usuario. Ver DESIGN.md (RG). */

const CAPACIDAD = "tax.settlements.read";
const ROLES_TODO_EL_ESTUDIO = ["OWNER", "ADMIN"];
const MOTIVO_CLAVE = "motivo";
const MOTIVO_SIN_ASIGNACIONES = "sin-asignaciones";

export function StudyPanelTrabajo() {
  const { firmId, capabilities, setClientId, setPeriodId } = useClientContext();
  const session = useSession();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [density] = useDensity();
  const [abriendo, setAbriendo] = useState<string | null>(null);
  const desdeRef = useRef<HTMLInputElement | null>(null);
  const revisionAutomatica = useRef(false);

  const filtros = useMemo(() => leerFiltros(searchParams), [searchParams]);
  const hayFiltros = hayFiltrosActivos(filtros);
  const puedeLeer = capabilities.has(CAPACIDAD);
  const rol = session.me?.firms.find((firma) => firma.firmId === firmId)?.role ?? null;
  const verTodoPorRol = rol !== null && ROLES_TODO_EL_ESTUDIO.includes(rol);
  const propio = session.me?.userId ?? null;

  const consulta = useInfiniteQuery({
    queryKey: ["panel-trabajo", firmId, escribirFiltros(filtros).toString()],
    queryFn: ({ pageParam }) =>
      api.getEnvelope<TaxPanelResponse>(
        rutaObligaciones(firmId ?? "", filtros, { offset: pageParam, limit: PANEL_PAGE_SIZE }),
      ),
    initialPageParam: 0,
    getNextPageParam: (ultima) => {
      const siguiente = ultima.meta.offset + ultima.data.length;
      return ultima.data.length > 0 && siguiente < ultima.meta.total ? siguiente : undefined;
    },
    enabled: puedeLeer && firmId !== null,
  });

  const paginas = consulta.data?.pages ?? [];
  const primeraPagina = paginas[0];
  const ultimaPagina = paginas[paginas.length - 1];
  const filas: TaxPanelRow[] = paginas.flatMap((pagina) => pagina.data);
  const total = ultimaPagina?.meta.total ?? 0;
  const opciones = primeraPagina?.meta.options;

  // S4-6: en la primera carga, OWNER/ADMIN sin obligaciones propias abren en «Todo el estudio»,
  // con el motivo visible en la URL. Después de esa carga, lo que elige la persona manda.
  useEffect(() => {
    if (revisionAutomatica.current || primeraPagina === undefined || consulta.isFetching) return;
    revisionAutomatica.current = true;
    if (
      verTodoPorRol &&
      primeraPagina.meta.total === 0 &&
      !searchParams.has("responsable") &&
      !hayFiltros
    ) {
      setSearchParams(
        new URLSearchParams({
          responsable: RESPONSABLE_TODOS,
          [MOTIVO_CLAVE]: MOTIVO_SIN_ASIGNACIONES,
        }),
        { replace: true },
      );
    }
  }, [
    primeraPagina,
    consulta.isFetching,
    verTodoPorRol,
    searchParams,
    hayFiltros,
    setSearchParams,
  ]);

  const cambiarFiltros = (cambio: (actual: FiltrosPanel) => FiltrosPanel) =>
    setSearchParams(escribirFiltros(cambio(filtros)), { replace: true });
  const quitarFiltros = () => setSearchParams(new URLSearchParams(), { replace: true });

  const abrir = async (fila: TaxPanelRow) => {
    if (firmId === null) return;
    setAbriendo(fila.obligationId);
    try {
      await abrirClienteDelPanel({
        firmId,
        clientId: fila.clientId,
        rango: { periodStart: fila.periodStart, periodEnd: fila.periodEnd },
        cargarAnios: (firma, cliente) =>
          api.get<FiscalYear[]>(`/firms/${firma}/clients/${cliente}/fiscal-years`),
        setClientId,
        setPeriodId,
        navigate: (to) => navigate(to),
      });
    } finally {
      setAbriendo(null);
    }
  };

  const indicadores = indicadoresDelPanel(filas);
  const parcial = filas.length < total;
  const alcance = parcial
    ? `sobre las ${filas.length} filas cargadas`
    : "sobre las filas filtradas";
  const valorIndicador = (numero: number): ReactNode => {
    if (!puedeLeer) return "restringido";
    if (consulta.data !== undefined) return numero;
    return consulta.isError ? "no disponible" : "pendiente";
  };
  const indicadoresItems: StatItem[] = [
    {
      key: "vencidas",
      label: "Vencidas",
      value: valorIndicador(indicadores.vencidas),
      detail: alcance,
    },
    {
      key: "semana",
      label: "Vencen esta semana",
      value: valorIndicador(indicadores.semana),
      detail: alcance,
    },
    {
      key: "sin-legajo",
      label: "Sin legajo",
      value: valorIndicador(indicadores.sinLegajo),
      detail: alcance,
    },
    {
      key: "dj-pendientes",
      label: "DJ pendientes",
      value: valorIndicador(indicadores.djPendientes),
      detail: alcance,
    },
  ];

  const responsables = conOpcionElegida(
    opciones ? opcionesResponsable(opciones.responsables, propio) : [],
    filtros.responsable,
    "Responsable elegido",
  );
  const impuestos = conOpcionElegida(
    opciones?.taxTypes.map((tipo) => ({ value: tipo.id, label: tipo.name })) ?? [],
    filtros.impuesto,
    "Impuesto elegido",
  );
  const periodos = conOpcionElegida(periodosDeFilas(filas), filtros.periodo, "Período elegido");
  const desdeDefecto = primeraPagina
    ? sumarDias(primeraPagina.meta.asOf, -TAX_PANEL_DEFAULT_LOOKBACK_DAYS)
    : "";

  const errorInfo = consulta.isError ? errorDelPanel(consulta.error) : null;
  const avisoError = errorInfo ? (
    <Notice
      tone="error"
      title={errorInfo.titulo}
      action={
        errorInfo.demasiadas ? (
          <Button size="sm" variant="secondary" onClick={() => desdeRef.current?.focus()}>
            Acotar el rango de vencimiento
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => void consulta.refetch()}>
            Reintentar
          </Button>
        )
      }
    >
      {errorInfo.descripcion}
    </Notice>
  ) : null;

  const avisoMotivo =
    verTodoPorRol && searchParams.get(MOTIVO_CLAVE) === MOTIVO_SIN_ASIGNACIONES ? (
      <Notice
        tone="info"
        action={
          <Button size="sm" variant="secondary" onClick={quitarFiltros}>
            Volver a mis obligaciones
          </Button>
        }
      >
        No hay obligaciones asignadas a vos en esta vista: ves todo el estudio por tu rol.
      </Notice>
    ) : null;

  const columnas: DenseColumn<TaxPanelRow>[] = [
    {
      key: "cliente",
      header: "Cliente",
      width: "22%",
      render: (fila) => (
        <>
          <strong>{fila.clientName}</strong>
          <div className="dense-dim">CUIT {formatCuit(fila.cuit)}</div>
        </>
      ),
    },
    {
      key: "impuesto",
      header: "Impuesto",
      width: "16%",
      render: (fila) => (
        <>
          <div>{fila.taxTypeName}</div>
          <div className="dense-dim">{fila.regimeName}</div>
        </>
      ),
    },
    {
      key: "periodo",
      header: "Período",
      width: "11%",
      render: (fila) => formatearPeriodo(fila.periodStart, fila.periodEnd),
    },
    {
      key: "vencimiento",
      header: "Vencimiento",
      width: "13%",
      render: (fila) =>
        fila.dueDate === null ? (
          "Sin vencimiento"
        ) : (
          <>
            <div>{formatearFecha(fila.dueDate)}</div>
            <div className="dense-dim">{textoVencimiento(fila.daysUntilDue)}</div>
          </>
        ),
    },
    {
      key: "legajo-dj",
      header: "Legajo y DJ",
      width: "14%",
      render: (fila) => <StatusBadge {...badgeDj(fila.djState)} variant="plain" />,
    },
    {
      key: "responsable",
      header: "Responsable",
      width: "14%",
      render: (fila) => {
        const texto = textoResponsables(fila.responsables);
        return <span title={texto.detalle ?? undefined}>{texto.texto}</span>;
      },
    },
    {
      key: "accion",
      header: <span className="sr-only">Acciones</span>,
      width: "10%",
      sticky: "right",
      render: (fila) => (
        <Button
          size="sm"
          variant="ghost"
          disabled={abriendo !== null}
          aria-label={`Abrir cliente ${fila.clientName}`}
          onClick={() => void abrir(fila)}
        >
          Abrir cliente
        </Button>
      ),
    },
  ];

  // «Todo el estudio» es una vista, no un criterio: sin otros criterios, un resultado vacío es el confirmado (P1).
  const responsablePuntual =
    filtros.responsable !== RESPONSABLE_MIS && filtros.responsable !== RESPONSABLE_TODOS;
  const hayCriterios =
    responsablePuntual || hayFiltrosActivos({ ...filtros, responsable: RESPONSABLE_MIS });
  const vacio = hayCriterios ? (
    <EmptyState
      size="compact"
      kind="no-results"
      title="Ninguna obligación coincide con los filtros"
      description="Probá con otro responsable, impuesto, estado o rango de vencimiento."
      action={
        <Button size="sm" variant="secondary" onClick={quitarFiltros}>
          Quitar filtros
        </Button>
      }
    />
  ) : (
    <EmptyState
      size="compact"
      kind="no-data"
      title="No hay obligaciones para mostrar"
      description={
        filtros.responsable === RESPONSABLE_MIS
          ? "No tenés obligaciones asignadas en esta vista. Si no tenés clientes asignados, pedí al titular o al administrador del estudio que te los asigne."
          : "No hay obligaciones cargadas en esta vista. Se configuran por cliente en Configuración fiscal."
      }
      action={
        <Button size="sm" variant="secondary" onClick={() => navigate("/configuracion-fiscal")}>
          Configurar obligaciones
        </Button>
      }
    />
  );

  let contenido: ReactNode = null;
  if (!puedeLeer) {
    contenido = (
      <EmptyState
        kind="no-data"
        title="Sin acceso al panel de trabajo"
        description="Tu rol no incluye la lectura de obligaciones fiscales del estudio."
      />
    );
  } else if (consulta.isLoading) {
    contenido = <DenseLoading label="Cargando el panel de trabajo…" />;
  } else if (consulta.data !== undefined) {
    contenido = (
      <DenseTable<TaxPanelRow>
        label="Panel de trabajo"
        surface="integrated"
        columns={columnas}
        rows={filas}
        rowKey={(fila) => fila.obligationId}
        empty={vacio}
        footer={
          <>
            <span>
              {filas.length} de {total} {total === 1 ? "obligación" : "obligaciones"}
            </span>
            {consulta.hasNextPage ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={consulta.isFetchingNextPage}
                onClick={() => void consulta.fetchNextPage()}
              >
                Cargar más
              </Button>
            ) : null}
            {consulta.isFetching && !consulta.isLoading ? (
              <span role="status">Actualizando…</span>
            ) : null}
          </>
        }
      />
    );
  }

  return (
    <DensePage density={density}>
      <DenseHeader
        title="Panel de trabajo"
        description="Qué vence, en qué estado está cada legajo y qué DJ falta, en los clientes que podés ver."
        actions={
          <Button
            size="sm"
            variant="secondary"
            disabled={!puedeLeer}
            onClick={() => void consulta.refetch()}
          >
            Actualizar
          </Button>
        }
      />
      <StatStrip label="Indicadores del panel de trabajo" items={indicadoresItems} />
      <DenseToolbar>
        {filtros.responsable === RESPONSABLE_MIS ? (
          <Button
            size="sm"
            variant="secondary"
            className="dense-chip"
            aria-label="Quitar el filtro Mis obligaciones"
            onClick={() =>
              cambiarFiltros((actual) => ({ ...actual, responsable: RESPONSABLE_TODOS }))
            }
          >
            Mis obligaciones ×
          </Button>
        ) : null}
        <span className="dense-dim">Responsable</span>
        <select
          className="dense-select"
          aria-label="Responsable"
          value={filtros.responsable}
          onChange={(evento) =>
            cambiarFiltros((actual) => ({ ...actual, responsable: evento.target.value }))
          }
        >
          <option value={RESPONSABLE_MIS}>Mis obligaciones</option>
          <option value={RESPONSABLE_TODOS}>Todo el estudio</option>
          {responsables.map((opcion) => (
            <option key={opcion.value} value={opcion.value}>
              {opcion.label}
            </option>
          ))}
        </select>
        <span className="dense-dim">Terminación de CUIT</span>
        <DenseToggleGroup
          label="Terminación de CUIT"
          options={CUIT_ENDINGS.map((digito) => ({ value: digito, label: digito }))}
          selected={filtros.terminacion}
          onChange={(siguiente) =>
            cambiarFiltros((actual) => ({ ...actual, terminacion: siguiente }))
          }
        />
        <span className="dense-dim">Impuesto</span>
        <select
          className="dense-select"
          aria-label="Impuesto"
          value={filtros.impuesto}
          onChange={(evento) =>
            cambiarFiltros((actual) => ({ ...actual, impuesto: evento.target.value }))
          }
        >
          <option value="">Impuesto: todos</option>
          {impuestos.map((opcion) => (
            <option key={opcion.value} value={opcion.value}>
              {opcion.label}
            </option>
          ))}
        </select>
        <span className="dense-dim">Estado</span>
        <select
          className="dense-select"
          aria-label="Estado"
          value={filtros.estado}
          onChange={(evento) =>
            cambiarFiltros((actual) => ({ ...actual, estado: evento.target.value }))
          }
        >
          <option value="">Estado: todos</option>
          {opcionesEstado().map((opcion) => (
            <option key={opcion.value} value={opcion.value}>
              {opcion.label}
            </option>
          ))}
        </select>
        <span className="dense-dim">Período fiscal</span>
        <select
          className="dense-select"
          aria-label="Período fiscal"
          value={filtros.periodo}
          onChange={(evento) =>
            cambiarFiltros((actual) => ({ ...actual, periodo: evento.target.value }))
          }
        >
          <option value="">Período: todos</option>
          {periodos.map((opcion) => (
            <option key={opcion.value} value={opcion.value}>
              {opcion.label}
            </option>
          ))}
        </select>
        <label className="ds-field">
          <span className="ds-field__label">Vencimiento desde</span>
          <input
            ref={desdeRef}
            className="ds-field__input"
            type="date"
            value={filtros.desde !== "" ? filtros.desde : desdeDefecto}
            onChange={(evento) =>
              cambiarFiltros((actual) => ({ ...actual, desde: evento.target.value }))
            }
          />
        </label>
        <label className="ds-field">
          <span className="ds-field__label">Vencimiento hasta</span>
          <input
            className="ds-field__input"
            type="date"
            value={filtros.hasta}
            onChange={(evento) =>
              cambiarFiltros((actual) => ({ ...actual, hasta: evento.target.value }))
            }
          />
        </label>
        {hayFiltros ? (
          <Button size="sm" variant="ghost" onClick={quitarFiltros}>
            Quitar filtros
          </Button>
        ) : null}
      </DenseToolbar>
      {avisoError}
      {avisoMotivo}
      {contenido}
    </DensePage>
  );
}
