// @vitest-environment jsdom
// Corte 1F: inscripción con «Desde», corrección de la fecha, «Abrir mes» que guía y períodos corregibles.
// Datos sintéticos; la fecha de hoy se fija en el 22/11/2026 (el mes anterior es octubre de 2026).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "@contable/design-system";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { api } from "../../lib/api";
import { StudyOnboardingFiscal } from "../StudyOnboardingFiscal";
import { fechaLarga, inscripcionesSinCobertura, primerDiaMesAnterior } from "./fechas";
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

const IIBB = { id: "tax-iibb", code: "IIBB", name: "Ingresos Brutos", isActive: true };
const regimenIibb = {
  id: "reg-iibb",
  code: "IIBB_LOCAL_TUC",
  name: "IIBB Contribuyente Local Tucumán",
  isActive: true,
  taxType: { id: "tax-iibb", name: "Ingresos Brutos", isActive: true },
  jurisdiction: { name: "Provincia de Tucumán", isActive: true },
};
const regimenTem = {
  id: "reg-tem",
  code: "TEM_SMT",
  name: "TEM San Miguel de Tucumán",
  isActive: true,
  taxType: { id: "tax-tem", name: "Tasa de Actividades Económicas (TEM)", isActive: true },
  jurisdiction: { name: "San Miguel de Tucumán", isActive: true },
};
const perfilActivo = {
  id: "profile-1",
  version: 1,
  legalName: "Cliente SINTÉTICO",
  cuit: "20111111112",
  personType: "FISICA",
  nationalCondition: "MONOTRIBUTISTA",
  fiscalAddress: null,
  status: "ACTIVE",
};
const inscripcionIibbHoy = { id: "row-iibb", status: "ACTIVE", validFrom: "2026-11-21", validTo: null, registrationNumber: null, regime: regimenIibb };
const inscripcionTemHoy = { id: "row-tem", status: "ACTIVE", validFrom: "2026-11-21", validTo: null, registrationNumber: null, regime: regimenTem };
const periodoMalCargado = { id: "period-mal", taxTypeId: "tax-iibb", startDate: "2026-11-21", endDate: "2026-11-21", label: null, taxType: IIBB };
const periodoConObligacion = { id: "period-ok", taxTypeId: "tax-iibb", startDate: "2026-09-01", endDate: "2026-09-30", label: "Septiembre 2026", taxType: IIBB };
const obligacionSeptiembre = {
  id: "obl-1",
  status: "PENDING",
  dueDate: "2026-10-20",
  regime: regimenIibb,
  period: { id: "period-ok", label: "Septiembre 2026", startDate: "2026-09-01", endDate: "2026-09-30" },
};

interface Datos {
  inscripciones: unknown[];
  periodos: unknown[];
  obligaciones: unknown[];
}

