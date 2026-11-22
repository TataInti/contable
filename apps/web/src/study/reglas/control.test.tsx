// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { api } from "../../lib/api";
import {
  demoContext,
  demoCredentials,
  makeDemoDetail,
  makeDemoVersion,
  mockDemoApi,
  renderDemoReglas,
} from "./datosDemoReglas";
import { abrirListado, cambiarValor, valorElegido } from "../../test/elegirOpcion";

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

const conAprobacion = ["tax.rules.read", "tax.rules.propose", "tax.rules.approve"];

describe("Reglas fiscales — control profesional (K8)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contextMock.current = demoContext(conAprobacion);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("en revisión, elegir matrícula habilita Aprobar y el POST envía el identificador", async () => {
    const detail = makeDemoDetail();
    detail.versions = [makeDemoVersion({ status: "IN_REVIEW" })];
    mockDemoApi(detail, { "/tax/credentials": () => Promise.resolve(demoCredentials) });
    vi.mocked(api.post).mockResolvedValue({} as never);
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("tab", { name: /^Control profesional/ }));
    const matricula = await screen.findByLabelText("Matrícula para aprobar");
    expect(within(abrirListado("Matrícula para aprobar")).getByRole("option", { name: "DEMO-MAT-001 · Demo CABA" })).toBeTruthy();
    expect(valorElegido("Matrícula para aprobar")).toBe("");
    const aprobar = screen.getByRole("button", { name: "Aprobar" }) as HTMLButtonElement;
    expect(aprobar.disabled).toBe(true);
    expect(screen.getByText("Seleccioná la matrícula profesional para habilitar la aprobación.")).toBeTruthy();

    cambiarValor(matricula, "cred-1");
    expect(aprobar.disabled).toBe(false);
    fireEvent.click(aprobar);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/tax/rule-versions/version-1/approve", { credentialId: "cred-1" }),
    );
    expect(await screen.findByText("La versión fue aprobada con matrícula profesional.")).toBeTruthy();
  });

  it("en borrador con propose, Enviar a revisión hace el POST del flujo anterior", async () => {
    mockDemoApi(makeDemoDetail());
    vi.mocked(api.post).mockResolvedValue({} as never);
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("tab", { name: /^Control profesional/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Enviar a revisión (flujo anterior)" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/tax/rule-versions/version-1/submit-review"));
    expect(await screen.findByText("La versión fue enviada a revisión.")).toBeTruthy();
    expect(screen.queryByLabelText("Matrícula para aprobar")).toBeNull();
  });

  it("sin fuentes avisa que no hay fuente normativa cargada", async () => {
    mockDemoApi(makeDemoDetail());
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("tab", { name: /^Control profesional/ }));
    expect(await screen.findByText("Sin fuente normativa cargada.")).toBeTruthy();
  });

  it("lista las referencias o, si no hay, los títulos de las fuentes", async () => {
    const detail = makeDemoDetail();
    detail.versions = [
      makeDemoVersion({
        sources: [
          { id: "src-1", title: "Demo · Resolución general", reference: "RG Demo 1/2026", consultedAt: "2026-02-10" },
          { id: "src-2", title: "Demo · Padrón", reference: null, consultedAt: "2026-02-11" },
        ],
      }),
    ];
    mockDemoApi(detail);
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("tab", { name: /^Control profesional/ }));
    expect(await screen.findByText("Fuentes: RG Demo 1/2026 · Demo · Padrón")).toBeTruthy();
  });

  it("en revisión sin permiso de aprobar no muestra ninguna acción", async () => {
    contextMock.current = demoContext(["tax.rules.read", "tax.rules.propose"]);
    const detail = makeDemoDetail();
    detail.versions = [makeDemoVersion({ status: "IN_REVIEW" })];
    mockDemoApi(detail);
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("tab", { name: /^Control profesional/ }));
    expect(await screen.findByRole("heading", { name: "Flujo de revisión anterior" })).toBeTruthy();
    expect(screen.queryByLabelText("Matrícula para aprobar")).toBeNull();
    expect(screen.queryByRole("button", { name: "Aprobar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Enviar a revisión (flujo anterior)" })).toBeNull();
    expect(api.get).not.toHaveBeenCalledWith("/tax/credentials");
  });
});
