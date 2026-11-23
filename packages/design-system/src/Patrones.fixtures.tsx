/*
 * Fixtures de demostración de los patrones DS-0 (C10–C16). Datos inventados y rotulados como
 * sintéticos. Los usan las pruebas y las capturas de DS-0; no son pantallas de la aplicación.
 */
import { useState } from "react";
import "./Patrones.fixtures.css";
import { Button } from "./Button.js";
import {
  DecisionBar,
  DocumentFields,
  DocumentTriage,
  DocumentViewer,
  NextDocumentButton,
  type DocumentField,
} from "./DocumentTriage.js";
import { EmptyState } from "./EmptyState.js";
import { DenseSection, DenseToolbar, StatStrip } from "./Dense.js";
import { Field } from "./Field.js";
import {
  ObjectActivity,
  ObjectActivityTrigger,
  type ObjectActivityEntry,
} from "./ObjectActivity.js";
import { ObjectPage } from "./ObjectPage.js";
import { ObjectPanel, withObjectPanel, withoutObjectPanel } from "./ObjectPanel.js";
import { MonthSummary } from "./MonthSummary.js";
import { StatusBadge } from "./StatusBadge.js";
import { StepFlow, type FlowStep } from "./StepFlow.js";
import { Table, TableCellStack, type TableColumn } from "./Table.js";
import { WorkQueue, WorkQueueRow } from "./WorkQueue.js";
import { MarcoTrabajo } from "./MarcoTrabajo.js";

interface ControlSintetico {
  id: string;
  titulo: string;
  decision: string;
  contexto: string;
  estado: string;
  fecha?: string;
  importe: string;
}

const controles: ControlSintetico[] = [
  {
    id: "1",
    titulo: "Facturas C: 2 comprobantes",
    decision: "El tipo informado no coincide con el perfil fiscal.",
    contexto: "Control · octubre de 2026",
    estado: "BLOCKING",
    importe: "2 comprobantes",
  },
  {
    id: "2",
    titulo: "Acreditaciones bancarias vs. facturación",
    decision: "Hay $125.000,00 sin conciliar con ventas.",
    contexto: "Control · octubre de 2026",
    estado: "BLOCKING",
    importe: "$125.000,00",
  },
];

const actividadControl: ObjectActivityEntry[] = [
  { id: "h-1", kind: "historial", at: "04/11/2026 09:29 · admin", text: "Pidió confirmar las diferencias antes de cerrar." },
  { id: "h-2", kind: "historial", at: "04/11/2026 09:12 · Titular", text: "Revisó el lote de percepciones IIBB." },
  { id: "h-3", kind: "historial", at: "03/11/2026 16:41 · Sistema", text: "Se recalculó la liquidación con 3 percepciones." },
];

