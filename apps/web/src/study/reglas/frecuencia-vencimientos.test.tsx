// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { ApiError, api } from "../../lib/api";
import {
  demoContext,
  makeDemoDetail,
  makeDemoVersion,
  mockDemoApi,
  renderDemoReglas,
} from "./datosDemoReglas";

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

vi.mock("../../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      del: vi.fn(),
      postWithHeaders: vi.fn(),
    } as unknown as typeof actual.api,
  };
});

// Precedencia (D-R3-D): el calendario publicado tiene prioridad; las reglas son el respaldo.
const PRECEDENCIA =
  "El calendario publicado del organismo tiene prioridad. Estas reglas calculan las fechas de presentación y pago cuando no hay calendario publicado.";
const MENSAJE_FRECUENCIA =
  "No es una frecuencia válida. Valores aceptados: MONTHLY, QUARTERLY, ANNUAL, ONCE.";

async function seccion(titulo: string): Promise<HTMLElement> {
  return (await screen.findByRole("heading", { name: titulo })).closest("section") as HTMLElement;
}

async function abrirAltaDeVencimiento(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("tab", { name: /^Vencimientos/ }));
  const section = await seccion("Vencimientos");
  fireEvent.click(within(section).getByRole("button", { name: "Agregar vencimiento" }));
  return screen.findByRole("dialog");
}

function detalleConVencimiento(frequency: string) {
  const detail = makeDemoDetail();
  detail.versions = [
    makeDemoVersion({
      dueDateRules: [
        {
          id: "due-1",
          frequency,
          dueDay: 20,
          cuitEnding: null,
          validFrom: "2026-01-01",
          validTo: null,
        },
      ],
    }),
  ];
  return detail;
}

describe("Reglas fiscales — frecuencia de vencimientos y precedencia (D-R3-A, D-R3-D)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contextMock.current = demoContext();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("la tabla muestra tal cual el valor guardado que no está en la lista (MENSUAL)", async () => {
    mockDemoApi(detalleConVencimiento("MENSUAL"));
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("tab", { name: /^Vencimientos/ }));
    expect(within(await seccion("Vencimientos")).getByText("MENSUAL")).toBeTruthy();
  });

  it("la tabla muestra la etiqueta Mensual para el código MONTHLY", async () => {
    mockDemoApi(detalleConVencimiento("MONTHLY"));
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("tab", { name: /^Vencimientos/ }));
    const tabla = within(await seccion("Vencimientos"));
    expect(tabla.getByText("Mensual")).toBeTruthy();
    expect(tabla.queryByText("MONTHLY")).toBeNull();
  });

  it("la pestaña Vencimientos dice que el calendario publicado tiene prioridad", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("tab", { name: /^Vencimientos/ }));
    expect((await seccion("Vencimientos")).textContent).toContain(PRECEDENCIA);
  });

  it("el alta ofrece Mensual, Trimestral, Anual y Única en un desplegable, con Mensual por defecto", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();

    const dialog = await abrirAltaDeVencimiento();
    const campo = within(dialog).getByLabelText("Frecuencia") as HTMLSelectElement;
    expect(campo.tagName).toBe("SELECT");
    expect([...campo.options].map((opcion) => opcion.textContent)).toEqual([
      "Mensual",
      "Trimestral",
      "Anual",
      "Única",
    ]);
    expect(campo.value).toBe("MONTHLY");
  });

  it("al guardar, el alta envía MONTHLY por defecto", async () => {
    mockDemoApi(makeDemoDetail());
    vi.mocked(api.post).mockResolvedValue({} as never);
    renderDemoReglas();

    const dialog = await abrirAltaDeVencimiento();
    fireEvent.change(within(dialog).getByLabelText("Día del mes"), { target: { value: "20" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar vencimiento" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/tax/rule-versions/version-1/due-date-rules",
        expect.objectContaining({ frequency: "MONTHLY" }),
      ),
    );
  });

  it("un 400 por frecuencia se muestra junto al botón con su motivo", async () => {
    mockDemoApi(makeDemoDetail());
    vi.mocked(api.post).mockRejectedValue(
      new ApiError("VALIDATION_ERROR", "Datos inválidos", 400, null, {
        code: "VALIDATION_ERROR",
        message: "Datos inválidos",
        details: [{ path: ["frequency"], message: MENSAJE_FRECUENCIA }],
      } as never),
    );
    renderDemoReglas();

    const dialog = await abrirAltaDeVencimiento();
    fireEvent.change(within(dialog).getByLabelText("Día del mes"), { target: { value: "20" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar vencimiento" }));

    expect(await within(dialog).findByText(`Frecuencia: ${MENSAJE_FRECUENCIA}`)).toBeTruthy();
  });

  it("tras guardar, el alta vuelve a Mensual", async () => {
    mockDemoApi(makeDemoDetail());
    vi.mocked(api.post).mockResolvedValue({} as never);
    renderDemoReglas();

    const dialog = await abrirAltaDeVencimiento();
    fireEvent.change(within(dialog).getByLabelText("Día del mes"), { target: { value: "20" } });
    fireEvent.change(within(dialog).getByLabelText("Frecuencia"), {
      target: { value: "QUARTERLY" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar vencimiento" }));
    expect(await screen.findByText("El vencimiento quedó agregado al borrador.")).toBeTruthy();

    const reabierto = await abrirAltaDeVencimiento();
    expect((within(reabierto).getByLabelText("Frecuencia") as HTMLSelectElement).value).toBe(
      "MONTHLY",
    );
  });
});
