// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ObjectActivity,
  ObjectActivityTrigger,
  comentariosLabel,
  type ObjectActivityEntry,
} from "./ObjectActivity.js";

const entradas: ObjectActivityEntry[] = [
  {
    id: "h-1",
    kind: "historial",
    at: "20/11/2026 09:15",
    text: "Se cargó la factura sintética 0001",
  },
  {
    id: "c-1",
    kind: "comentario",
    at: "21/11/2026 10:42",
    author: "Persona sintética A",
    text: "Revisar el tipo de comprobante",
  },
];

describe("ObjectActivity", () => {
  afterEach(() => cleanup());

  it("muestra historial y comentarios en orden, con tipo y hora por entrada", () => {
    render(<ObjectActivity entries={entradas} />);

    const region = screen.getByRole("region", { name: "Actividad" });
    const items = region.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute("data-kind", "historial");
    expect(items[1]).toHaveAttribute("data-kind", "comentario");
    expect(screen.getByText("Persona sintética A")).toBeInTheDocument();
    expect(screen.getByText("21/11/2026 10:42").tagName).toBe("TIME");
  });

  it("sin entradas muestra un vacío de sección, no una lista", () => {
    render(<ObjectActivity entries={[]} />);

    expect(screen.getByText("Sin actividad todavía")).toBeInTheDocument();
    expect(document.querySelector(".object-activity__lista")).toBeNull();
  });

  it("sin onSubmitComment no dibuja el redactor", () => {
    render(<ObjectActivity entries={entradas} />);

    expect(screen.queryByLabelText("Escribí un comentario")).toBeNull();
    expect(screen.queryByRole("button", { name: "Comentar" })).toBeNull();
  });

  it("el envío queda deshabilitado hasta escribir, y muestra por qué", () => {
    render(<ObjectActivity entries={entradas} onSubmitComment={() => undefined} />);

    const boton = screen.getByRole("button", { name: "Comentar" });
    expect(boton).toBeDisabled();
    expect(screen.getByText("Escribí el texto para comentar.")).toBeInTheDocument();
    expect(screen.getByLabelText("Escribí un comentario")).toHaveAccessibleDescription(
      "Escribí el texto para comentar.",
    );
  });

  it("envía el texto recortado y limpia el redactor", () => {
    const onSubmitComment = vi.fn();
    render(<ObjectActivity entries={entradas} onSubmitComment={onSubmitComment} />);
    const campo = screen.getByLabelText("Escribí un comentario") as HTMLTextAreaElement;

    fireEvent.change(campo, { target: { value: "  Falta el CUIT del proveedor  " } });
    fireEvent.click(screen.getByRole("button", { name: "Comentar" }));

    expect(onSubmitComment).toHaveBeenCalledWith("Falta el CUIT del proveedor");
    expect(campo.value).toBe("");
  });

  it("con busy bloquea el redactor para evitar envíos duplicados", () => {
    const onSubmitComment = vi.fn();
    render(<ObjectActivity entries={entradas} onSubmitComment={onSubmitComment} busy />);

    expect(screen.getByLabelText("Escribí un comentario")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Enviando/ })).toBeDisabled();
    expect(onSubmitComment).not.toHaveBeenCalled();
  });

  it("no tiene un <select> nativo", () => {
    render(<ObjectActivity entries={entradas} onSubmitComment={() => undefined} />);

    expect(document.querySelectorAll("select")).toHaveLength(0);
  });
});

describe("acceso «Comentarios · N»", () => {
  afterEach(() => cleanup());

  it("arma la etiqueta con el conteo y abre al pulsar", () => {
    const onOpen = vi.fn();
    render(<ObjectActivityTrigger count={3} onOpen={onOpen} />);

    expect(comentariosLabel(3)).toBe("Comentarios · 3");
    fireEvent.click(screen.getByRole("button", { name: "Comentarios · 3" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
