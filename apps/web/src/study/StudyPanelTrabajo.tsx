import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, EmptyState, Notice, SearchSelect } from "@contable/design-system";
import {
  TAX_PANEL_DEFAULT_LOOKBACK_DAYS,
  type TaxPanelResponse,
  type TaxPanelRow,
} from "@contable/contracts";
import { api } from "../lib/api";
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
import { abrirLegajoDeObligacion } from "./panel/abrirCliente";
import {
  MENSAJE_RANGO_INVERTIDO,
  PANEL_PAGE_SIZE,
  RESPONSABLE_MIS,
  RESPONSABLE_TODOS,
  esRangoValido,
  escribirFiltros,
  hayFiltrosActivos,
  leerFiltros,
  rutaObligaciones,
  type FiltrosPanel,
} from "./panel/filtros";
import {
  badgeDj,
  calificadorDelConteo,
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
const ID_RANGO = "panel-trabajo-rango-error";
const ID_MAS_FILTROS = "panel-trabajo-mas-filtros";

export function StudyPanelTrabajo() {
  const { firmId, capabilities, setClientId, clientId } = useClientContext();
  const session = useSession();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [density] = useDensity();
  const desdeRef = useRef<HTMLInputElement | null>(null);
  const revisionAutomatica = useRef(false);

  const filtros = useMemo(() => leerFiltros(searchParams), [searchParams]);
  const hayFiltros = hayFiltrosActivos(filtros);
  const puedeLeer = capabilities.has(CAPACIDAD);
  const rol = session.me?.firms.find((firma) => firma.firmId === firmId)?.role ?? null;
  const verTodoPorRol = rol !== null && ROLES_TODO_EL_ESTUDIO.includes(rol);
  const propio = session.me?.userId ?? null;

  // Hallazgo 58: el rango se valida en el cliente con el «desde» que muestra la pantalla. La fecha
  // de referencia de la API llega con la primera respuesta.
  const [asOfConocido, setAsOfConocido] = useState<string | null>(null);
  const desdeVigente =
    filtros.desde !== ""
      ? filtros.desde
      : asOfConocido !== null
        ? sumarDias(asOfConocido, -TAX_PANEL_DEFAULT_LOOKBACK_DAYS)
        : "";
  const rangoValido = esRangoValido(desdeVigente, filtros.hasta);
  // Con un rango inválido se sigue mostrando el último resultado válido; si no hubo ninguno, la vista inicial (sin fechas).
  const [ultimoValido, setUltimoValido] = useState<FiltrosPanel>(() =>
    rangoValido ? filtros : { ...filtros, desde: "", hasta: "" },
  );
  if (
    rangoValido &&
    escribirFiltros(ultimoValido).toString() !== escribirFiltros(filtros).toString()
  ) {
    setUltimoValido(filtros);
  }
  const consultaFiltros = rangoValido ? filtros : ultimoValido;
  // 06-3: terminación y fechas viven en «Más filtros»; abre solo si ya hay un criterio ahí.
  const [masFiltros, setMasFiltros] = useState(
    () => filtros.terminacion.length > 0 || filtros.desde !== "" || filtros.hasta !== "",
  );

  const consulta = useInfiniteQuery({
    queryKey: ["panel-trabajo", firmId, escribirFiltros(consultaFiltros).toString()],
    queryFn: ({ pageParam }) =>
      api.getEnvelope<TaxPanelResponse>(
        rutaObligaciones(firmId ?? "", consultaFiltros, {
          offset: pageParam,
          limit: PANEL_PAGE_SIZE,
        }),
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
  const asOfRespuesta = primeraPagina?.meta.asOf;
  useEffect(() => {
    if (asOfRespuesta !== undefined) setAsOfConocido(asOfRespuesta);
  }, [asOfRespuesta]);

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

  const abrir = (fila: TaxPanelRow) => {
    if (firmId === null) return;
    abrirLegajoDeObligacion({
      firmId,
      clientId: fila.clientId,
      taxPeriodId: fila.periodId,
      setClientId,
      navigate: (to) => navigate(to),
    });
  };

  const indicadores = indicadoresDelPanel(filas);
  const parcial = filas.length < total;
  const valorIndicador = (numero: number): ReactNode => {
    if (!puedeLeer) return "restringido";
    if (consulta.data !== undefined) return numero;
    return consulta.isError ? "no disponible" : "pendiente";
  };
  // 06-6: los contadores son filtros. «Vencidas» y «Vencen esta semana» acotan el vencimiento
  // respecto de la fecha de referencia de la API; los otros dos filtran por estado.
  const hoy = asOfConocido;
  const rangoVencidas = hoy !== null ? { desde: "", hasta: sumarDias(hoy, -1) } : null;
  const rangoSemana = hoy !== null ? { desde: hoy, hasta: sumarDias(hoy, 7) } : null;
  const filtroSinFechas = (actual: FiltrosPanel): FiltrosPanel => ({ ...actual, desde: "", hasta: "" });
  const conRango = (rango: { desde: string; hasta: string } | null): Pick<StatItem, "pressed" | "onSelect"> =>
    !puedeLeer || rango === null
      ? {}
      : {
          pressed: filtros.desde === rango.desde && filtros.hasta === rango.hasta,
          onSelect: () =>
            cambiarFiltros((actual) =>
              actual.desde === rango.desde && actual.hasta === rango.hasta
                ? filtroSinFechas(actual)
                : { ...actual, estado: "", ...rango },
            ),
        };
  const conEstado = (estado: string): Pick<StatItem, "pressed" | "onSelect"> =>
    puedeLeer
      ? {
          pressed: filtros.estado === estado,
          onSelect: () =>
            cambiarFiltros((actual) => ({
              ...actual,
              estado: actual.estado === estado ? "" : estado,
            })),
        }
      : {};
  const indicadoresItems: StatItem[] = [
    {
      key: "vencidas",
      label: "Vencidas",
      value: valorIndicador(indicadores.vencidas),
      ...conRango(rangoVencidas),
    },
    {
      key: "semana",
      label: "Vencen esta semana",
      value: valorIndicador(indicadores.semana),
      ...conRango(rangoSemana),
    },
    {
      key: "sin-legajo",
      label: "Sin legajo",
      value: valorIndicador(indicadores.sinLegajo),
      ...conEstado("SIN_LEGAJO"),
    },
    {
      key: "dj-pendientes",
      label: "DJ pendientes",
      value: valorIndicador(indicadores.djPendientes),
      ...conEstado("DJ_PENDIENTE"),
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
          <Button size="sm" variant="secondary" onClick={() => {
              flushSync(() => setMasFiltros(true));
              desdeRef.current?.focus();
            }}>
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

  // 06-5: una línea de texto neutro; «Volver a mis obligaciones» es el valor «Mis obligaciones» del filtro Responsable.
  const avisoMotivo =
    verTodoPorRol && searchParams.get(MOTIVO_CLAVE) === MOTIVO_SIN_ASIGNACIONES ? (
      <p className="dense-dim">
        No hay obligaciones asignadas a vos en esta vista: ves todo el estudio por tu rol.
      </p>
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
            <div
              className={
                fila.daysUntilDue !== null && fila.daysUntilDue < 0
                  ? "panel-trabajo__vencida"
                  : "dense-dim"
              }
            >
              {textoVencimiento(fila.daysUntilDue)}
            </div>
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
      header: "Acciones",
      width: "11%",
      sticky: "right",
      render: (fila) => (
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Abrir legajo ${fila.clientName}`}
          onClick={() => abrir(fila)}
        >
          Abrir legajo
        </Button>
      ),
    },
  ];

  // «Todo el estudio» es una vista, no un criterio: sin otros criterios, un resultado vacío es el confirmado (P1).
  const responsablePuntual =
    filtros.responsable !== RESPONSABLE_MIS && filtros.responsable !== RESPONSABLE_TODOS;
  const hayCriterios =
    responsablePuntual || hayFiltrosActivos({ ...filtros, responsable: RESPONSABLE_MIS });
  // Hallazgo 69: «Configurar obligaciones» lleva a Configuración fiscal, que exige un cliente elegido.
  const aclaracionCliente = clientId
    ? ""
    : " Elegí un cliente en el menú para configurar sus obligaciones.";
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
          ? `No tenés obligaciones asignadas en esta vista. Si no tenés clientes asignados, pedí al titular o al administrador del estudio que te los asigne.${aclaracionCliente}`
          : `No hay obligaciones cargadas en esta vista. Se configuran por cliente en Configuración fiscal.${aclaracionCliente}`
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
        onSelect={(clave) => {
          const fila = filas.find((item) => item.obligationId === clave);
          if (fila) abrir(fila);
        }}
        empty={vacio}
        footer={
          consulta.hasNextPage || paginas.length > 1 || (consulta.isFetching && !consulta.isLoading) ? (
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
          ) : undefined
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
      {hayCriterios || parcial ? (
        <p className="dense-dim">
          {parcial
            ? calificadorDelConteo(filas.length, "cargadas")
            : calificadorDelConteo(total, "filtradas")}
        </p>
      ) : null}
      <StatStrip label="Indicadores del panel de trabajo" items={indicadoresItems} />
      <DenseToolbar>
        <div className="panel-trabajo__fila">
          <div className="panel-trabajo__filtro panel-trabajo__filtro--responsable">
            <SearchSelect
              hideLabel
              label="Responsable"
              className="dense-select"
              value={filtros.responsable}
              onChange={(value) => cambiarFiltros((actual) => ({ ...actual, responsable: value }))}
              allowEmpty={false}
              options={[
                { value: RESPONSABLE_MIS, label: "Responsable: Mis obligaciones" },
                { value: RESPONSABLE_TODOS, label: "Responsable: Todo el estudio" },
                ...responsables.map((opcion) => ({ value: opcion.value, label: `Responsable: ${opcion.label}` })),
              ]}
            />
          </div>
          <div className="panel-trabajo__filtro panel-trabajo__filtro--impuesto">
            <SearchSelect
              hideLabel
              label="Impuesto"
              className="dense-select"
              value={filtros.impuesto}
              onChange={(value) => cambiarFiltros((actual) => ({ ...actual, impuesto: value }))}
              placeholder="Impuesto: todos"
              options={impuestos.map((opcion) => ({ value: opcion.value, label: `Impuesto: ${opcion.label}` }))}
            />
          </div>
          <div className="panel-trabajo__filtro panel-trabajo__filtro--estado">
            <SearchSelect
              hideLabel
              label="Estado"
              className="dense-select"
              value={filtros.estado}
              onChange={(value) => cambiarFiltros((actual) => ({ ...actual, estado: value }))}
              placeholder="Estado: todos"
              options={opcionesEstado().map((opcion) => ({ value: opcion.value, label: `Estado: ${opcion.label}` }))}
            />
          </div>
          <div className="panel-trabajo__filtro panel-trabajo__filtro--periodo">
            <SearchSelect
              hideLabel
              label="Período fiscal"
              className="dense-select"
              value={filtros.periodo}
              onChange={(value) => cambiarFiltros((actual) => ({ ...actual, periodo: value }))}
              placeholder="Período fiscal: todos"
              options={periodos.map((opcion) => ({ value: opcion.value, label: `Período fiscal: ${opcion.label}` }))}
            />
          </div>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={masFiltros}
            aria-controls={ID_MAS_FILTROS}
            onClick={() => setMasFiltros((abierto) => !abierto)}
          >
            Más filtros
          </Button>
          {hayFiltros ? (
            <Button size="sm" variant="ghost" onClick={quitarFiltros}>
              Quitar filtros
            </Button>
          ) : null}
        </div>
        <div className="panel-trabajo__fila" id={ID_MAS_FILTROS} hidden={!masFiltros}>
          <div className="panel-trabajo__filtro panel-trabajo__filtro--terminacion">
            <span className="dense-dim">Terminación de CUIT</span>
            <DenseToggleGroup
              label="Terminación de CUIT"
              options={CUIT_ENDINGS.map((digito) => ({ value: digito, label: digito }))}
              selected={filtros.terminacion}
              onChange={(siguiente) =>
                cambiarFiltros((actual) => ({ ...actual, terminacion: siguiente }))
              }
            />
          </div>
          <div className="panel-trabajo__fechas">
            <div className="panel-trabajo__fechas-campos">
              <label className="ds-field panel-trabajo__filtro">
                <span className="ds-field__label">Vencimiento desde</span>
                <input
                  ref={desdeRef}
                  className="ds-field__input"
                  type="date"
                  aria-invalid={rangoValido ? undefined : true}
                  aria-describedby={rangoValido ? undefined : ID_RANGO}
                  value={filtros.desde !== "" ? filtros.desde : desdeDefecto}
                  onChange={(evento) =>
                    cambiarFiltros((actual) => ({ ...actual, desde: evento.target.value }))
                  }
                />
              </label>
              <label className="ds-field panel-trabajo__filtro">
                <span className="ds-field__label">Vencimiento hasta</span>
                <input
                  className="ds-field__input"
                  type="date"
                  aria-invalid={rangoValido ? undefined : true}
                  aria-describedby={rangoValido ? undefined : ID_RANGO}
                  value={filtros.hasta}
                  onChange={(evento) =>
                    cambiarFiltros((actual) => ({ ...actual, hasta: evento.target.value }))
                  }
                />
              </label>
            </div>
            {rangoValido ? null : (
              <span className="ds-field__error" id={ID_RANGO}>
                {MENSAJE_RANGO_INVERTIDO}
              </span>
            )}
          </div>
        </div>
      </DenseToolbar>
      {avisoError}
      {avisoMotivo}
      {contenido}
    </DensePage>
  );
}
