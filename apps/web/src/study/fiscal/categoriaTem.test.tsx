// @vitest-environment jsdom
// Categoría anual del TEM en Configuración fiscal → Regímenes (corte 1E). Datos sintéticos.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { api, ApiError } from "../../lib/api";
import { StudyOnboardingFiscal } from "../StudyOnboardingFiscal";
import { PestanaRegimenes } from "./pestanas/PestanaRegimenes";
import { CajonCategoriaTem } from "./cajones/CajonCategoriaTem";
import { importeEnPesos, type CategoriaTemEstado, type FilaCategoriaTem } from "./categoriaTem";

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

const ANIO = new Date().getUTCFullYear();

const OPCIONES = [
  { category: "A", label: "A", minimum: "6210.00" },
  { category: "B", label: "B", minimum: "10028.00" },
  { category: "GRANDE", label: "Grande", minimum: "67298.00" },
];

const regimenTem = {
  id: "reg-tem",
  code: "REG-SINTETICO-TEM",
  name: "TEM Sintético",
  isActive: true,
  taxType: { id: "tax-tem", name: "Tributo Económico Municipal", isActive: true },
  jurisdiction: { name: "Municipio Sintético", isActive: true },
};
const regimenIva = {
  id: "reg-iva",
  code: "REG-SINTETICO-IVA",
  name: "IVA Sintético",
  isActive: true,
  taxType: { id: "tax-iva", name: "IVA", isActive: true },
  jurisdiction: { name: "Argentina", isActive: true },
};
const inscripcion = (id: string, regime: unknown, status = "ACTIVE") => ({
  id,
  status,
  validFrom: "2026-01-01",
  validTo: null,
  registrationNumber: null,
  regime,
});

const estado = (category: string | null): CategoriaTemEstado => {
  const elegida = OPCIONES.find((opcion) => opcion.category === category);
  return {
    year: ANIO,
    category: elegida?.category ?? null,
    label: elegida?.label ?? null,
    minimum: elegida?.minimum ?? null,
    options: OPCIONES,
    regimeIds: ["reg-tem"],
  };
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Regímenes: fila del TEM con su categoría anual", () => {
  const fila = (parcial: Partial<FilaCategoriaTem> = {}): FilaCategoriaTem => ({
    year: ANIO,
    regimeIds: ["reg-tem"],
    category: null,
    label: null,
    loading: false,
    abrir: vi.fn(),
    ...parcial,
  });
  const montar = (categoriaTem: FilaCategoriaTem, canWrite = true, status = "ACTIVE") =>
    render(
      <PestanaRegimenes
        canWrite={canWrite}
        openStepForm={() => undefined}
        registrationsQuery={{ data: [inscripcion("fila-tem", regimenTem, status), inscripcion("fila-iva", regimenIva)], isLoading: false } as never}
        cancelRegistration={{ isPending: false } as never}
        corregirFecha={() => undefined}
        confirm={{} as never}
        categoriaTem={categoriaTem}
      />,
    );

  it("con categoría: dice «Categoría <año>: B» y ofrece cambiarla", () => {
    const categoria = fila({ category: "B", label: "B" });
    montar(categoria);
    expect(screen.getByText(`Categoría ${ANIO}: B`)).toBeTruthy();
    expect(screen.queryByText(`Falta la categoría TEM ${ANIO}`)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cambiar categoría" }));
    expect(categoria.abrir).toHaveBeenCalledTimes(1);
  });

  it("sin categoría: dice qué falta y ofrece elegirla", () => {
    const categoria = fila();
    montar(categoria);
    expect(screen.getByText(`Falta la categoría TEM ${ANIO}`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Elegir categoría" }));
    expect(categoria.abrir).toHaveBeenCalledTimes(1);
  });

  it("solo la fila del TEM la muestra: la de IVA queda igual", () => {
    montar(fila());
    expect(screen.getAllByText(`Falta la categoría TEM ${ANIO}`)).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Elegir categoría" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Dar de baja" })).toHaveLength(2);
  });

  it("sin permiso de escritura informa la categoría pero no ofrece cambiarla", () => {
    montar(fila({ category: "B", label: "B" }), false);
    expect(screen.getByText(`Categoría ${ANIO}: B`)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cambiar categoría" })).toBeNull();
  });

  it("una inscripción dada de baja no muestra la categoría", () => {
    montar(fila(), true, "CANCELLED");
    expect(screen.queryByText(`Falta la categoría TEM ${ANIO}`)).toBeNull();
  });

  it("sin la prop, la tabla se ve como antes", () => {
    render(
      <PestanaRegimenes
        canWrite
        openStepForm={() => undefined}
        registrationsQuery={{ data: [inscripcion("fila-tem", regimenTem)], isLoading: false } as never}
        cancelRegistration={{ isPending: false } as never}
        corregirFecha={() => undefined}
        confirm={{} as never}
      />,
    );
    expect(screen.queryByText(/categoría/i)).toBeNull();
  });
});