/** Cola de controles con el panel de detalle abierto: filas de 48 px y panel compacto. */
export function ControlesPanelDemo({ initiallyOpen = false }: { initiallyOpen?: boolean } = {}) {
  const [abierto, setAbierto] = useState<ControlSintetico | null>(initiallyOpen ? controles[0] ?? null : null);
  const [origen, setOrigen] = useState<HTMLElement | null>(null);
  const [urlActual, setUrlActual] = useState("/clientes/1/legajo/2026-10/controles");
  const [actividad, setActividad] = useState(actividadControl);

  const abrir = (control: ControlSintetico, elemento: HTMLElement) => {
    setOrigen(elemento);
    setAbierto(control);
    setUrlActual(withObjectPanel("/clientes/1/legajo/2026-10/controles", "control", control.id));
  };
  const cerrar = () => {
    setAbierto(null);
    setUrlActual(withoutObjectPanel(urlActual));
  };

  return (
    <div className="patrones-demo">
      <p className="patrones-demo__url">{urlActual}</p>
      <WorkQueue label="Controles bloqueantes">
        {controles.map((control) => (
          <WorkQueueRow
            key={control.id}
            id={control.id}
            title={control.titulo}
            decision={control.decision}
            subtitle={control.contexto}
            status={control.estado}
            {...(control.fecha ? { date: control.fecha } : {})}
            amount={control.importe}
            onOpen={() => abrir(control, document.activeElement as HTMLElement)}
          />
        ))}
      </WorkQueue>
      <ObjectPanel
        kind="control"
        isOpen={abierto !== null}
        onClose={cerrar}
        title={abierto?.titulo ?? "Control"}
        {...(abierto ? { description: "Control · octubre de 2026" } : {})}
        returnFocusTo={origen}
        primaryAction={
          <Button type="button" variant="primary" onClick={cerrar}>
            Guardar decisión
          </Button>
        }
      >
        <>
          {abierto ? <p>{abierto.decision}</p> : null}
          {abierto ? <div className="patrones-demo__fact"><span>Estado</span><StatusBadge status={abierto.estado} /></div> : null}
          {abierto?.id === "1" ? (
            <>
              <DenseSection title="Comprobantes afectados">
                <WorkQueue label="Comprobantes afectados" density="compact">
                  <WorkQueueRow id="C 000101" title="C 000101" decision="03/10/2026" amount="$ 18.000,00" onOpen={() => undefined} />
                  <WorkQueueRow id="C 000116" title="C 000116" decision="18/10/2026" amount="$ 59.250,00" onOpen={() => undefined} />
                </WorkQueue>
              </DenseSection>
              <DenseSection title="Resolver este control">
                <div className="patrones-demo__decisiones" role="group" aria-label="Acciones para resolver">
                  <Button type="button" variant="secondary">Aceptar con motivo</Button>
                  <Button type="button" variant="secondary">Excluir del cálculo con motivo</Button>
                  <Button type="button" variant="text">Ir a Configuración fiscal para tildar el tipo</Button>
                </div>
                <label className="patrones-demo__motivo"><span className="ds-text-help">Motivo</span><textarea className="dense-textarea" aria-label="Motivo de la decisión" placeholder="Escribí el motivo" /></label>
              </DenseSection>
            </>
          ) : null}
          <DenseSection title="Actividad del control">
            <ObjectActivity
              label="Actividad del control"
              entries={actividad}
              onSubmitComment={(texto) => setActividad((previa) => [...previa, { id: `c-${previa.length + 1}`, kind: "comentario", at: "23/11/2026 08:00", author: "Persona sintética", text: texto }])}
            />
          </DenseSection>
        </>
      </ObjectPanel>
    </div>
  );
}

/** Lista de controles del estado de referencia, compuesta con WorkQueue. */
export function ControlesListaDemo() {
  return (
    <div className="patrones-demo">
      <DenseSection title="Controles que requieren una decisión" description="2 abiertos" actions={<Button type="button" variant="text">Ver actividad</Button>}>
        <WorkQueue label="Controles que requieren una decisión">
          {controles.map((control) => (
            <WorkQueueRow key={control.id} id={control.id} title={control.titulo} decision={control.decision} status={control.estado} amount={control.importe} actionLabel="Revisar" onOpen={() => undefined} />
          ))}
        </WorkQueue>
      </DenseSection>
      <DenseSection title="Historial" description="6 controles resueltos" actions={<Button type="button" variant="text">Abrir actividad</Button>}><div /></DenseSection>
    </div>
  );
}

interface FilaClasificacion { id: string; emisor: string; fecha: string; importe: string; estado: string }
const filasClasificacion: FilaClasificacion[] = Array.from({ length: 12 }, (_, index) => ({
  id: `C ${String(101 + index).padStart(6, "0")}`,
  emisor: ["Almacén Norte", "Bodega Los Cerros", "Proveedor Tucumán", "Mayorista NOA"][index % 4]!,
  fecha: `${String(index + 1).padStart(2, "0")}/10/2026`,
  importe: `$ ${ (18000 + index * 2750).toLocaleString("es-AR", { minimumFractionDigits: 2 }) }`,
  estado: index < 6 ? "NEEDS_REVIEW" : "READY",
}));
const columnasClasificacion: TableColumn<FilaClasificacion>[] = [
  { key: "comprobante", header: "Comprobante", render: (row) => <TableCellStack primary={<strong>{row.id}</strong>} secondary="Venta · actividad Restaurante" /> },
  { key: "emisor", header: "Emisor", render: (row) => row.emisor },
  { key: "fecha", header: "Fecha", render: (row) => row.fecha },
  { key: "importe", header: "Importe", align: "right", render: (row) => row.importe },
  { key: "estado", header: "Estado", render: (row) => <StatusBadge status={row.estado} label={row.estado === "NEEDS_REVIEW" ? "Revisar" : "Clasificado"} /> },
];