function montar({ datos = {}, capacidades = ["tax.profile.read", "tax.profile.write"] }: { datos?: Partial<Datos>; capacidades?: string[] } = {}) {
  const d: Datos = { inscripciones: [], periodos: [], obligaciones: [], ...datos };
  contextMock.current = {
    firmId: "firm-a",
    clientId: "client-synthetic",
    periodId: null,
    isReady: true,
    capabilities: new Set(capacidades),
    hasClientAccess: (id: string) => id === "client-synthetic",
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  };
  vi.mocked(api.get).mockImplementation(((ruta: string) => {
    if (ruta === "/tax/regimes") return Promise.resolve([regimenIibb, regimenTem]);
    if (ruta === "/tax/types") return Promise.resolve([IIBB]);
    if (ruta.endsWith("/tax-profile-versions")) return Promise.resolve([perfilActivo]);
    if (ruta.endsWith("/tax-periods")) return Promise.resolve(d.periodos);
    if (ruta.endsWith("/tax-obligations")) return Promise.resolve(d.obligaciones);
    if (ruta.endsWith("/tax-registrations")) return Promise.resolve(d.inscripciones);
    if (ruta.endsWith("/clients/client-synthetic")) return Promise.resolve({ cuit: "20111111112", cuitEnding: "2" });
    return Promise.resolve([]);
  }) as never);
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <ToastProvider>
        <MemoryRouter>
          <StudyOnboardingFiscal />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const BASE = "/firms/firm-a/clients/client-synthetic";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-22T15:00:00Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("fechas del corte 1F", () => {
  it("el sugerido es el primer día del mes anterior, también en enero", () => {
    expect(primerDiaMesAnterior(new Date("2026-11-22T15:00:00Z"))).toBe("2026-10-01");
    expect(primerDiaMesAnterior(new Date("2027-01-05T15:00:00Z"))).toBe("2026-12-01");
  });

  it("usa el día calendario de Argentina: el 1/12 a las 00:30 todavía es noviembre", () => {
    expect(primerDiaMesAnterior(new Date("2026-12-01T03:30:00Z"))).toBe("2026-11-01");
    expect(primerDiaMesAnterior(new Date("2026-12-01T02:30:00Z"))).toBe("2026-10-01");
  });

  it("escribe la fecha larga sin pasar por el huso horario", () => {
    expect(fechaLarga("2026-10-01")).toBe("1 de octubre de 2026");
    expect(fechaLarga("2026-12-31")).toBe("31 de diciembre de 2026");
    expect(fechaLarga("")).toBe("");
  });

  it("detecta las inscripciones vigentes que empiezan después del mes", () => {
    const filas = [inscripcionIibbHoy, { ...inscripcionTemHoy, validFrom: "2026-10-31" }, { ...inscripcionTemHoy, id: "x", status: "CANCELLED" }];
    expect(inscripcionesSinCobertura(filas as never, "2026-10").map((fila) => fila.id)).toEqual(["row-iibb"]);
    expect(inscripcionesSinCobertura(filas as never, "")).toEqual([]);
  });
});

describe("Registrar inscripción pide «Desde»", () => {
  async function abrirCajon() {
    montar({ datos: { inscripciones: [] } });
    fireEvent.click(await screen.findByRole("tab", { name: /Regímenes/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Agregar" }));
    return screen.findByRole("dialog", { name: "Registrar inscripción" });
  }

  it("propone el 1 de octubre, explica para qué sirve y lo muestra en dd/mm/aaaa y en letras", async () => {
    const cajon = await abrirCajon();
    const desde = within(cajon).getByLabelText("Desde") as HTMLInputElement;
    expect(desde.type).toBe("date");
    expect(desde.value).toBe("2026-10-01");
    expect(within(cajon).getByText("Desde cuándo está inscripto el cliente. Es informativo: no impide abrir ni liquidar ningún mes.")).toBeTruthy();
    expect(within(cajon).getByText("01/10/2026 · 1 de octubre de 2026")).toBeTruthy();
  });

  it("envía el «Desde» elegido, no la vigencia del perfil", async () => {
    vi.mocked(api.post).mockResolvedValue({} as never);
    const cajon = await abrirCajon();
    cambiarValor(cajon.querySelector("#reg-regime") as HTMLSelectElement, "reg-iibb");
    cambiarValor(within(cajon).getByLabelText("Desde"), "2026-09-15");
    expect(within(cajon).getByText("15/09/2026 · 15 de septiembre de 2026")).toBeTruthy();
    fireEvent.click(within(cajon).getByRole("button", { name: "Registrar inscripción" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`${BASE}/tax-registrations`, { profileVersionId: "profile-1", regimeId: "reg-iibb", validFrom: "2026-09-15" }),
    );
  });

  it("sin fecha no envía nada y lo dice junto al campo", async () => {
    const cajon = await abrirCajon();
    cambiarValor(cajon.querySelector("#reg-regime") as HTMLSelectElement, "reg-iibb");
    cambiarValor(within(cajon).getByLabelText("Desde"), "");
    fireEvent.click(within(cajon).getByRole("button", { name: "Registrar inscripción" }));
    expect(await within(cajon).findByText("Indicá desde qué fecha está inscripto el cliente.")).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe("Corregir la fecha «Desde» desde la tabla de Regímenes", () => {
  it("cada inscripción vigente ofrece «Corregir fecha» y guarda con la edición de la API", async () => {
    vi.mocked(api.patch).mockResolvedValue({} as never);
    montar({ datos: { inscripciones: [inscripcionIibbHoy] } });
    fireEvent.click(await screen.findByRole("tab", { name: /Regímenes/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Corregir fecha" }));
    const cajon = await screen.findByRole("dialog", { name: "Corregir fecha de inscripción" });
    expect(within(cajon).getByText(/IIBB Contribuyente Local Tucumán/)).toBeTruthy();
    const desde = within(cajon).getByLabelText("Desde") as HTMLInputElement;
    expect(desde.value).toBe("2026-11-21");
    expect(within(cajon).getByText("21/11/2026 · 21 de noviembre de 2026")).toBeTruthy();

    cambiarValor(desde, "2026-10-01");
    fireEvent.click(within(cajon).getByRole("button", { name: "Guardar fecha" }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(`${BASE}/tax-registrations/row-iibb`, { validFrom: "2026-10-01" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Corregir fecha de inscripción" })).toBeNull());
  });

  it("una inscripción dada de baja no se corrige, y sin permiso de escritura no hay acción", async () => {
    montar({ datos: { inscripciones: [{ ...inscripcionIibbHoy, status: "CANCELLED" }] } });
    fireEvent.click(await screen.findByRole("tab", { name: /Regímenes/ }));
    await screen.findByText("IIBB Contribuyente Local Tucumán");
    expect(screen.queryByRole("button", { name: "Corregir fecha" })).toBeNull();
    cleanup();
    montar({ datos: { inscripciones: [inscripcionIibbHoy] }, capacidades: ["tax.profile.read"] });
    fireEvent.click(await screen.findByRole("tab", { name: /Regímenes/ }));
    await screen.findByText("IIBB Contribuyente Local Tucumán");
    expect(screen.queryByRole("button", { name: "Corregir fecha" })).toBeNull();
  });

  it("muestra el motivo que devuelve la API junto al campo", async () => {
    const { ApiError } = await import("../../lib/api");
    vi.mocked(api.patch).mockRejectedValue(new ApiError("REGISTRATION_IN_USE", "Ya hay una obligación de IIBB para el período que termina el 31/10/2026. Elegí esa fecha o una anterior", 422));
    montar({ datos: { inscripciones: [inscripcionIibbHoy] } });
    fireEvent.click(await screen.findByRole("tab", { name: /Regímenes/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Corregir fecha" }));
    const cajon = await screen.findByRole("dialog", { name: "Corregir fecha de inscripción" });
    fireEvent.click(within(cajon).getByRole("button", { name: "Guardar fecha" }));
    expect(await within(cajon).findByText(/Ya hay una obligación de IIBB/)).toBeTruthy();
  });
});

describe("«Abrir mes» guía cuando la inscripción no cubre el mes", () => {
  async function irAPeriodos(datos: Partial<Datos>) {
    montar({ datos });
    fireEvent.click(await screen.findByRole("tab", { name: /Períodos y obligaciones/ }));
    const mes = (await screen.findByLabelText("Mes a liquidar")) as HTMLInputElement;
    return mes;
  }

  it("nombra cada régimen con su «Desde» y ofrece corregir la fecha de inscripción", async () => {
    await irAPeriodos({ inscripciones: [inscripcionIibbHoy, inscripcionTemHoy] });
    const aviso = await screen.findByRole("status");
    expect(within(aviso).getByText(/octubre de 2026 no está cubierto/i)).toBeTruthy();
    expect(within(aviso).getByText(/IIBB Contribuyente Local Tucumán · desde 21\/11\/2026/)).toBeTruthy();
    expect(within(aviso).getByText(/TEM San Miguel de Tucumán · desde 21\/11\/2026/)).toBeTruthy();
    expect(within(aviso).getAllByRole("button", { name: /Corregir fecha de inscripción/ })).toHaveLength(2);
    expect(within(aviso).getByText(/no impide abrir ni liquidar el mes/)).toBeTruthy();
  });

  it("el botón abre el cajón de la inscripción elegida, con su fecha actual", async () => {
    await irAPeriodos({ inscripciones: [inscripcionIibbHoy, inscripcionTemHoy] });
    const aviso = await screen.findByRole("status");
    fireEvent.click(within(aviso).getByRole("button", { name: "Corregir fecha de inscripción de TEM San Miguel de Tucumán" }));
    const cajon = await screen.findByRole("dialog", { name: "Corregir fecha de inscripción" });
    expect(within(cajon).getByText(/TEM San Miguel de Tucumán/)).toBeTruthy();
    expect((within(cajon).getByLabelText("Desde") as HTMLInputElement).value).toBe("2026-11-21");
  });

  it("al quedar cubierto, el aviso desaparece y «Abrir mes» envía el mes", async () => {
    vi.mocked(api.post).mockResolvedValue({ label: "Octubre 2026", regimes: 1, periodsCreated: 1, obligationsCreated: 1 } as never);
    const mes = await irAPeriodos({ inscripciones: [{ ...inscripcionIibbHoy, validFrom: "2026-10-01" }] });
    expect(mes.value).toBe("2026-10");
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abrir mes" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`${BASE}/tax-periods/open-month`, { month: "2026-10" }));
    expect(await screen.findByText("Octubre 2026 quedó abierto: 1 obligación creada.")).toBeTruthy();
  });

  it("muestra el mes elegido en letras debajo del selector", async () => {
    await irAPeriodos({ inscripciones: [] });
    expect(screen.getByText("Octubre de 2026")).toBeTruthy();
    cambiarValor(screen.getByLabelText("Mes a liquidar"), "2026-09");
    expect(screen.getByText("Septiembre de 2026")).toBeTruthy();
  });
});

describe("Períodos sin obligación: corregir o anular", () => {
  async function irAPeriodos(capacidades?: string[]) {
    montar({
      datos: { periodos: [periodoMalCargado, periodoConObligacion], obligaciones: [obligacionSeptiembre] },
      ...(capacidades ? { capacidades } : {}),
    });
    fireEvent.click(await screen.findByRole("tab", { name: /Períodos y obligaciones/ }));
    await screen.findByText("Sin obligación");
  }

  it("solo el período sin obligación ofrece «Corregir» y «Anular»", async () => {
    await irAPeriodos();
    const filas = screen.getAllByRole("row");
    const sinObligacion = filas.find((fila) => within(fila).queryByText("Sin obligación"))!;
    const conObligacion = filas.find((fila) => within(fila).queryByText(/Septiembre 2026/))!;
    expect(within(sinObligacion).getByRole("button", { name: "Corregir" })).toBeTruthy();
    expect(within(sinObligacion).getByRole("button", { name: "Anular" })).toBeTruthy();
    expect(within(conObligacion).queryByRole("button", { name: "Corregir" })).toBeNull();
    expect(within(conObligacion).queryByRole("button", { name: "Anular" })).toBeNull();
  });

  it("corrige las fechas desde un cajón y las lee en dd/mm/aaaa", async () => {
    vi.mocked(api.patch).mockResolvedValue({} as never);
    await irAPeriodos();
    fireEvent.click(screen.getByRole("button", { name: "Corregir" }));
    const cajon = await screen.findByRole("dialog", { name: "Corregir período fiscal" });
    expect((within(cajon).getByLabelText("Desde") as HTMLInputElement).value).toBe("2026-11-21");
    expect((within(cajon).getByLabelText("Hasta") as HTMLInputElement).value).toBe("2026-11-21");
    cambiarValor(within(cajon).getByLabelText("Desde"), "2026-10-01");
    cambiarValor(within(cajon).getByLabelText("Hasta"), "2026-10-31");
    expect(within(cajon).getByText("01/10/2026 · 1 de octubre de 2026")).toBeTruthy();
    expect(within(cajon).getByText("31/10/2026 · 31 de octubre de 2026")).toBeTruthy();
    fireEvent.click(within(cajon).getByRole("button", { name: "Guardar período" }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(`${BASE}/tax-periods/period-mal`, { startDate: "2026-10-01", endDate: "2026-10-31", label: null }),
    );
  });

  it("no deja guardar un «Hasta» anterior al «Desde» y lo dice junto al campo", async () => {
    await irAPeriodos();
    fireEvent.click(screen.getByRole("button", { name: "Corregir" }));
    const cajon = await screen.findByRole("dialog", { name: "Corregir período fiscal" });
    cambiarValor(within(cajon).getByLabelText("Hasta"), "2026-11-01");
    expect(within(cajon).getByText("El «Hasta» no puede ser anterior al «Desde».")).toBeTruthy();
    fireEvent.click(within(cajon).getByRole("button", { name: "Guardar período" }));
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("anula el período después de confirmar", async () => {
    vi.mocked(api.del).mockResolvedValue({} as never);
    await irAPeriodos();
    fireEvent.click(screen.getByRole("button", { name: "Anular" }));
    const confirmacion = await screen.findByRole("alertdialog");
    expect(within(confirmacion).getByText(/Esta acción queda registrada en la auditoría/)).toBeTruthy();
    expect(api.del).not.toHaveBeenCalled();
    fireEvent.click(within(confirmacion).getByRole("button", { name: "Anular período" }));
    await waitFor(() => expect(api.del).toHaveBeenCalledWith(`${BASE}/tax-periods/period-mal`));
  });

  it("sin permiso de escritura no hay acciones", async () => {
    await irAPeriodos(["tax.profile.read"]);
    expect(screen.queryByRole("button", { name: "Corregir" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Anular" })).toBeNull();
  });
});
