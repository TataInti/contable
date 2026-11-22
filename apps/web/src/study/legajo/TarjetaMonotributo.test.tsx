// @vitest-environment jsdom
// Tarjeta «Monotributo — cuota de <mes>» del Legajo (corte 3F). Datos sintéticos.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { importeDeEntrada, importeParaEntrada, type EstadoMonotributo } from "../fiscal/monotributo";
import { TarjetaMonotributo } from "./TarjetaMonotributo";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
    } as unknown as typeof actual.api,
  };
});

const FIRMA = "firma-sintetica";
const CLIENTE = "cliente-sintetico";
const MES = "2026-08";

const base: EstadoMonotributo = {
  month: MES,
  applies: true,
  regimeIds: ["reg-monotributo"],
  status: "SIN_CATEGORIA",
  category: null,
  fee: null,
  feeSource: null,
  dueDate: "2026-08-20",
  paid: "0.00",
  pending: null,
  payments: [],
  history: [],
  catalog: [],
};

const conCategoria: EstadoMonotributo = {
  ...base,
  status: "PENDIENTE",
  category: { id: "c1", validFrom: "2026-08-01", category: "C", activity: "SERVICIOS" },
  fee: "66020.12",
  feeSource: "ARCA",
  paid: "0.00",
  pending: "66020.12",
};

function renderTarjeta(puedePagar = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TarjetaMonotributo firmId={FIRMA} clientId={CLIENTE} month={MES} puedePagar={puedePagar} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
});

afterEach(() => {
  cleanup();
});

describe("tarjeta del Monotributo en el Legajo", () => {
  it("sin categoría dice qué falta y ofrece ir a Configuración fiscal, sin botón de pago", async () => {
    vi.mocked(api.get).mockResolvedValue(base);
    renderTarjeta();
    expect(await screen.findByText("Falta elegir la categoría de monotributo para agosto de 2026. Se elige en Configuración fiscal, Regímenes.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ir a Configuración fiscal" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Registrar pago" })).toBeNull();
    expect(api.get).toHaveBeenCalledWith(`/firms/${FIRMA}/clients/${CLIENTE}/monotributo?month=${MES}`);
  });

  it("con categoría muestra la cuota oficial, el vencimiento el día 20 y el estado", async () => {
    vi.mocked(api.get).mockResolvedValue(conCategoria);
    renderTarjeta();
    expect(await screen.findByText("Categoría C · Servicios")).toBeTruthy();
    expect(screen.getByText("$ 66.020,12")).toBeTruthy();
    expect(screen.getByText("20/08/2026")).toBeTruthy();
    expect(screen.getByText("Pendiente de pago")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Registrar pago" })).toBeTruthy();
  });

  it("registra un pago con el importe de la cuota y lo envía a la API", async () => {
    vi.mocked(api.get).mockResolvedValue(conCategoria);
    vi.mocked(api.post).mockResolvedValue({ ...conCategoria, status: "PAGADA", paid: "66020.12", pending: "0.00" });
    renderTarjeta();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar pago" }));
    const importe = (await screen.findByLabelText("Importe")) as HTMLInputElement;
    expect(importe.value).toBe("66.020,12");
    fireEvent.click(document.querySelector<HTMLButtonElement>("button[form='monotributo-pago-form']")!);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`/firms/${FIRMA}/clients/${CLIENTE}/monotributo/payments`, {
        month: MES,
        paidAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        amount: "66020.12",
      }),
    );
  });

  it("un importe que no es mayor que cero se señala al tipear y no se envía", async () => {
    vi.mocked(api.get).mockResolvedValue(conCategoria);
    renderTarjeta();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar pago" }));
    const importe = (await screen.findByLabelText("Importe")) as HTMLInputElement;
    fireEvent.change(importe, { target: { value: "0" } });
    fireEvent.click(document.querySelector<HTMLButtonElement>("button[form='monotributo-pago-form']")!);
    expect(await screen.findByText("El importe debe ser mayor que cero, con hasta dos decimales.")).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("sin Monotributo inscripto no muestra nada", async () => {
    vi.mocked(api.get).mockResolvedValue({ ...base, applies: false, status: "NO_APLICA", regimeIds: [] });
    const { container } = renderTarjeta();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(container.querySelector(".monotributo-card")).toBeNull();
  });
});

describe("importes de entrada en formato argentino", () => {
  it("acepta coma decimal y punto de miles, y normaliza a dos decimales", () => {
    expect(importeDeEntrada("30.000,50")).toBe("30000.50");
    expect(importeDeEntrada("30000")).toBe("30000.00");
    expect(importeDeEntrada("12.5")).toBe("12.50");
    expect(importeDeEntrada("1.234")).toBe("1234.00");
    expect(importeDeEntrada(" $ 34.530,58 ")).toBe("34530.58");
  });

  it("rechaza cero, negativos, texto y más de dos decimales", () => {
    expect(importeDeEntrada("0")).toBeNull();
    expect(importeDeEntrada("-5")).toBeNull();
    expect(importeDeEntrada("abc")).toBeNull();
    expect(importeDeEntrada("1,234")).toBeNull();
    expect(importeDeEntrada("")).toBeNull();
  });

  it("muestra el importe guardado con el mismo formato", () => {
    expect(importeParaEntrada("34530.58")).toBe("34.530,58");
  });
});
