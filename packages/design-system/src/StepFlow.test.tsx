// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./Button.js";
import { StepFlow, type FlowStep } from "./StepFlow.js";

const pasos: FlowStep[] = [
  { key: "revision", label: "Revisión de controles", status: "done" },
  {
    key: "finalizar",
    label: "Finalizar el mes",
    status: "current",
    action: <Button type="button">Finalizar mes</Button>,
  },
  {
    key: "presentar",
    label: "Presentar",
    status: "blocked",
    reason: "Falta finalizar el mes.",
    action: <Button type="button">Presentar</Button>,
  },
  { key: "pagar", label: "Pagar", status: "pending" },
];

describe("StepFlow", () => {
  afterEach(() => cleanup());

  it("expone la secuencia con nombre y un elemento por paso, en orden", () => {
    render(<StepFlow label="Cierre del mes" steps={pasos} />);

    const lista = screen.getByRole("list", { name: "Cierre del mes" });
    const items = within(lista).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent("Revisión de controles");
    expect(items[3]).toHaveTextContent("Pagar");
  });

  it("dice el estado con texto y marca el paso en curso con aria-current", () => {
    render(<StepFlow label="Cierre del mes" steps={pasos} />);

    expect(screen.getByText("Hecho")).toBeInTheDocument();
    expect(screen.getByText("En curso")).toBeInTheDocument();
    expect(screen.getByText("Bloqueado")).toBeInTheDocument();
    expect(screen.getByText("Pendiente")).toBeInTheDocument();

    const enCurso = screen.getByText("Finalizar el mes").closest("li");
    expect(enCurso).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Revisión de controles").closest("li")).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("solo el paso en curso muestra su acción", () => {
    const onFinalizar = vi.fn();
    render(
      <StepFlow
        label="Cierre del mes"
        steps={[
          {
            key: "a",
            label: "Finalizar",
            status: "current",
            action: <button onClick={onFinalizar}>Finalizar mes</button>,
          },
          {
            key: "b",
            label: "Presentar",
            status: "pending",
            action: <button>Presentar ahora</button>,
          },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "Finalizar mes" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Presentar ahora" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Finalizar mes" }));
    expect(onFinalizar).toHaveBeenCalledTimes(1);
  });

  it("un paso bloqueado o pendiente dice qué falta; uno hecho no repite el motivo", () => {
    render(
      <StepFlow
        label="Cierre del mes"
        steps={[
          { key: "a", label: "Revisión", status: "done", reason: "No se muestra" },
          { key: "b", label: "Presentar", status: "blocked", reason: "Falta finalizar el mes." },
        ]}
      />,
    );

    expect(screen.queryByText("No se muestra")).toBeNull();
    expect(screen.getByText("Falta finalizar el mes.")).toBeInTheDocument();
  });

  it("el número del paso es decorativo", () => {
    render(<StepFlow label="Cierre del mes" steps={pasos} />);
    const marcas = document.querySelectorAll(".step-flow__marca");
    expect(marcas.length).toBe(4);
    marcas.forEach((marca) => expect(marca).toHaveAttribute("aria-hidden", "true"));
  });

  it("no tiene un <select> nativo", () => {
    render(<StepFlow label="Cierre del mes" steps={pasos} />);
    expect(document.querySelectorAll("select")).toHaveLength(0);
  });
});