/** Clasificación con los mismos doce comprobantes visibles que el demo. */
export function ClasificacionDemo() {
  return (
    <div className="patrones-demo">
      <DenseToolbar split>
        <Field aria-label="Buscar comprobante" placeholder="Buscar comprobante" />
        <span className="ds-text-help">6 para revisar</span>
      </DenseToolbar>
      <DenseSection title="Clasificación" description="Revisá y clasificá los comprobantes del período." actions={<Button type="button" variant="secondary">Acciones por lote</Button>}>
        <Table columns={columnasClasificacion} rows={filasClasificacion} rowKey={(row) => row.id} />
      </DenseSection>
      <p className="ds-text-help">Mostrando 12 de 40 comprobantes sintéticos.</p>
    </div>
  );
}

/** Portada del Legajo: qué falta, qué está listo e importe estimado (datos sintéticos). */
export function PortadaDemo() {
  return (
    <div className="patrones-demo">
      <MonthSummary
        title="Lo relevante para cerrar octubre"
        dueLabel="Vence el 20/11/2026 · revisión 1"
        pending={[]}
        ready={[]}
        estimatedAmount="$ 48.450,00"
        estimateNote=""
        taxes={[
          { id: "ibb", label: "Ingresos Brutos · Tucumán", detail: "Liquidación estimada", status: "NEEDS_REVIEW", amount: "$ 48.450,00" },
          { id: "tem", label: "Tasa de Comercio · San Miguel", detail: "Sin saldo a ingresar", status: "READY", amount: "$ 0,00" },
        ]}
        alerts={[
          { id: "controles", label: "2 controles bloquean el cierre", detail: "Facturas C y acreditaciones bancarias", status: "BLOCKING", action: "Revisar", href: "#controles" },
          { id: "triage", label: "4 comprobantes esperan triage", detail: "Datos extraídos para confirmar", status: "NEEDS_REVIEW", action: "Abrir", href: "#triage" },
        ]}
        steps={[
          { key: "fuentes", label: "Fuentes", status: "done", reason: "40 comprobantes y 3 percepciones" },
          { key: "clasificacion", label: "Clasificación", status: "done", reason: "40 comprobantes clasificados" },
          { key: "calculo", label: "Cálculo", status: "done", reason: "IIBB estimado en $ 48.450,00" },
          { key: "controles", label: "Controles", status: "blocked", reason: "2 decisiones pendientes" },
          { key: "cierre", label: "Cierre", status: "pending", reason: "Disponible al resolver bloqueos" },
        ]}
      />
    </div>
  );
}

const camposTriage: DocumentField[] = [
  { id: "tipo", label: "Tipo de comprobante", value: "Factura C", confidence: "alta" },
  { id: "fecha", label: "Fecha", value: "01/10/2026", confidence: "alta" },
  { id: "razon-social", label: "Razón social", value: "Almacén Norte", confidence: "baja" },
  { id: "importe", label: "Importe total", value: "$ 18.000,00", confidence: "alta" },
];

const documentos = [
  { numero: "C 000101", proveedor: "Almacén Norte", fecha: "01/10/2026", importe: "$ 18.000,00" },
  { numero: "C 000102", proveedor: "Bodega Los Cerros", fecha: "02/10/2026", importe: "$ 20.750,00" },
  { numero: "C 000103", proveedor: "Proveedor Tucumán", fecha: "03/10/2026", importe: "$ 23.500,00" },
  { numero: "C 000104", proveedor: "Mayorista NOA", fecha: "04/10/2026", importe: "$ 26.250,00" },
  { numero: "C 000105", proveedor: "Almacén Norte", fecha: "05/10/2026", importe: "$ 29.000,00" },
  { numero: "C 000106", proveedor: "Bodega Los Cerros", fecha: "06/10/2026", importe: "$ 31.750,00" },
];

