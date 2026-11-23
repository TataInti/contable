/*
 * Fixtures de demostración de los patrones DS-0 (C10–C16). Datos inventados y rotulados como
 * sintéticos. Los usan las pruebas y las capturas de DS-0; no son pantallas de la aplicación.
 */
import { useState } from "react";
import "./Patrones.fixtures.css";
import { SearchSelect } from "./SearchSelect.js";
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
import { DenseSection } from "./Dense.js";
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
import { Table, type TableColumn } from "./Table.js";
import { WorkQueue, WorkQueueRow } from "./WorkQueue.js";

interface ControlSintetico {
  id: string;
  titulo: string;
  decision: string;
  contexto: string;
  estado: string;
  fecha: string;
  importe: string;
}

const controles: ControlSintetico[] = [
  {
    id: "1",
    titulo: "Facturas C sin tipo aceptado",
    decision: "Aceptar con motivo o excluir del cálculo",
    contexto: "Cliente sintético A · 10/2026",
    estado: "BLOCKING",
    fecha: "20/11/2026",
    importe: "$ 1.250,00",
  },
  {
    id: "2",
    titulo: "Ventas sin CUIT del comprador",
    decision: "Completar el CUIT o aceptar con motivo",
    contexto: "Cliente sintético B · 10/2026",
    estado: "BLOCKING",
    fecha: "21/11/2026",
    importe: "$ 480,00",
  },
];

const actividadControl: ObjectActivityEntry[] = [
  {
    id: "h-1",
    kind: "historial",
    at: "19/11/2026 09:15",
    text: "Se detectó el control al importar el libro sintético.",
  },
  {
    id: "c-1",
    kind: "comentario",
    at: "20/11/2026 10:42",
    author: "Persona sintética A",
    text: "Consultar el tipo con el cliente.",
  },
];

/** Cola de controles con el panel de detalle abierto: filas de 48 px y panel compacto. */
export function ControlesPanelDemo() {
  const [abierto, setAbierto] = useState<ControlSintetico | null>(null);
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
            date={control.fecha}
            amount={control.importe}
            onOpen={() => abrir(control, document.activeElement as HTMLElement)}
          />
        ))}
      </WorkQueue>
      <ObjectPanel
        kind="control"
        isOpen={abierto !== null}
        onClose={cerrar}
        title={abierto ? `Control: ${abierto.titulo}` : "Control"}
        description={abierto?.contexto ?? ""}
        returnFocusTo={origen}
        primaryAction={
          <Button type="button" variant="primary" onClick={cerrar}>
            Aceptar con motivo
          </Button>
        }
      >
        <WorkQueue label="Comprobantes afectados" density="compact">
          <WorkQueueRow
            id="comp-1"
            title="Comprobante sintético 0001-00000007"
            decision="Factura C · 12/10/2026"
            amount="$ 1.250,00"
            onOpen={() => undefined}
          />
          <WorkQueueRow
            id="comp-2"
            title="Comprobante sintético 0001-00000009"
            decision="Factura C · 14/10/2026"
            amount="$ 600,00"
            onOpen={() => undefined}
          />
        </WorkQueue>
        <ObjectActivity
          label="Actividad del control"
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
      </ObjectPanel>
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
  { id: "emisor", label: "CUIT del emisor", value: "20-00000000-1", confidence: "alta" },
  { id: "tipo", label: "Tipo de comprobante", value: "Factura C", confidence: "media" },
  { id: "importe", label: "Importe total", value: "1250,00", confidence: "baja" },
];

const documentos = [
  "Factura C sintética 0001",
  "Factura C sintética 0002",
  "Recibo sintético 0003",
];

/** Triage: un documento por vez, cola plegable, datos con confianza y «Siguiente». */
export function TriageDemo() {
  const [colaAbierta, setColaAbierta] = useState(true);
  const [campos, setCampos] = useState(camposTriage);
  const [indice, setIndice] = useState(0);
  const actual = documentos[indice] ?? documentos[0] ?? "";

  return (
    <DocumentTriage
      queueLabel="Documentos por revisar"
      queue={
        <ul className="patrones-demo__lista">
          {documentos.map((nombre, posicion) => (
            <li key={nombre}>
              <button
                type="button"
                className="patrones-demo__opcion"
                aria-current={posicion === indice ? "true" : undefined}
                onClick={() => setIndice(posicion)}
              >
                {nombre}
              </button>
            </li>
          ))}
        </ul>
      }
      queueOpen={colaAbierta}
      onQueueToggle={() => setColaAbierta((previa) => !previa)}
      viewer={
        <DocumentViewer title={`${actual}.pdf`} pageLabel="Página 1 de 1" zoomLabel="100 %">
          <div className="patrones-demo__hoja" aria-hidden="true">
            <span>FACTURA C</span>
            <span>Documento sintético</span>
          </div>
        </DocumentViewer>
      }
      fields={
        <DocumentFields
          fields={campos}
          onChange={(id, value) =>
            setCampos((previos) =>
              previos.map((campo) => (campo.id === id ? { ...campo, value } : campo)),
            )
          }
        />
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

const columnasPeriodos: TableColumn<{
  id: string;
  periodo: string;
  estado: string;
  controles: string;
}>[] = [
  { key: "periodo", header: "Período", render: (fila) => fila.periodo },
  { key: "estado", header: "Estado", render: (fila) => fila.estado },
  { key: "controles", header: "Controles", align: "right", render: (fila) => fila.controles },
];

/** Página de cliente: ubicación, períodos, actividad y acceso a Configuración fiscal. */
export function PaginaClienteDemo() {
  const [periodo, setPeriodo] = useState("2026-10");
  const [comentariosAbiertos, setComentariosAbiertos] = useState(false);
  const [actividad, setActividad] = useState<ObjectActivityEntry[]>([
    {
      id: "h-1",
      kind: "historial",
      at: "18/11/2026 17:02",
      text: "Se cargó el libro de compras sintético.",
    },
  ]);
  const periodos = [
    { id: "2026-10", periodo: "Octubre 2026", estado: "En curso", controles: "2" },
    { id: "2026-09", periodo: "Septiembre 2026", estado: "Finalizado", controles: "0" },
  ];

  return (
    <div className="patrones-demo">
      <ObjectPage
        breadcrumb={[{ label: "Clientes", href: "#clientes" }, { label: "Cliente sintético A" }]}
        title="Cliente sintético A"
        status={<StatusBadge status="CONFIGURED" variant="pill" />}
        description="CUIT sintético 20-00000000-1 · Régimen sintético"
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
        <DenseSection id="periodos" title="Períodos" count={periodos.length}>
          <Table columns={columnasPeriodos} rows={periodos} rowKey={(fila) => fila.id} />
          <div className="patrones-demo__fila">
            <SearchSelect
              label="Período del legajo"
              options={periodos.map((fila) => ({ value: fila.id, label: fila.periodo }))}
              value={periodo}
              onChange={setPeriodo}
              allowEmpty={false}
            />
            <Button type="button" variant="primary" size="row" href={`#legajo-${periodo}`}>
              Abrir legajo
            </Button>
          </div>
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
