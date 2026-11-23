// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ColaVaciaDemo,
  ControlesPanelDemo,
  FlujoCierreDemo,
  PaginaClienteDemo,
  PortadaDemo,
  TriageDemo,
} from "./Patrones.fixtures.js";

describe("fixtures de los patrones DS-0 (datos sintéticos)", () => {
  afterEach(() => cleanup());

  it("panel de control: abre el detalle, cierra con Escape, devuelve el foco y no imprime la ruta", () => {
    render(<ControlesPanelDemo />);
    const fila = screen.getByRole("button", { name: "Revisar Facturas C: 2 comprobantes" });
    fila.focus();
    fireEvent.click(fila);

    expect(
      screen.getByRole("dialog", { name: "Facturas C: 2 comprobantes" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\/clientes\/1\/legajo\/2026-10\/controles/)).toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/\/clientes\/1\/legajo\/2026-10\/controles/)).toBeNull();
    expect(document.activeElement).toBe(fila);
  });

  it("panel de control: el pie tiene una sola acción primaria y la actividad admite comentarios", () => {
    render(<ControlesPanelDemo />);
    fireEvent.click(screen.getByRole("button", { name: "Revisar Facturas C: 2 comprobantes" }));

    const dialogo = screen.getByRole("dialog");
    expect(dialogo.querySelectorAll(".ds-button--primary")).toHaveLength(1);
    expect(within(dialogo).getByText("Pidió confirmar las diferencias antes de cerrar.")).toBeInTheDocument();

    fireEvent.change(within(dialogo).getByLabelText("Escribí un comentario"), {
      target: { value: "Pedir el CUIT por correo" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Comentar" }));
    expect(within(dialogo).getByText("Pedir el CUIT por correo")).toBeInTheDocument();
  });

  it("portada: reproduce impuestos, atención y avance del cierre", () => {
    render(<PortadaDemo />);
    expect(screen.getByRole("heading", { name: "Impuestos del período" })).toBeInTheDocument();
    expect(screen.getByText("Ingresos Brutos · Tucumán")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Requiere atención" })).toBeInTheDocument();
    expect(screen.getAllByRole("link").find((link) => link.getAttribute("href") === "#controles")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Avance del cierre" }).querySelectorAll("li")).toHaveLength(5);
    expect(screen.getByText("$ 48.450,00")).toBeInTheDocument();
    expect(document.querySelectorAll(".ds-button--primary")).toHaveLength(0);
  });

  it("triage: pliega la cola, avanza con Siguiente y guarda el dato editado", () => {
    render(<TriageDemo />);

    expect(
      screen.getByRole("region", { name: "comprobante-1.pdf" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ocultar cola" }));
    expect(screen.getByRole("button", { name: "Mostrar cola" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(
      screen.getByRole("region", { name: "comprobante-2.pdf" }),
    ).toBeInTheDocument();

    const importe = screen.getByLabelText("Importe total") as HTMLInputElement;
    fireEvent.change(importe, { target: { value: "1250,50" } });
    expect(importe.value).toBe("1250,50");
    expect(document.querySelectorAll(".ds-button--primary")).toHaveLength(1);
  });

  it("página de cliente: un solo h1, enlace a Configuración fiscal y actividad desde «Comentarios · N»", () => {
    render(<PaginaClienteDemo />);

    expect(
      screen.getByRole("heading", { level: 1, name: "ZZ-AYUDA Restaurante Nuevo" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configuración fiscal" })).toHaveAttribute(
      "href",
      "#configuracion-fiscal",
    );
    expect(screen.queryByRole("region", { name: "Actividad del cliente" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Comentarios · 1" }));
    expect(screen.getByRole("region", { name: "Actividad del cliente" })).toBeInTheDocument();
    expect(document.querySelectorAll(".ds-button--primary")).toHaveLength(0);
  });

  it("cierre por pasos: marca el paso en curso y muestra el motivo de los que siguen", () => {
    render(<FlujoCierreDemo />);

    const enCurso = screen
      .getByRole("list", { name: "Cierre del mes sintético" })
      .querySelector('[aria-current="step"]');
    expect(enCurso).toHaveTextContent("Finalizar el mes");
    expect(screen.getByText("Falta finalizar el mes.")).toBeInTheDocument();
  });

  it("cola vacía muestra el vacío y no una lista", () => {
    render(<ColaVaciaDemo />);

    expect(screen.getByText("No hay controles bloqueantes")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("ninguna fixture usa <select> nativo", () => {
    const { container } = render(
      <>
        <PortadaDemo />
        <FlujoCierreDemo />
        <TriageDemo />
        <PaginaClienteDemo />
      </>,
    );
    expect(container.querySelectorAll("select")).toHaveLength(0);
  });
});
