// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./Button.js";
import { WorkBar } from "./WorkBar.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Nombres de los renglones en el orden del marcado. */
function renglones(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-renglon]")).map(
    (el) => el.getAttribute("data-renglon") ?? "",
  );
}

describe("WorkBar: estructura", () => {
  it("se anuncia como región con nombre accesible", () => {
    render(<WorkBar label="Legajo de prueba" context={<span>Período</span>} />);
    expect(screen.getByRole("region", { name: "Legajo de prueba" })).toBeInTheDocument();
  });

  it("sin avisos ni secciones muestra solo el renglón de contexto", () => {
    const { container } = render(<WorkBar label="Barra" context={<span>Contexto</span>} />);
    expect(renglones(container)).toEqual(["contexto"]);
  });

  it("el contexto va a la izquierda y la acción a la derecha, en el mismo renglón", () => {
    const { container } = render(
      <WorkBar label="Barra" context={<span>Contexto</span>} action={<Button>Guardar</Button>} />,
    );
    const contexto = container.querySelector('[data-renglon="contexto"]') as HTMLElement;
    const inicio = contexto.querySelector(".work-bar__inicio") as HTMLElement;
    const fin = contexto.querySelector(".work-bar__fin") as HTMLElement;
    expect(inicio).toHaveTextContent("Contexto");
    expect(fin).toHaveTextContent("Guardar");
    expect(inicio.compareDocumentPosition(fin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("el renglón de secciones va después del de avisos y la navegación queda a la izquierda", () => {
    const { container } = render(
      <WorkBar
        label="Barra"
        context={<span>Contexto</span>}
        note="Nota de prueba"
        reason="Motivo de prueba"
        sections={<span>Pestañas</span>}
        sectionActions={<span>Acción de sección</span>}
      />,
    );
    expect(renglones(container)).toEqual(["contexto", "avisos", "secciones"]);
    const secciones = container.querySelector('[data-renglon="secciones"]') as HTMLElement;
    const inicio = secciones.querySelector(".work-bar__inicio") as HTMLElement;
    const fin = secciones.querySelector(".work-bar__fin") as HTMLElement;
    expect(inicio).toHaveTextContent("Pestañas");
    expect(fin).toHaveTextContent("Acción de sección");
  });
});

describe("WorkBar: renglón de avisos", () => {
  it("no aparece sin nota ni motivo", () => {
    const { container } = render(<WorkBar label="Barra" context={<span>c</span>} />);
    expect(renglones(container)).not.toContain("avisos");
  });

  it("aparece con solo un motivo y lo muestra a la derecha", () => {
    const { container } = render(
      <WorkBar label="Barra" context={<span>c</span>} reason="Falta la conciliación." />,
    );
    expect(renglones(container)).toContain("avisos");
    expect(container.querySelector(".work-bar__motivo")).toHaveTextContent(
      "Falta la conciliación.",
    );
    expect(container.querySelector(".work-bar__nota")).toBeNull();
  });

  it("la nota va a la izquierda y el motivo a la derecha", () => {
    const { container } = render(
      <WorkBar label="Barra" context={<span>c</span>} note="Autorrevisión" reason="Motivo" />,
    );
    const nota = container.querySelector(".work-bar__nota") as HTMLElement;
    const motivo = container.querySelector(".work-bar__motivo") as HTMLElement;
    expect(nota).toHaveTextContent("Autorrevisión");
    expect(nota.compareDocumentPosition(motivo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("WorkBar: segundo renglón", () => {
  it("no aparece sin navegación ni acciones de sección", () => {
    const { container } = render(<WorkBar label="Barra" context={<span>c</span>} />);
    expect(renglones(container)).not.toContain("secciones");
  });

  it("aparece con solo acciones de sección", () => {
    const { container } = render(
      <WorkBar label="Barra" context={<span>c</span>} sectionActions={<span>Exportar</span>} />,
    );
    expect(renglones(container)).toContain("secciones");
  });
});

describe("WorkBar: como máximo una acción primaria", () => {
  it("avisa en desarrollo cuando hay más de una primaria", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <WorkBar
        label="Barra"
        context={<span>c</span>}
        action={
          <>
            <Button>Uno</Button>
            <Button>Dos</Button>
          </>
        }
      />,
    );
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining("2 acciones primarias"));
  });

  it("no avisa con una sola primaria", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<WorkBar label="Barra" context={<span>c</span>} action={<Button>Uno</Button>} />);
    expect(aviso).not.toHaveBeenCalled();
  });
});
