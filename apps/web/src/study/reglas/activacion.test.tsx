// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { demoContext, makeDemoDetail, makeDemoVersion, mockDemoApi, renderDemoReglas } from "./datosDemoReglas";

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

describe("Reglas fiscales — activación (K9)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contextMock.current = demoContext();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("con versión vigente no ofrece Activar ni próximo paso", async () => {
    const detail = makeDemoDetail();
    detail.versions = [makeDemoVersion({ status: "ACTIVE" })];
    mockDemoApi(detail);
    renderDemoReglas();

    expect(await screen.findByRole("heading", { name: "Demo · IVA Responsable Inscripto" }, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Activar$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Activar versión" })).toBeNull();
    expect(screen.queryByText("Próximo paso:")).toBeNull();
  });

  it("con versión aprobada ofrece Activar en el resumen y Activar versión como próximo paso", async () => {
    const detail = makeDemoDetail();
    detail.versions = [makeDemoVersion({ status: "APPROVED" })];
    mockDemoApi(detail);
    renderDemoReglas();

    expect(await screen.findByRole("button", { name: /^Activar$/ })).toBeTruthy();
    expect(screen.getByText("Próximo paso:")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Activar versión" })).toBeTruthy();
  });

  it("Activar del resumen y Activar versión del próximo paso abren la misma confirmación", async () => {
    const detail = makeDemoDetail();
    detail.versions = [makeDemoVersion({ status: "APPROVED" })];
    mockDemoApi(detail);
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Activar versión" }));
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Demo · IVA Responsable Inscripto · versión v1" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Activar$/ }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Demo · IVA Responsable Inscripto · versión v1" })).toBeTruthy();
  });

  it("el aviso de retiro aparece solo cuando hay una versión vigente", async () => {
    const detail = makeDemoDetail();
    detail.versions = [
      makeDemoVersion({ id: "version-active", version: 1, status: "ACTIVE" }),
      makeDemoVersion({ id: "version-approved", version: 2, status: "APPROVED" }),
    ];
    mockDemoApi(detail);
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("button", { name: /^Activar$/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Demo · IVA Responsable Inscripto · versión v2" })).toBeTruthy();
    expect(within(dialog).getByText("Al activar esta versión, la versión vigente quedará retirada")).toBeTruthy();
  });

  it("sin versión vigente la confirmación no avisa del retiro", async () => {
    const detail = makeDemoDetail();
    detail.versions = [makeDemoVersion({ id: "version-approved", version: 1, status: "APPROVED" })];
    mockDemoApi(detail);
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("button", { name: /^Activar$/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Vigencia:/)).toBeTruthy();
    expect(within(dialog).queryByText(/Al activar esta versión/)).toBeNull();
  });
});