describe("Cajón de la categoría TEM", () => {
  const guardar = () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null as unknown });
  const montar = (opciones: { estado?: CategoriaTemEstado; guardar?: ReturnType<typeof guardar> } = {}) => {
    const g = opciones.guardar ?? guardar();
    render(<CajonCategoriaTem isOpen onClose={() => undefined} year={ANIO} estado={opciones.estado ?? estado(null)} cargando={false} guardar={g} />);
    return g;
  };

  it("lista las categorías con su mínimo y explica el mínimo de la elegida", () => {
    montar();
    const dialogo = screen.getByRole("dialog", { name: `Categoría TEM ${ANIO}` });
    const select = within(dialogo).getByLabelText(`Categoría ${ANIO}`);
    expect([...select.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "Elegí una categoría…",
      "A — mínimo mensual $ 6.210",
      "B — mínimo mensual $ 10.028",
      "Grande — mínimo mensual $ 67.298",
    ]);
    fireEvent.change(select, { target: { value: "B" } });
    expect(screen.getByText("Categoría anual según la DIM. Define el mínimo mensual: $ 10.028 en B.")).toBeTruthy();
  });

  it("guarda la categoría elegida", () => {
    const g = montar();
    fireEvent.change(screen.getByLabelText(`Categoría ${ANIO}`), { target: { value: "GRANDE" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar categoría" }));
    expect(g.mutate).toHaveBeenCalledWith("GRANDE");
  });

  it("guardar sin elegir señala el campo y no llama a la API (el botón sigue habilitado)", () => {
    const g = montar();
    const boton = screen.getByRole("button", { name: "Guardar categoría" }) as HTMLButtonElement;
    expect(boton.disabled).toBe(false);
    fireEvent.click(boton);
    expect(g.mutate).not.toHaveBeenCalled();
    const campo = screen.getByLabelText(`Categoría ${ANIO}`);
    expect(campo.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Elegí la categoría TEM del año.")).toBeTruthy();
  });

  it("muestra junto al campo el motivo que devuelve la API", () => {
    const g = guardar();
    g.error = new ApiError("TEM_CATEGORY_UNKNOWN", "La categoría \"Z\" no existe para 2026.", 422, null, {
      code: "TEM_CATEGORY_UNKNOWN",
      message: "La categoría \"Z\" no existe para 2026.",
      details: { path: ["category"] },
    });
    montar({ guardar: g });
    expect(screen.getByText("La categoría \"Z\" no existe para 2026.")).toBeTruthy();
    expect(screen.getByLabelText(`Categoría ${ANIO}`).getAttribute("aria-invalid")).toBe("true");
  });

  it("sin mínimos cargados para el año lo dice junto al botón", () => {
    montar({ estado: { ...estado(null), options: [] } });
    expect(screen.getByText(`Todavía no hay mínimos del TEM cargados para ${ANIO}.`)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Guardar categoría" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("formatea el importe en pesos argentinos", () => {
    expect(importeEnPesos("10028.00")).toBe("$ 10.028");
    expect(importeEnPesos("6210.50")).toBe("$ 6.210,5");
  });
});

describe("Configuración fiscal → Regímenes: elegir la categoría TEM", () => {
  beforeEach(() => {
    contextMock.current = {
      firmId: "firm-a",
      clientId: "client-synthetic",
      periodId: null,
      isReady: true,
      capabilities: new Set(["tax.profile.read", "tax.profile.write"]),
      hasClientAccess: (id) => id === "client-synthetic",
      setFirmId: vi.fn(),
      setClientId: vi.fn(),
      setPeriodId: vi.fn(),
    };
  });

  it("falta → se elige B en el cajón → la fila pasa a «Categoría <año>: B»", async () => {
    vi.mocked(api.get).mockImplementation(((ruta: string) => {
      if (ruta.includes("/tem-categories")) return Promise.resolve(estado(null));
      if (ruta.endsWith("/tax-registrations")) return Promise.resolve([inscripcion("fila-tem", regimenTem)]);
      if (ruta.endsWith("/clients/client-synthetic")) return Promise.resolve({ cuit: "20111111112", cuitEnding: "2" });
      return Promise.resolve([]);
    }) as never);
    vi.mocked(api.put).mockResolvedValue(estado("B") as never);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <MemoryRouter>
          <StudyOnboardingFiscal />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("tab", { name: /Regímenes/ }));
    expect(await screen.findByText(`Falta la categoría TEM ${ANIO}`)).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith(`/firms/firm-a/clients/client-synthetic/tem-categories?year=${ANIO}`);

    fireEvent.click(screen.getByRole("button", { name: "Elegir categoría" }));
    const cajon = await screen.findByRole("dialog", { name: `Categoría TEM ${ANIO}` });
    fireEvent.change(within(cajon).getByLabelText(`Categoría ${ANIO}`), { target: { value: "B" } });
    fireEvent.click(within(cajon).getByRole("button", { name: "Guardar categoría" }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(`/firms/firm-a/clients/client-synthetic/tem-categories/${ANIO}`, { category: "B" }),
    );
    expect(await screen.findByText(`Categoría ${ANIO}: B`)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Cambiar categoría" })).toBeTruthy();
  });
});
