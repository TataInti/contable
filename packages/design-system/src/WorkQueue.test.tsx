// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmptyState } from "./EmptyState.js";
import { WorkQueue, WorkQueueRow } from "./WorkQueue.js";

describe("WorkQueue y WorkQueueRow", () => {
  afterEach(() => cleanup());

  it("muestra una lista con nombre y una fila por decisión", () => {
    render(
      <WorkQueue label="Controles bloqueantes">
        <WorkQueueRow
          id="c-1"
          title="Facturas C"
          decision="Aceptar con motivo o excluir del cálculo"
          subtitle="Cliente sintético A · 10/2026"
          status="BLOCKING"
          date="20/11/2026"
          amount="$ 1.250,00"
          onOpen={() => undefined}
        />
        <WorkQueueRow
          id="c-2"
          title="Ventas sin CUIT"
          decision="Completar el CUIT del comprador"
          onOpen={() => undefined}
        />
      </WorkQueue>,
    );

    const lista = screen.getByRole("list", { name: "Controles bloqueantes" });
    const filas = within(lista).getAllByRole("listitem");
    expect(filas).toHaveLength(2);
    expect(filas[0]).toHaveAttribute("data-row-key", "c-1");
    expect(screen.getByText("Facturas C")).toBeInTheDocument();
    expect(screen.getByText("Aceptar con motivo o excluir del cálculo")).toBeInTheDocument();
    expect(screen.getByText("Bloqueante")).toBeInTheDocument();
    expect(screen.getByText("$ 1.250,00")).toHaveClass("work-queue-row__importe");
    expect(screen.getByText("20/11/2026")).toHaveClass("work-queue-row__fecha");
  });

  it("cada fila tiene una acción de abrir con el nombre del objeto", () => {
    const onOpen = vi.fn();
    render(
      <WorkQueue label="Controles">
        <WorkQueueRow id="c-1" title="Facturas C" decision="Decidir" onOpen={onOpen} />
      </WorkQueue>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Abrir Facturas C" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("densidad de portada (48 px) y compacta (32 px) quedan expuestas en la lista", () => {
    const { rerender } = render(
      <WorkQueue label="Cola" density="queue">
        <WorkQueueRow id="a" title="A" decision="Decidir" onOpen={() => undefined} />
      </WorkQueue>,
    );
    expect(screen.getByRole("list", { name: "Cola" })).toHaveAttribute("data-density", "queue");
    expect(screen.getByRole("listitem")).toHaveClass("work-queue-row--queue");

    rerender(
      <WorkQueue label="Cola" density="compact">
        <WorkQueueRow id="a" title="A" decision="Decidir" onOpen={() => undefined} />
      </WorkQueue>,
    );
    expect(screen.getByRole("list", { name: "Cola" })).toHaveAttribute("data-density", "compact");
    expect(screen.getByRole("listitem")).toHaveClass("work-queue-row--compact");
  });

  it("sin filas muestra el vacío y no una lista vacía", () => {
    render(
      <WorkQueue
        label="Controles"
        empty={
          <EmptyState
            kind="no-results"
            title="No hay controles bloqueantes"
            description="Los avisos quedan en la actividad."
          />
        }
      >
        {null}
      </WorkQueue>,
    );

    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText("No hay controles bloqueantes")).toBeInTheDocument();
  });

  it("no tiene un <select> nativo", () => {
    render(
      <WorkQueue label="Cola">
        <WorkQueueRow id="a" title="A" decision="Decidir" onOpen={() => undefined} />
      </WorkQueue>,
    );
    expect(document.querySelectorAll("select")).toHaveLength(0);
  });
});
