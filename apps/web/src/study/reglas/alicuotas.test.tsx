// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaxRuleKindOption } from "@contable/contracts";
import type { ClientContextValue } from "../../context/ClientContext";
import { api } from "../../lib/api";
import {
  demoContext,
  makeDemoDetail,
  makeDemoRule,
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

const kindActivity: TaxRuleKindOption = { id: "kind-activity", key: "RATE", label: "Alícuota por actividad", subject: "ACTIVITY" };
const kindActivityDefault: TaxRuleKindOption = {
  id: "kind-activity-default",
  key: "RATE_DEFAULT",
  label: "Alícuota por actividad o general",
  subject: "ACTIVITY_OR_DEFAULT",
};
const kindJurisdiction: TaxRuleKindOption = {
  id: "kind-jurisdiction",
  key: "RATE_JURISDICTION",
  label: "Alícuota por jurisdicción",
  subject: "JURISDICTION_OR_DEFAULT",
};
const kindCategory: TaxRuleKindOption = { id: "kind-category", key: "FEE", label: "Cuota por categoría", subject: "CATEGORY" };

// Las columnas se miran dentro de la sección del editor: la lista de paquetes también tiene una columna «Jurisdicción».
async function seccionAlicuotas(): Promise<HTMLElement> {
  return (await screen.findByRole("heading", { name: "Alícuotas y porcentajes" })).closest("section") as HTMLElement;
}

function conTipos(tipos: TaxRuleKindOption[]) {
  return { "/tax/regimes/regime-1/rule-kinds": () => Promise.resolve(tipos) };
}

function filaDeDemo(overrides: Parameters<typeof makeDemoRule>[0]) {
  const detail = makeDemoDetail();
  detail.versions = [makeDemoVersion({ rateRules: [makeDemoRule(overrides)] })];
  return detail;
}

describe("Reglas fiscales — editor de alícuotas (K6)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contextMock.current = demoContext();
    vi.mocked(api.put).mockResolvedValue({} as never);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("muestra solo la columna que pide el tipo de regla: Actividad", async () => {
    mockDemoApi(makeDemoDetail(), conTipos([kindActivity]));
    renderDemoReglas();

    const tabla = within(await seccionAlicuotas());
    expect(await tabla.findByRole("columnheader", { name: "Actividad" })).toBeTruthy();
    expect(tabla.queryByRole("columnheader", { name: "Jurisdicción" })).toBeNull();
    expect(tabla.queryByRole("columnheader", { name: "Categoría" })).toBeNull();
  });

  it("muestra la columna Jurisdicción para un tipo por jurisdicción", async () => {
    mockDemoApi(filaDeDemo({ kindId: "kind-jurisdiction", activityId: null, activityCode: null }), conTipos([kindJurisdiction]));
    renderDemoReglas();

    const tabla = within(await seccionAlicuotas());
    expect(await tabla.findByRole("columnheader", { name: "Jurisdicción" })).toBeTruthy();
    expect(tabla.queryByRole("columnheader", { name: "Actividad" })).toBeNull();
    expect(tabla.queryByRole("columnheader", { name: "Categoría" })).toBeNull();
  });

  it("muestra la columna Categoría para un tipo por categoría", async () => {
    mockDemoApi(filaDeDemo({ kindId: "kind-category", activityId: null, activityCode: null, categoryCode: "B" }), conTipos([kindCategory]));
    renderDemoReglas();

    const tabla = within(await seccionAlicuotas());
    expect(await tabla.findByRole("columnheader", { name: "Categoría" })).toBeTruthy();
    expect(tabla.queryByRole("columnheader", { name: "Actividad" })).toBeNull();
    expect(tabla.queryByRole("columnheader", { name: "Jurisdicción" })).toBeNull();
  });

  it("cambiar el tipo limpia actividad, jurisdicción, categoría e isDefault", async () => {
    mockDemoApi(
      filaDeDemo({
        kindId: "kind-jurisdiction",
        activityId: "act-1",
        activityCode: "DEMO-A1",
        jurisdictionId: "jur-1",
        categoryCode: "K",
        isDefault: true,
      }),
      conTipos([kindActivity, kindJurisdiction, kindCategory]),
    );
    renderDemoReglas();

    fireEvent.change(await screen.findByLabelText("Tipo de regla de la fila 1"), {
      target: { value: "kind-activity" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/tax/rule-versions/version-1/rate-rules", {
        rules: [
          {
            concept: "Demo · Operaciones generales",
            kindId: "kind-activity",
            isDefault: false,
            rate: "21",
            validFrom: "2026-01-01",
          },
        ],
      }),
    );
  });

  it("«Todas las actividades» guarda isDefault en verdadero", async () => {
    mockDemoApi(
      filaDeDemo({ kindId: "kind-activity-default", activityId: null, activityCode: null }),
      conTipos([kindActivityDefault]),
    );
    renderDemoReglas();

    fireEvent.change(await screen.findByLabelText("Actividad de la fila 1"), { target: { value: "__all__" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/tax/rule-versions/version-1/rate-rules", {
        rules: [
          {
            concept: "Demo · Operaciones generales",
            kindId: "kind-activity-default",
            isDefault: true,
            rate: "21",
            validFrom: "2026-01-01",
          },
        ],
      }),
    );
  });

  it("«Todas las jurisdicciones» guarda isDefault en verdadero", async () => {
    mockDemoApi(
      filaDeDemo({ kindId: "kind-jurisdiction", activityId: null, activityCode: null }),
      conTipos([kindJurisdiction]),
    );
    renderDemoReglas();

    fireEvent.change(await screen.findByLabelText("Jurisdicción de la fila 1"), { target: { value: "__all__" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/tax/rule-versions/version-1/rate-rules", {
        rules: [
          {
            concept: "Demo · Operaciones generales",
            kindId: "kind-jurisdiction",
            isDefault: true,
            rate: "21",
            validFrom: "2026-01-01",
          },
        ],
      }),
    );
  });

  it("agrega una fila con Agregar regla y la quita con Quitar", async () => {
    mockDemoApi(makeDemoDetail(), conTipos([kindActivity]));
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Agregar regla" }));
    expect(await screen.findByLabelText("Concepto de la fila 2")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Guardar borrador" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Completá la tasa, cuota o importe de cada fila/)).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Quitar" })[1]!);
    expect(screen.queryByLabelText("Concepto de la fila 2")).toBeNull();
    expect(screen.getByLabelText("Concepto de la fila 1")).toBeTruthy();
  });

  it("guarda el borrador completo con actividad, mínimo y vigencia hasta", async () => {
    mockDemoApi(
      filaDeDemo({ minAmount: "1000", validTo: "2026-12-31" }),
      conTipos([kindActivity]),
    );
    renderDemoReglas();

    fireEvent.click(await screen.findByRole("button", { name: "Guardar borrador" }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/tax/rule-versions/version-1/rate-rules", {
        rules: [
          {
            concept: "Demo · Operaciones generales",
            kindId: "kind-activity",
            activityId: "act-1",
            activityCode: "DEMO-A1",
            isDefault: false,
            rate: "21",
            minAmount: "1000",
            validFrom: "2026-01-01",
            validTo: "2026-12-31",
          },
        ],
      }),
    );
  });

  it("sin tipo de regla señala la fila y no guarda", async () => {
    mockDemoApi(makeDemoDetail(), conTipos([kindActivity]));
    renderDemoReglas();

    fireEvent.change(await screen.findByLabelText("Tipo de regla de la fila 1"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));

    const error = await screen.findByText("Seleccioná un tipo de regla.");
    expect(error.getAttribute("role")).toBe("alert");
    expect(api.put).not.toHaveBeenCalled();
  });
});
