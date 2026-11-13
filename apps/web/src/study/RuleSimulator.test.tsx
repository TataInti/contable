// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { RuleSimulator } from "./RuleSimulator";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, api: { post: vi.fn() } as unknown as typeof actual.api };
});

const rules = [
  { id: "rule-comercio", concept: "COMERCIO", activityCode: null, rate: "2" },
  { id: "rule-minimo", concept: "MINIMO", activityCode: null, rate: null },
];

function renderSimulator(props: Partial<Parameters<typeof RuleSimulator>[0]> = {}) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <RuleSimulator
        versionId="version-2"
        versionNumber={2}
        isDraft
        hasUnsavedChanges={false}
        rules={rules}
        {...props}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RuleSimulator", () => {
  it("envía el caso y muestra el resultado comparado con la versión activa", async () => {
    vi.mocked(api.post).mockResolvedValue({
      engine: { key: "tem-smt", label: "TEM San Miguel de Tucumán" },
      period: { startDate: "2027-01-01", endDate: "2027-01-31" },
      result: {
        versionId: "version-2",
        version: 2,
        status: "DRAFT",
        lines: [{ concept: "ACTIVIDAD_COMERCIO", formula: "ingresos × alícuota", inputs: {}, result: "4000.00" }],
        subtotals: { TOTAL_A_INGRESAR: "4000.00" },
        totalDue: "4000.00",
        warnings: [],
        blocks: [],
      },
      comparison: {
        versionId: "version-1",
        version: 1,
        status: "ACTIVE",
        lines: [{ concept: "ACTIVIDAD_COMERCIO", formula: "ingresos × alícuota", inputs: {}, result: "2000.00" }],
        subtotals: { TOTAL_A_INGRESAR: "2000.00" },
        totalDue: "2000.00",
        warnings: [],
        blocks: [],
      },
      unmatchedInComparison: [],
    } as never);
    renderSimulator();

    // Sólo las reglas con alícuota piden un ingreso; el mínimo no.
    expect(screen.queryByLabelText(/MINIMO/)).toBeNull();
    const submit = screen.getByRole<HTMLButtonElement>("button", { name: "Probar" });
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("COMERCIO · 2 %"), { target: { value: "100000" } });
    fireEvent.click(submit);

    expect(await screen.findByText("Actividad comercio")).toBeTruthy();
    expect(vi.mocked(api.post)).toHaveBeenCalledWith("/tax/rule-versions/version-2/simulate", {
      incomes: [{ ruleId: "rule-comercio", amount: "100000" }],
    });
    expect(screen.getByText("Activa v1")).toBeTruthy();
    expect(screen.getByText(/cambia en \+ \$\s2\.000,00 respecto de la versión activa/)).toBeTruthy();
  });

  it("avisa que la prueba usa las reglas guardadas cuando hay cambios sin guardar", () => {
    renderSimulator({ hasUnsavedChanges: true });
    expect(screen.getByText(/La prueba usa las reglas guardadas/)).toBeTruthy();
  });

  it("muestra el motivo cuando el servidor no puede probar ese impuesto", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("Todavía no se puede probar este impuesto."));
    renderSimulator();
    fireEvent.change(screen.getByLabelText("COMERCIO · 2 %"), { target: { value: "100000" } });
    fireEvent.click(screen.getByRole("button", { name: "Probar" }));
    expect(await screen.findByText("Todavía no se puede probar este impuesto.")).toBeTruthy();
  });
});
