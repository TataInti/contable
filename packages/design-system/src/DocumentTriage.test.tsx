// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./Button.js";
import { EmptyState } from "./EmptyState.js";
import {
  DecisionBar,
  DocumentFields,
  DocumentTriage,
  DocumentViewer,
  NextDocumentButton,
  type DocumentField,
} from "./DocumentTriage.js";

const campos: DocumentField[] = [
  { id: "cuit", label: "CUIT del emisor", value: "20-00000000-1", confidence: "alta" },
  { id: "importe", label: "Importe total", value: "1250,00", confidence: "baja" },
];

function Triage({
  onToggle = () => undefined,
  abierta = true,
}: {
  onToggle?: () => void;
  abierta?: boolean;
}) {
  return (
    <DocumentTriage
      queueLabel="Documentos por revisar"
      queue={<p>Lista sintética de documentos</p>}
      queueOpen={abierta}
      onQueueToggle={onToggle}
      viewer={
        <DocumentViewer
          title="Factura C sintética 0001"
          pageLabel="Página 1 de 2"
          zoomLabel="100 %"
        >
          <p>Vista previa sintética</p>
        </DocumentViewer>
      }
      fields={<DocumentFields fields={campos} onChange={() => undefined} />}
      decision={
        <DecisionBar
          label="Decisión sobre el documento"
          secondary={
            <Button type="button" variant="ghost">
              Corregir
            </Button>
          }
          primary={
            <Button type="button" variant="primary">
              Aprobar extracción
            </Button>
          }
          next={<NextDocumentButton onNext={() => undefined} />}
        />
      }
    />
  );
}

describe("DocumentTriage", () => {
  afterEach(() => cleanup());

  it("pliega la cola con un botón que informa su estado y controla la lista", () => {
    const onToggle = vi.fn();
    const { container, rerender } = render(<Triage onToggle={onToggle} />);
    const layout = container.querySelector(".document-triage__cuerpo");
    const datos = container.querySelector(".document-triage__datos");
    expect(datos?.querySelector(".document-triage__decision")).toBeInTheDocument();
    expect(layout?.lastElementChild).toBe(datos);
    expect(layout?.querySelector(".document-viewer")?.contains(datos)).toBe(false);

    const boton = screen.getByRole("button", { name: "Ocultar cola" });
    expect(boton).toHaveAttribute("aria-expanded", "true");
    const cola = screen.getByRole("complementary", { name: "Documentos por revisar" });
    expect(boton.getAttribute("aria-controls")).toBe(cola.id);
    fireEvent.click(boton);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<Triage abierta={false} onToggle={onToggle} />);
    const plegado = screen.getByRole("button", { name: "Mostrar cola" });
    expect(plegado).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("complementary", { name: "Documentos por revisar" })).toBeNull();
  });

  it("el visor se nombra con el archivo e informa página y zoom", () => {
    render(<Triage />);

    const visor = screen.getByRole("region", { name: "Factura C sintética 0001" });
    expect(within(visor).getByText("Página 1 de 2 · 100 %")).toBeInTheDocument();
    expect(within(visor).getByText("Vista previa sintética")).toBeInTheDocument();
  });

  it("sin documento, el visor muestra un vacío y el resto de la pantalla sigue", () => {
    render(
      <DocumentTriage
        queueLabel="Documentos por revisar"
        queue={null}
        queueOpen={false}
        onQueueToggle={() => undefined}
        viewer={<EmptyState kind="no-data" title="No hay documentos por revisar" />}
        fields={<DocumentFields fields={[]} onChange={() => undefined} />}
        decision={<DecisionBar label="Decisión sobre el documento" />}
      />,
    );

    expect(screen.getByText("No hay documentos por revisar")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Datos extraídos" })).toBeInTheDocument();
  });

  it("no tiene un <select> nativo", () => {
    render(<Triage />);
    expect(document.querySelectorAll("select")).toHaveLength(0);
  });
});

describe("DocumentFields", () => {
  afterEach(() => cleanup());

  it("cada campo editable informa su confianza en texto junto al valor", () => {
    render(<DocumentFields fields={campos} onChange={() => undefined} />);

    const cuit = screen.getByLabelText("CUIT del emisor") as HTMLInputElement;
    expect(cuit.value).toBe("20-00000000-1");
    expect(cuit).toHaveAccessibleDescription("Confianza alta");
    const importe = screen.getByLabelText("Importe total");
    expect(importe).toHaveAccessibleDescription("Confianza baja: revisá el dato antes de aprobar");
    expect(document.querySelector('[data-confidence="baja"]')).not.toBeNull();
  });

  it("informa el cambio con el id del campo y el nuevo valor", () => {
    const onChange = vi.fn();
    render(<DocumentFields fields={campos} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Importe total"), { target: { value: "1250,50" } });
    expect(onChange).toHaveBeenCalledWith("importe", "1250,50");
  });
});

describe("DecisionBar", () => {
  afterEach(() => cleanup());

  it("es un grupo con nombre, con una acción principal y el avance Siguiente", () => {
    const onNext = vi.fn();
    render(
      <DecisionBar
        label="Decisión sobre el documento"
        secondary={
          <Button type="button" variant="ghost">
            Rechazar
          </Button>
        }
        primary={
          <Button type="button" variant="primary">
            Aprobar extracción
          </Button>
        }
        next={<NextDocumentButton onNext={onNext} />}
      />,
    );

    const grupo = screen.getByRole("group", { name: "Decisión sobre el documento" });
    expect(within(grupo).getByRole("button", { name: "Rechazar" })).toBeInTheDocument();
    expect(within(grupo).getByRole("button", { name: "Aprobar extracción" })).toBeInTheDocument();
    fireEvent.click(within(grupo).getByRole("button", { name: "Siguiente" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("muestra el motivo de una acción deshabilitada junto a ella", () => {
    render(
      <DecisionBar
        label="Decisión"
        primary={
          <Button type="button" disabled>
            Aprobar extracción
          </Button>
        }
        hint="Completá el CUIT para aprobar."
      />,
    );

    expect(screen.getByRole("note")).toHaveTextContent("Completá el CUIT para aprobar.");
    expect(screen.getByRole("button", { name: "Aprobar extracción" })).toBeDisabled();
  });
});
