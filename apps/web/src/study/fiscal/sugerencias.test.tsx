// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CajonRegistroSugerido } from "./cajones/CajonRegistroSugerido";
import { sugerirConfiguracionFiscal } from "./sugerencias";
import { api } from "../../lib/api";

vi.mock("../../lib/api", () => ({ api: { post: vi.fn(), put: vi.fn() } }));
const regimes = [
  {
    id: "iibb",
    code: "IIBB_LOCAL_TUC",
    name: "IIBB Tucumán",
    isActive: true,
    jurisdiction: { name: "Provincia de Tucumán" },
  },
  {
    id: "tem",
    code: "TEM_SMT",
    name: "TEM San Miguel",
    isActive: true,
    jurisdiction: { name: "San Miguel de Tucumán" },
  },
  {
    id: "mono",
    code: "MONOTRIBUTO",
    name: "Monotributo",
    isActive: true,
    jurisdiction: { name: "Argentina" },
  },
];
const activities = [
  { id: "a", code: "5610", name: "Restaurante", isActive: true, jurisdictionId: "tuc" },
];
const base = {
  cliente: { profile: { province: "Tucumán", activity: "Restaurante" } },
  perfil: { nationalCondition: "RESPONSABLE_INSCRIPTO", fiscalAddress: "San Miguel de Tucumán" },
  regimenes: regimes,
  inscripciones: [],
  actividades: activities,
  actividadesVigentes: [],
  jurisdicciones: [{ id: "tuc", name: "Provincia de Tucumán" }],
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("registro fiscal sugerido", () => {
  it("propone solo regímenes activos no inscriptos y actividad coincidente con jurisdicción", () => {
    const result = sugerirConfiguracionFiscal(base as never);
    expect(result.regimenes.map((regime) => regime.id)).toEqual(["iibb", "tem"]);
    expect(result.actividades.map((activity) => activity.id)).toEqual(["a"]);
    expect(
      sugerirConfiguracionFiscal({
        ...base,
        perfil: { nationalCondition: "MONOTRIBUTISTA", fiscalAddress: "Yerba Buena" },
      } as never).regimenes.map((regime) => regime.id),
    ).toEqual(["mono", "iibb"]);
    expect(
      sugerirConfiguracionFiscal({
        ...base,
        inscripciones: [{ status: "ACTIVE", regime: regimes[0] }],
      } as never).regimenes.map((regime) => regime.id),
    ).toEqual(["tem"]);
  });
  it("una sola confirmación respeta casillas desmarcadas y guarda categoría y actividad", async () => {
    vi.mocked(api.post).mockResolvedValue({} as never);
    vi.mocked(api.put).mockResolvedValue({} as never);
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <CajonRegistroSugerido
          open
          onClose={vi.fn()}
          firmId="firma"
          clientId="cliente"
          profileId="perfil"
          regimes={regimes.slice(0, 2) as never}
          activities={activities}
          tem={
            {
              year: 2026,
              category: null,
              options: [{ category: "B", label: "B", minimum: "10000" }],
            } as never
          }
          refresh={vi.fn()}
        />
      </QueryClientProvider>,
    );
    const dialog = screen.getByRole("dialog", { name: "Regímenes sugeridos" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /IIBB Tucumán/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Registrar" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/firms/firma/clients/cliente/tem-categories/2026", {
        category: "B",
      }),
    );
    expect(api.post).toHaveBeenCalledWith("/firms/firma/clients/cliente/tax-registrations", {
      profileVersionId: "perfil",
      regimeId: "tem",
      validFrom: expect.any(String),
    });
    expect(api.post).toHaveBeenCalledWith("/firms/firma/clients/cliente/activities", {
      profileVersionId: "perfil",
      activityId: "a",
      isPrimary: true,
    });
    expect(api.post).toHaveBeenCalledTimes(2);
  });
});