/** Triage: un documento por vez, cola plegable, datos con confianza y «Siguiente». */
export function TriageDemo() {
  const [colaAbierta, setColaAbierta] = useState(true);
  const [campos, setCampos] = useState(camposTriage);
  const [indice, setIndice] = useState(0);
  const actual = documentos[indice] ?? documentos[0]!;

  return (
    <DocumentTriage
      queueLabel="Documentos por revisar"
      queue={
        <div className="patrones-demo__triage-queue">
          <h2>Cola</h2>
          <p className="ds-text-help">{indice + 1} de 40</p>
          <ul className="patrones-demo__lista">
            {documentos.map((documento, posicion) => (
              <li key={documento.numero}>
                <button type="button" className="patrones-demo__opcion" aria-current={posicion === indice ? "true" : undefined} onClick={() => setIndice(posicion)}>
                  <strong>{documento.numero}</strong><small>{documento.proveedor}</small>
                </button>
              </li>
            ))}
          </ul>
          <Button type="button" variant="text">Ver lista completa</Button>
        </div>
      }
      queueOpen={colaAbierta}
      onQueueToggle={() => setColaAbierta((previa) => !previa)}
      viewer={
        <DocumentViewer title={`comprobante-${indice + 1}.pdf`} pageLabel="1 de 1" zoomLabel="100 %">
          <div className="patrones-demo__hoja" aria-hidden="true">
            <div><strong>{actual.proveedor}</strong><strong>FACTURA C</strong></div>
            <h2>{actual.numero}</h2>
            <p>Fecha <b>{actual.fecha}</b></p>
            <p>Cliente <b>ZZ-AYUDA Restaurante Nuevo</b></p>
            <p>CUIT <b>30-23456789-1</b></p>
            <p>Importe total <b>{actual.importe}</b></p>
          </div>
        </DocumentViewer>
      }
      fields={
        <div className="patrones-demo__triage-fields">
          <h1 className="ds-title-page">Revisar comprobante</h1>
          <p className="ds-text-help">PDF recibido el 04/11/2026</p>
          <DocumentFields
            fields={campos}
            onChange={(id, value) => setCampos((previos) => previos.map((campo) => (campo.id === id ? { ...campo, value } : campo)))}
          />
        </div>
      }
      decision={
        <DecisionBar
          label="Decisión sobre el documento"
          secondary={
            <>
              <Button type="button" variant="ghost">
                Corregir
              </Button>
              <Button type="button" variant="ghost">
                Rechazar
              </Button>
            </>
          }
          primary={
            <Button type="button" variant="primary">
              Aprobar extracción
            </Button>
          }
          next={
            <NextDocumentButton
              onNext={() => setIndice((previo) => (previo + 1) % documentos.length)}
            />
          }
        />
      }
    />
  );
}

interface PeriodoCliente { id: string; periodo: string; detalle: string; estado: string; etiquetaEstado: string; importe: string; accion: string }
const columnasPeriodos: TableColumn<PeriodoCliente>[] = [
  { key: "periodo", header: "Período", render: (fila) => <TableCellStack primary={fila.periodo} secondary={fila.detalle} /> },
  { key: "estado", header: "Estado", render: (fila) => <StatusBadge status={fila.estado} label={fila.etiquetaEstado} /> },
  { key: "importe", header: "Importe", align: "right", render: (fila) => fila.importe },
  { key: "accion", header: "Acción", render: (fila) => <Button type="button" variant="text" size="row" href={`#${fila.id}`}>{fila.accion}</Button> },
];

