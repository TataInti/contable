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
import { cambiarValor, valorElegido } from "../../test/elegirOpcion";

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

// Catálogo de motores de la familia del régimen (mismo formato que GET /tax/regimes/:id/engines).
const MOTORES = [
  {
    id: "eng-vat-1",
    engineKey: "VAT-1",
    engineVersion: "ar-vat-ri-v1.0.0",
    familyId: "fam-vat",
    familyKey: "VAT_RI",
    label: "Demo · IVA RI v1.0.0",
  },
  {
    id: "eng-vat-2",
    engineKey: "VAT-2",
    engineVersion: "ar-vat-ri-v2.1.0",
    familyId: "fam-vat",
    familyKey: "VAT_RI",
    label: "Demo · IVA RI v2.1.0",
  },
];

// Versión activa de origen: el clon copia la última versión del paquete y su motor.
function detalleConOrigen(origen: Record<string, unknown>) {
  const detail = makeDemoDetail();
  // Régimen con familia de cálculo: el cajón puede consultar sus motores.
  detail.regime = { ...detail.regime, calcFamilyId: "fam-vat" };
  detail.versions = [makeDemoVersion(origen as never)];
  return detail;
}

function motoresDe(detail: { regime: { id: string } }) {
  return { [`/tax/regimes/${detail.regime.id}/engines`]: () => Promise.resolve(MOTORES) };
}

async function abrirCajonClon(): Promise<HTMLElement> {
  const botones = await screen.findAllByRole(
    "button",
    { name: "Crear a partir de este" },
    { timeout: 5000 },
  );
  fireEvent.click(botones[0] as HTMLElement);
  return screen.findByRole("dialog", undefined, { timeout: 5000 });
}

describe("Reglas fiscales — motor al crear un borrador desde una versión (D-R3-E)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contextMock.current = demoContext();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("sin cambiar el motor, el clon envía solo la vigencia", async () => {
    const origen = {
      id: "version-1",
      version: 1,
      status: "ACTIVE",
      engineVersion: "ar-vat-ri-v1.0.0",
    };
    const detalle = detalleConOrigen(origen);
    mockDemoApi(detalle, motoresDe(detalle));
    vi.mocked(api.post).mockResolvedValue({} as never);
    renderDemoReglas();

    const dialog = await abrirCajonClon();
    fireEvent.click(within(dialog).getByRole("button", { name: "Crear borrador y editar" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(expect.stringContaining("/versions/clone"), {
        validFrom: expect.any(String),
      }),
    );
  });

  it("el selector Opción de cálculo viene con el motor de la versión de origen", async () => {
    const origen = {
      id: "version-1",
      version: 1,
      status: "ACTIVE",
      engineId: "eng-vat-1",
      engineVersion: "ar-vat-ri-v1.0.0",
    };
    const detalle = detalleConOrigen(origen);
    mockDemoApi(detalle, motoresDe(detalle));
    renderDemoReglas();

    const dialog = await abrirCajonClon();
    await within(dialog).findByLabelText("Opción de cálculo");
    expect(valorElegido("Opción de cálculo", dialog)).toBe("eng-vat-1");
  });

  it("elegir otro motor envía engineId del motor elegido", async () => {
    const origen = {
      id: "version-1",
      version: 1,
      status: "ACTIVE",
      engineId: "eng-vat-1",
      engineVersion: "ar-vat-ri-v1.0.0",
    };
    const detalle = detalleConOrigen(origen);
    mockDemoApi(detalle, motoresDe(detalle));
    vi.mocked(api.post).mockResolvedValue({} as never);
    renderDemoReglas();

    const dialog = await abrirCajonClon();
    cambiarValor(await within(dialog).findByLabelText("Opción de cálculo"), "eng-vat-2");
    fireEvent.click(within(dialog).getByRole("button", { name: "Crear borrador y editar" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining("/versions/clone"),
        expect.objectContaining({ engineId: "eng-vat-2", validFrom: expect.any(String) }),
      ),
    );
  });

  // Sin motor identificable (no trae engineId y su engineVersion no está en el catálogo): aviso y sin preselección.
  it("sin motor identificable, el cajón avisa y deja el selector sin preselección", async () => {
    const origen = { id: "version-1", version: 1, status: "ACTIVE", engineVersion: "ar-legado-v0" };
    const detalle = detalleConOrigen(origen);
    mockDemoApi(detalle, motoresDe(detalle));
    renderDemoReglas();

    const dialog = await abrirCajonClon();
    expect((await within(dialog).findByRole("note")).textContent).toContain(
      "No pudimos identificar el motor",
    );
    expect(
      ((await within(dialog).findByLabelText("Opción de cálculo")) as HTMLSelectElement).value,
    ).toBe("");
  });

  it("un fallo del catálogo de motores en el cajón muestra Reintentar", async () => {
    const origen = {
      id: "version-1",
      version: 1,
      status: "ACTIVE",
      engineId: "eng-vat-1",
      engineVersion: "ar-vat-ri-v1.0.0",
    };
    const detalle = detalleConOrigen(origen);
    mockDemoApi(detalle, {
      [`/tax/regimes/${detalle.regime.id}/engines`]: () =>
        Promise.reject(new ApiError("INTERNAL_ERROR", "Falló", 500)),
    });
    renderDemoReglas();

    const dialog = await abrirCajonClon();
    expect(
      await within(dialog).findByRole("button", { name: "Reintentar" }, { timeout: 12000 }),
    ).toBeTruthy();
  }, 20000);

  it("un 400 del clon se muestra junto al botón con su motivo", async () => {
    const origen = {
      id: "version-1",
      version: 1,
      status: "ACTIVE",
      engineVersion: "ar-vat-ri-v1.0.0",
    };
    const detalle = detalleConOrigen(origen);
    mockDemoApi(detalle, motoresDe(detalle));
    vi.mocked(api.post).mockRejectedValue(
      new ApiError("VALIDATION_ERROR", "Datos inválidos", 400, null, {
        code: "VALIDATION_ERROR",
        message: "Datos inválidos",
        details: [
          { path: ["engineId"], message: "El motor seleccionado no existe o está inactivo" },
        ],
      } as never),
    );
    renderDemoReglas();

    const dialog = await abrirCajonClon();
    fireEvent.click(within(dialog).getByRole("button", { name: "Crear borrador y editar" }));
    expect(
      await within(dialog).findByText(/El motor seleccionado no existe o está inactivo/),
    ).toBeTruthy();
  });
});
