// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useNotify } from "./Toast.js";

function Trigger() {
  const notify = useNotify();
  return (
    <>
      <button type="button" onClick={() => notify.success("Pedido creado.")}>éxito</button>
      <button type="button" onClick={() => notify.error("No se pudo guardar.")}>error</button>
      <button type="button" onClick={() => notify.info("Sincronizando.", { title: "Aviso" })}>info</button>
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ToastProvider", () => {
  it("muestra el éxito como estado y lo cierra solo", () => {
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "éxito" }));

    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("Pedido creado.");

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText("Pedido creado.")).toBeNull();
  });

  it("anuncia el error como alerta y lo deja hasta que se cierra", () => {
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "error" }));

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo guardar.");

    fireEvent.click(screen.getByRole("button", { name: "Cerrar notificación" }));
    expect(screen.queryByText("No se pudo guardar.")).toBeNull();
  });

  it("no se cierra mientras el puntero está encima", () => {
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "éxito" }));
    const toast = screen.getByRole("status");

    fireEvent.mouseEnter(toast);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(screen.getByText("Pedido creado.")).toBeInTheDocument();

    fireEvent.mouseLeave(toast);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText("Pedido creado.")).toBeNull();
  });

  it("no apila el mismo aviso repetido y limita la cantidad visible", () => {
    render(<ToastProvider max={2}><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "éxito" }));
    fireEvent.click(screen.getByRole("button", { name: "éxito" }));
    expect(screen.getAllByText("Pedido creado.")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "error" }));
    fireEvent.click(screen.getByRole("button", { name: "info" }));
    expect(screen.queryByText("Pedido creado.")).toBeNull();
    expect(screen.getByText("No se pudo guardar.")).toBeInTheDocument();
    expect(screen.getByText("Aviso")).toBeInTheDocument();
  });

  it("fuera del proveedor no falla ni dibuja nada", () => {
    render(<Trigger />);
    fireEvent.click(screen.getByRole("button", { name: "éxito" }));
    expect(screen.queryByText("Pedido creado.")).toBeNull();
  });
});
