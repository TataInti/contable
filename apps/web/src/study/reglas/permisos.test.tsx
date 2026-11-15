// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { api } from "../../lib/api";
import { demoContext, makeDemoDetail, mockDemoApi, renderDemoReglas } from "./datosDemoReglas";

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

describe("Reglas fiscales — permisos y cabecera (K3)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contextMock.current = demoContext();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("sin tax.rules.read muestra Acceso restringido y no consulta datos", async () => {
    contextMock.current = demoContext([]);
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();

    expect(await screen.findByText("Acceso restringido")).toBeTruthy();
    expect(screen.getByText("No tenés permiso para consultar reglas fiscales.")).toBeTruthy();
    expect(api.get).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Nuevo paquete" })).toBeNull();
  });

  it("con lectura y sin propose no ofrece alta, activación ni edición", async () => {
    contextMock.current = demoContext(["tax.rules.read"]);
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();

    expect(await screen.findByRole("heading", { name: "Demo · IVA Responsable Inscripto" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Nuevo paquete" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Activar$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Agregar regla" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Guardar borrador" })).toBeNull();
    expect(screen.queryByLabelText("Concepto de la fila 1")).toBeNull();
    expect(screen.getByText("Demo · Operaciones generales")).toBeTruthy();
  });

  it("la cabecera muestra título y descripción, y «Nuevo paquete» con propose", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();

    expect(await screen.findByRole("heading", { name: "Reglas fiscales" })).toBeTruthy();
    expect(screen.getByText(/Alícuotas, mínimos y porcentajes normativos con vigencia/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Nuevo paquete" })).toBeTruthy();
  });

  it("el atajo N abre el alta de paquetes solo con propose", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();
    await screen.findByRole("button", { name: "Nuevo paquete" });

    fireEvent.keyDown(document.body, { key: "n" });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Nuevo paquete de reglas")).toBeTruthy();
  });

  it("el atajo N no hace nada sin propose", async () => {
    contextMock.current = demoContext(["tax.rules.read"]);
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();
    await screen.findByRole("heading", { name: "Demo · IVA Responsable Inscripto" });

    fireEvent.keyDown(document.body, { key: "n" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Eliminar aparece con data.delete, origen UI y firma propia", async () => {
    contextMock.current = demoContext(["tax.rules.read", "tax.rules.propose", "data.delete"]);
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();

    expect(await screen.findByRole("button", { name: "Eliminar paquete" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Eliminar borrador v1" })).toBeTruthy();
  });

  it("Eliminar no aparece sin data.delete ni con una firma ajena", async () => {
    const detail = makeDemoDetail();
    detail.createdByFirmId = "firm-b";
    detail.versions = detail.versions.map((version) => ({ ...version, createdByFirmId: "firm-b" }));

    contextMock.current = demoContext(["tax.rules.read", "tax.rules.propose"]);
    mockDemoApi(detail);
    const { unmount } = renderDemoReglas();
    expect(await screen.findByRole("heading", { name: "Demo · IVA Responsable Inscripto" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Eliminar paquete" })).toBeNull();
    unmount();

    contextMock.current = demoContext(["tax.rules.read", "tax.rules.propose", "data.delete"]);
    mockDemoApi(detail);
    renderDemoReglas();
    expect(await screen.findByRole("heading", { name: "Demo · IVA Responsable Inscripto" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Eliminar paquete" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Eliminar borrador/ })).toBeNull();
  });
});
