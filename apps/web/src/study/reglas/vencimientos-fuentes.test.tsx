// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { api } from "../../lib/api";
import { demoContext, makeDemoDetail, makeDemoVersion, mockDemoApi, renderDemoReglas } from "./datosDemoReglas";
import type { RuleVersion } from "./tipos";
import { cambiarValor } from "../../test/elegirOpcion";

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

// Misma fecha que muestra la pantalla: calendario de es-AR en UTC.

async function seccion(titulo: string): Promise<HTMLElement> {
  return (await screen.findByRole("heading", { name: titulo })).closest("section") as HTMLElement;
}

describe("Reglas fiscales — vencimientos y fuentes (K7)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contextMock.current = demoContext();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("muestra los textos vacíos de vencimientos y de fuentes", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("tab", { name: /^Vencimientos/ }));
    expect(await screen.findByText("No hay vencimientos cargados para esta versión.")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /^Fuentes/ }));
    expect(await screen.findByText("No hay fuentes normativas asociadas a esta versión.")).toBeTruthy();
  });

  it("tabla de vencimientos: CUIT «Todas» y vigencia «desde — hasta»", async () => {
    const detail = makeDemoDetail();
    detail.versions = [
      makeDemoVersion({
        dueDateRules: [
          { id: "due-1", frequency: "MENSUAL", dueDay: 20, cuitEnding: null, validFrom: "2026-01-01", validTo: null },
          { id: "due-2", frequency: "ANUAL", dueDay: 5, cuitEnding: "9", validFrom: "2026-01-01", validTo: "2026-12-31" },
        ],
      }),
    ];
    mockDemoApi(detail);
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("tab", { name: /^Vencimientos/ }));
    const tabla = within(await seccion("Vencimientos"));
    expect(tabla.getByText("MENSUAL")).toBeTruthy();
    expect(tabla.getByText("ANUAL")).toBeTruthy();
    expect(tabla.getByText("Todas")).toBeTruthy();
    expect(tabla.getByText("9")).toBeTruthy();
    expect(tabla.getByText("Desde 01/01/2026")).toBeTruthy();
    expect(tabla.getByText("01/01/2026 al 31/12/2026")).toBeTruthy();
  });

  it("tabla de fuentes: referencia o guion y consulta; la URL no se muestra", async () => {
    const detail = makeDemoDetail();
    detail.versions = [
      makeDemoVersion({
        sources: [
          {
            id: "src-1",
            title: "Demo · Resolución general",
            reference: "RG Demo 1/2026",
            consultedAt: "2026-02-10",
            url: "https://demo.invalid/rg-1",
          } as RuleVersion["sources"][number],
          { id: "src-2", title: "Demo · Padrón", reference: null, consultedAt: "2026-02-11" },
        ],
      }),
    ];
    mockDemoApi(detail);
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("tab", { name: /^Fuentes/ }));
    const section = await seccion("Fuentes normativas");
    const tabla = within(section);
    expect(tabla.getByText("Demo · Resolución general")).toBeTruthy();
    expect(tabla.getByText("RG Demo 1/2026")).toBeTruthy();
    expect(tabla.getByText("Demo · Padrón")).toBeTruthy();
    expect(tabla.getByText("—")).toBeTruthy();
    expect(tabla.getByText("10/02/2026")).toBeTruthy();
    expect(tabla.queryByText(/demo\.invalid/)).toBeNull();
    expect(section.querySelector("a")).toBeNull();
  });

  it("Agregar vencimiento abre el cajón y Cancelar lo cierra", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("tab", { name: /^Vencimientos/ }));
    const section = await seccion("Vencimientos");
    fireEvent.click(within(section).getByRole("button", { name: "Agregar vencimiento" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Definí la regla usada para calcular fechas de presentación y pago.")).toBeTruthy();

    fireEvent.click(within(section).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("guardar el vencimiento envía el día como número, el CUIT recortado y la frecuencia por defecto", async () => {
    mockDemoApi(makeDemoDetail());
    vi.mocked(api.post).mockResolvedValue({} as never);
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("tab", { name: /^Vencimientos/ }));
    const section = await seccion("Vencimientos");
    fireEvent.click(within(section).getByRole("button", { name: "Agregar vencimiento" }));
    const dialog = await screen.findByRole("dialog");
    cambiarValor(within(dialog).getByLabelText("Día del mes"), "20");
    cambiarValor(within(dialog).getByLabelText("Terminación de CUIT"), " 9 ");
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar vencimiento" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/tax/rule-versions/version-1/due-date-rules", {
        jurisdictionId: "jur-1",
        frequency: "MONTHLY",
        dueDay: 20,
        cuitEnding: "9",
        validFrom: expect.any(String),
      }),
    );
    expect(await screen.findByText("El vencimiento quedó agregado al borrador.")).toBeTruthy();
  });

  it("guardar la fuente envía título, URL y consulta; sin referencia no manda el campo", async () => {
    mockDemoApi(makeDemoDetail());
    vi.mocked(api.post).mockResolvedValue({} as never);
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("tab", { name: /^Fuentes/ }));
    const section = await seccion("Fuentes normativas");
    fireEvent.click(within(section).getByRole("button", { name: "Agregar fuente" }));
    const dialog = await screen.findByRole("dialog");
    cambiarValor(within(dialog).getByLabelText("Título"), "  Demo · Ley 1  ");
    cambiarValor(within(dialog).getByLabelText("URL"), "https://demo.invalid/ley");
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar fuente" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/tax/rule-versions/version-1/sources", {
        authorityId: "auth-1",
        title: "Demo · Ley 1",
        url: "https://demo.invalid/ley",
        consultedAt: expect.any(String),
      }),
    );
  });
});