/** Página de cliente: ubicación, períodos, actividad y acceso a su configuración. */
export function PaginaClienteDemo() {
  const [comentariosAbiertos, setComentariosAbiertos] = useState(false);
  const [actividad, setActividad] = useState<ObjectActivityEntry[]>([
    {
      id: "h-1",
      kind: "historial",
      at: "18/11/2026 17:02",
      text: "Se cargó el libro de compras sintético.",
    },
  ]);
  const periodos: PeriodoCliente[] = [
    { id: "2026-10", periodo: "octubre de 2026 · IIBB Tucumán", detalle: "Revisión 1 · vence el 20/11/2026", estado: "NEEDS_REVIEW", etiquetaEstado: "Revisar", importe: "$ 48.450,00", accion: "Abrir Legajo" },
    { id: "2026-09", periodo: "septiembre de 2026 · IIBB Tucumán", detalle: "Finalizado el 18/10/2026", estado: "READY", etiquetaEstado: "Listo", importe: "$ 31.200,00", accion: "Ver" },
  ];

  return (
    <div className="patrones-demo">
      <ObjectPage
        breadcrumb={[{ label: "Clientes", href: "#clientes" }, { label: "ZZ-AYUDA Restaurante Nuevo" }]}
        title="ZZ-AYUDA Restaurante Nuevo"
        status={<StatusBadge status="ACTIVE" variant="pill" />}
        description="CUIT 30-23456789-1 · Restaurante · San Miguel de Tucumán"
        actions={
          <>
            <Button type="button" variant="secondary" href="#configuracion-fiscal">
              Configuración fiscal
            </Button>
            <ObjectActivityTrigger
              count={actividad.length}
              onOpen={() => setComentariosAbiertos((previo) => !previo)}
            />
          </>
        }
      >
        <StatStrip
          label="Resumen del cliente"
          items={[
            { key: "abiertos", label: "períodos abiertos", value: "2" },
            { key: "vencimiento", label: "próximo vencimiento", value: "20/11" },
            { key: "menciones", label: "mención pendiente", value: "1" },
          ]}
        />
        <nav className="patrones-demo__tabs" aria-label="Secciones del cliente">
          <Button type="button" variant="text" aria-current="page">Resumen</Button>
          <Button type="button" variant="text">Períodos</Button>
          <Button type="button" variant="text">Actividad</Button>
          <Button type="button" variant="text">Configuración fiscal</Button>
        </nav>
        <DenseSection id="periodos" title="Períodos" count={periodos.length}>
          <Table columns={columnasPeriodos} rows={periodos} rowKey={(fila) => fila.id} />
        </DenseSection>
        {comentariosAbiertos ? (
          <DenseSection id="actividad" title="Actividad">
            <ObjectActivity
              label="Actividad del cliente"
              entries={actividad}
              onSubmitComment={(texto) =>
                setActividad((previa) => [
                  ...previa,
                  {
                    id: `c-${previa.length + 1}`,
                    kind: "comentario",
                    at: "23/11/2026 08:00",
                    author: "Persona sintética B",
                    text: texto,
                  },
                ])
              }
            />
          </DenseSection>
        ) : null}
      </ObjectPage>
    </div>
  );
}

const pasosCierre: FlowStep[] = [
  { key: "revision", label: "Revisar controles", status: "done" },
  {
    key: "finalizar",
    label: "Finalizar el mes",
    status: "current",
    reason: "Quedan 2 controles bloqueantes por decidir.",
    action: (
      <Button type="button" variant="primary">
        Finalizar mes
      </Button>
    ),
  },
  { key: "presentar", label: "Presentar", status: "blocked", reason: "Falta finalizar el mes." },
  { key: "pagar", label: "Pagar", status: "pending", reason: "Falta presentar." },
];

/** Cierre como flujo por pasos: una acción en curso, con el motivo de los pasos que siguen. */
export function FlujoCierreDemo() {
  return (
    <div className="patrones-demo">
      <StepFlow label="Cierre del mes sintético" steps={pasosCierre} />
    </div>
  );
}

/** Carga vacía de una cola de decisiones: un resultado, no un error. */
export function ColaVaciaDemo() {
  return (
    <div className="patrones-demo">
      <WorkQueue
        label="Controles bloqueantes"
        empty={
          <EmptyState
            kind="no-results"
            title="No hay controles bloqueantes"
            description="Los avisos quedan en la actividad del mes."
          />
        }
      >
        {null}
      </WorkQueue>
    </div>
  );
}

/** Portada con el marco común del demo para capturas de referencia visual. */
export function PortadaPantallaDemo() {
  return (
    <MarcoTrabajo>
      <PortadaDemo />
    </MarcoTrabajo>
  );
}
