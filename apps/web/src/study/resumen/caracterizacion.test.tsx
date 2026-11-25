// @vitest-environment jsdom
// Caracterización del Resumen del cliente (Foco 7a.1). Fija el comportamiento vigente, incluidos los
// defectos del informe (§3.1 y §4.3). Datos sintéticos rotulados «SINTÉTICO», CUIT 20111111112.
// Cada prueba que fija un defecto lleva junto a la aserción «// vigente: …» con la decisión que lo cambia.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { api, type ClientSummary } from "../../lib/api";
import { StudyResumenCliente } from "../StudyResumenCliente";
import { abrirListado, cambiarValor } from "../../test/elegirOpcion";

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

vi.mock("../../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      del: vi.fn(),
      postWithHeaders: vi.fn(),
    } as unknown as typeof actual.api,
  };
});

const FECHA = "2026-11-01T00:00:00.000Z";
const FIN = "2026-11-30T00:00:00.000Z";
const impuesto = { id: "tax-1", code: "IVA", name: "IVA", isActive: true };
const jurisdiccion = { id: "jur-1", code: "AR", name: "Argentina", isActive: true };
const regimen = { id: "regime-1", code: "REG-1", name: "Régimen general", isActive: true, taxType: impuesto, jurisdiction: jurisdiccion };
const periodo = { id: "period-1", startDate: FECHA, endDate: FIN, label: "Noviembre 2026", taxType: impuesto };
const obligacion = {
  id: "obligation-1",
  status: "PENDING",
  dueDate: "2026-12-20T00:00:00.000Z",
  profile: { version: 1 },
  regime: regimen,
  period: { id: "period-1", label: "Noviembre 2026", startDate: FECHA, endDate: FIN },
};
const perfilActivo = {
  id: "profile-1",
  version: 1,
  legalName: "Cliente SINTÉTICO A",
  cuit: "20111111112",
  personType: "JURIDICA",
  nationalCondition: "RESPONSABLE_INSCRIPTO",
  fiscalAddress: "Tucumán",
  fiscalYearEndMonth: 12,
  monotributoCategory: null,
  validFrom: FECHA,
  validTo: null,
  status: "ACTIVE",
  source: null,
  createdAt: FECHA,
};
const inscripcion = { id: "registration-1", status: "ACTIVE", validFrom: FECHA, validTo: null, registrationNumber: null, profile: { version: 1 }, regime: regimen };
const actividad = {
  id: "activity-1",
  isPrimary: true,
  validFrom: FECHA,
  validTo: null,
  profile: { version: 1 },
  activity: { id: "activity-catalog-1", code: "COMERCIO", name: "Comercio minorista", isActive: true, jurisdiction: jurisdiccion },
};
const perfilContable = {
  functionalCurrency: "ARS",
  accountingStandard: "RTIC",
  fiscalYearEndMonth: 12,
  vatCondition: "RESPONSABLE_INSCRIPTO",
  iibbJurisdictions: ["AR"],
  province: "Tucumán",
  activity: "Comercio",
  legalForm: "S.A.",
  serviceStartDate: null,
  updatedAt: FECHA,
};
const ejercicioBase = { id: "year-1", label: "2026", startDate: FECHA, endDate: "2027-10-31T00:00:00.000Z", status: "CLOSED", periods: [] };

const base = {
  perfilContable,
  onboardingCompleted: false,
  estado: "ONBOARDING",
  ejercicios: [ejercicioBase],
  perfiles: [perfilActivo],
  periodos: [periodo],
  obligaciones: [obligacion],
  inscripciones: [inscripcion],
  actividades: [actividad],
  contadores: { accounts: 1, counterparties: 2, costCenters: 3 },
};

function resumen(partes: Partial<typeof base> = {}): ClientSummary {
  const p = { ...base, ...partes };
  return {
    client: {
      id: "client-a",
      legalName: "Cliente SINTÉTICO A",
      tradeName: "SINTÉTICO",
      cuit: "20111111112",
      status: p.estado,
      createdAt: FECHA,
      updatedAt: "2026-11-09T00:00:00.000Z",
      profile: p.perfilContable,
      onboarding: { completed: p.onboardingCompleted, updatedAt: FECHA },
    },
    accounting: { fiscalYears: p.ejercicios },
    fiscal: {
      profiles: p.perfiles,
      registrations: p.inscripciones,
      activities: p.actividades,
      periods: p.periodos,
      obligations: p.obligaciones,
    },
    counts: p.contadores,
  } as unknown as ClientSummary;
}

interface Montaje {
  datos?: ClientSummary;
  contactos?: unknown[];
  capacidades?: string[];
  clienteId?: string | null;
  obtener?: (ruta: string) => Promise<unknown>;
}

function Ubicacion() {
  const { pathname } = useLocation();
  return <output data-testid="current-path">{pathname}</output>;
}

function montar({
  datos = resumen(),
  contactos = [],
  capacidades = ["client.read", "client.manage"],
  clienteId = "client-a",
  obtener,
}: Montaje = {}) {
  contextMock.current = {
    firmId: "firm-a",
    clientId: clienteId,
    periodId: null,
    isReady: true,
    capabilities: new Set(capacidades),
    hasClientAccess: (id) => id === "client-a",
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  };
  vi.mocked(api.get).mockImplementation(((ruta: string) => {
    if (obtener) return obtener(ruta);
    if (ruta.endsWith("/summary")) return Promise.resolve(datos);
    if (ruta.endsWith("/contacts")) return Promise.resolve(contactos);
    return Promise.resolve([]);
  }) as never);
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={["/resumen-cliente"]}>
        <StudyResumenCliente />
        <Ubicacion />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function irA(seccion: string) {
  const indice = screen.getByRole("navigation", { name: "Secciones internas del cliente" });
  fireEvent.click(within(indice).getByRole("button", { name: seccion }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Caracterización · Resumen del cliente: búsqueda (R1 y R2)", () => {
  it("R1 · búsqueda por CUIT, por período y sin coincidencias", async () => {
    montar({ datos: resumen({ perfiles: [] }) });
    const buscar = await screen.findByLabelText(/Buscar en este cliente/);

    cambiarValor(buscar, "20111111112");
    const porCuit = document.querySelectorAll(".client-summary__search-results li");
    expect(porCuit).toHaveLength(1);
    expect(porCuit[0]?.querySelector("strong")?.textContent).toBe("Cliente SINTÉTICO A");
    expect(porCuit[0]?.querySelector("small")?.textContent).toBe("CUIT 20111111112");
    expect(document.querySelector(".client-summary__search-status")?.textContent).toBe("1 coincidencia");

    cambiarValor(buscar, "noviembre");
    const titulos = Array.from(document.querySelectorAll(".client-summary__search-results strong"), (nodo) => nodo.textContent);
    expect(titulos).toContain("IVA · noviembre de 2026");

    cambiarValor(buscar, "zzz");
    expect(await screen.findByText("No encontramos coincidencias")).toBeTruthy();
    expect(document.querySelector(".client-summary__search-status")?.textContent).toBe("Sin coincidencias");
  });

  it("R2 · sin tope: con 8 obligaciones coincidentes la lista muestra 8 y el contador dice «8 coincidencias»", async () => {
    const obligaciones = Array.from({ length: 8 }, (_, indice) => ({
      ...obligacion,
      id: `obligation-${indice + 1}`,
      period: { ...obligacion.period, id: `period-${indice + 1}`, label: `Mes ${indice + 1}` },
    }));
    montar({ datos: resumen({ perfiles: [], periodos: [], inscripciones: [], actividades: [], obligaciones }) });

    cambiarValor(await screen.findByLabelText(/Buscar en este cliente/), "IVA");
    expect(document.querySelectorAll(".client-summary__search-results li")).toHaveLength(8);
    // defecto 3.1.1 corregido en 7a.2: sin tope por sección; el contador es el total real
    expect(document.querySelector(".client-summary__search-status")?.textContent).toBe("8 coincidencias");
  });
});

describe("Caracterización · Resumen del cliente: índice y secciones (R3 a R5)", () => {
  it("R3 · índice de 4 grupos y 7 botones (sin contable vacío) ; Obligaciones queda activa y muestra su tabla de 4 columnas y su contador", async () => {
    montar();
    await screen.findByRole("region", { name: "Datos generales" });
    const indice = screen.getByRole("navigation", { name: "Secciones internas del cliente" });
    expect(indice.querySelectorAll(".client-summary__index-group")).toHaveLength(4);
    expect(indice.querySelectorAll("button")).toHaveLength(7);

    const boton = within(indice).getByRole("button", { name: "Obligaciones" });
    fireEvent.click(boton);
    expect(boton.getAttribute("aria-current")).toBe("page");
    const seccion = await screen.findByRole("region", { name: /Obligaciones/ });
    expect(within(seccion).getAllByRole("columnheader")).toHaveLength(4);
    expect(seccion.querySelector(".dense-count")?.textContent).toBe("1");
  });

  it("R4 · el selector de sección tiene 7 opciones y «Catálogos» muestra los tres conteos", async () => {
    montar();
    const selector = await screen.findByRole("combobox", { name: "Sección del cliente" });
    expect(abrirListado("Sección del cliente").querySelectorAll('[role="option"]')).toHaveLength(7);

    cambiarValor(selector, "catalogs");
    const seccion = await screen.findByRole("region", { name: "Catálogos del cliente" });
    const filas = Array.from(seccion.querySelectorAll(".client-summary__catalog-list li"), (fila) => fila.textContent);
    expect(filas).toEqual(["Plan de cuentas1", "Contrapartes2", "Centros de costo activos3"]);
  });

  it("R5 · cada sección vacía muestra su título exacto (los períodos contables y catálogos sin datos no se listan)", async () => {
    montar({
      datos: resumen({ ejercicios: [], periodos: [], obligaciones: [], perfiles: [], inscripciones: [], actividades: [] }),
    });
    await screen.findByRole("region", { name: "Datos generales" });
    const vacios: Array<[string, string]> = [
      ["Obligaciones", "Sin obligaciones"],
      ["Perfil fiscal", "Sin perfil fiscal"],
      ["Regímenes adheridos", "Sin inscripciones"],
      ["Actividades registradas", "Sin actividades"],
    ];
    for (const [seccion, titulo] of vacios) {
      irA(seccion);
      expect(await screen.findByText(titulo)).toBeTruthy();
    }
  });
});

describe("Caracterización · Resumen del cliente: estados y datos (R6 a R9)", () => {
  it("R6 · documenta: con perfil contable y configuración fiscal completa (perfil, regímenes, actividades, períodos y obligaciones), «Ficha contable» dice «Configurada» y «Configuración fiscal» dice «Completado»", async () => {
    montar();
    const resumenSeccion = await screen.findByRole("region", { name: "Datos generales" });
    const valorDe = (etiqueta: string) => within(resumenSeccion).getByText(etiqueta, { selector: "dt" }).parentElement?.textContent;
    expect(valorDe("Ficha contable")).toContain("Configurada");
    // D4: «Configuración fiscal» del Resumen usa el mismo criterio que Configuración fiscal (pasos.ts), no el flag
    // «onboarding» que nadie actualiza. Con la configuración completa, dice «Completado».
    expect(valorDe("Configuración fiscal")).toContain("Completado");
  });

  it("R6b · D4: sin regímenes adheridos, «Configuración fiscal» del Resumen dice «Pendiente» aunque el flag «onboarding» diga otra cosa", async () => {
    montar({ datos: resumen({ inscripciones: [] }) });
    const resumenSeccion = await screen.findByRole("region", { name: "Datos generales" });
    const valorDe = (etiqueta: string) => within(resumenSeccion).getByText(etiqueta, { selector: "dt" }).parentElement?.textContent;
    expect(valorDe("Configuración fiscal")).toContain("Pendiente");
  });

  it("R7 · documenta: sin perfil ACTIVE, el domicilio fiscal de la Ficha contable sale del borrador", async () => {
    const borrador = { ...perfilActivo, id: "profile-draft", version: 2, status: "DRAFT", fiscalAddress: "Calle borrador 1" };
    montar({ datos: resumen({ perfiles: [borrador] }) });
    await screen.findByRole("region", { name: "Datos generales" });
    irA("Ficha contable");
    const ficha = await screen.findByRole("region", { name: "Ficha contable" });
    // vigente: cambia con D7A-4 (versión vigente y domicilio fiscal)
    expect(within(ficha).getByText("Calle borrador 1")).toBeTruthy();
  });

  it("R8 · error de contactos: los tres campos dicen «No disponible», hay aviso de error con «Reintentar» y enlace a Contactos", async () => {
    montar({
      obtener: (ruta) => (ruta.endsWith("/contacts") ? Promise.reject(new Error("falla sintética")) : Promise.resolve(resumen())),
    });
    await screen.findByRole("region", { name: "Datos generales" });
    irA("Ficha contable");
    const ficha = await screen.findByRole("region", { name: "Ficha contable" });
    await waitFor(() => expect(within(ficha).getAllByText("No disponible")).toHaveLength(3));
    expect(within(ficha).getByRole("link", { name: "Abrir Contactos" })).toBeTruthy();
    // defecto 3.1.2 corregido en 7a.2: el error se anuncia y se puede reintentar
    expect(within(ficha).getByRole("alert")).toBeTruthy();
    expect(within(ficha).getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });

  it("R9 · marca «(oculto)» en impuesto, régimen y jurisdicción inactivos (obligaciones y regímenes)", async () => {
    const inactivo = {
      ...regimen,
      isActive: false,
      taxType: { ...impuesto, isActive: false },
      jurisdiction: { ...jurisdiccion, isActive: false },
    };
    montar({
      datos: resumen({ obligaciones: [{ ...obligacion, regime: inactivo }], inscripciones: [{ ...inscripcion, regime: inactivo }] }),
    });
    await screen.findByRole("region", { name: "Datos generales" });
    irA("Obligaciones");
    const obligaciones = await screen.findByRole("region", { name: /Obligaciones/ });
    expect(within(obligaciones).getByText("Régimen general (oculto)")).toBeTruthy();
    expect(within(obligaciones).getByText("IVA (oculto) · Argentina (oculto)")).toBeTruthy();
    irA("Regímenes adheridos");
    const regimenes = await screen.findByRole("region", { name: /Regímenes adheridos/ });
    expect(within(regimenes).getByText("Régimen general (oculto)")).toBeTruthy();
    expect(within(regimenes).getByText("IVA (oculto) · Argentina (oculto)")).toBeTruthy();
  });
});

describe("Caracterización · Resumen del cliente: errores y contrato (R10 y R11)", () => {
  it("R10 · error del resumen con Reintentar; al reintentar con éxito conserva el cliente elegido", async () => {
    let intentos = 0;
    montar({
      obtener: (ruta) => {
        if (!ruta.endsWith("/summary")) return Promise.resolve([]);
        intentos += 1;
        return intentos === 1 ? Promise.reject(new Error("falla sintética")) : Promise.resolve(resumen());
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("region", { name: "Datos generales" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Cliente SINTÉTICO A" })).toBeTruthy();
    expect(contextMock.current.clientId).toBe("client-a");
    expect(contextMock.current.setClientId).not.toHaveBeenCalled();
  });

  it("R11 · sin cliente en el contexto: «Seleccioná un cliente» y «Ir a clientes» navega", async () => {
    montar({ clienteId: null });
    expect(await screen.findByText("Seleccioná un cliente")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ir a clientes" }));
    await waitFor(() => expect(screen.getByTestId("current-path").textContent).toBe("/clientes"));
  });
});

describe("Caracterización · matriz §2.1 (13 filas): datos visibles con cliente completo y con cliente vacío", () => {
  const vacio = {
    perfilContable: null as never,
    ejercicios: [],
    periodos: [],
    obligaciones: [],
    perfiles: [],
    inscripciones: [],
    actividades: [],
    contadores: { accounts: 0, counterparties: 0, costCenters: 0 },
  };
  const conPeriodo = {
    ...ejercicioBase,
    status: "OPEN",
    periods: [{ id: "period-nov", ordinal: 1, status: "OPEN", startDate: FECHA, endDate: FIN }],
  } as never;

  async function abrir(seccion: string) {
    const menu = await screen.findByRole("navigation", { name: "Secciones internas del cliente" });
    fireEvent.click(within(menu).getByRole("button", { name: seccion }));
  }

  it("M1 · encabezado: h1 con la razón social, descripción con fantasía y CUIT, y tres acciones (completo y vacío)", async () => {
    for (const datos of [resumen(), resumen(vacio)]) {
      cleanup();
      montar({ datos });
      expect(await screen.findByRole("region", { name: "Datos generales" })).toBeTruthy();
      const encabezado = document.querySelector(".dense-head") as HTMLElement;
      expect(within(encabezado).getByRole("heading", { level: 1 }).textContent).toBe("Cliente SINTÉTICO A");
      expect(encabezado.querySelector(".dense-head__desc")?.textContent).toBe("SINTÉTICO · CUIT 20-11111111-2");
      expect(within(encabezado).getAllByRole("button").map((boton) => boton.textContent?.trim())).toEqual([
        "Volver a clientes",
        "Configuración fiscal",
        "Abrir Legajo",
      ]);
    }
  });

  it("M2 · búsqueda: con datos encuentra coincidencias; sin datos dice que no hay coincidencias", async () => {
    montar();
    cambiarValor(await screen.findByLabelText(/Buscar en este cliente/), "IVA");
    expect(document.querySelectorAll(".client-summary__search-results li").length).toBeGreaterThan(0);
    cleanup();
    montar({ datos: resumen(vacio) });
    cambiarValor(await screen.findByLabelText(/Buscar en este cliente/), "IVA");
    expect(await screen.findByText("No encontramos coincidencias")).toBeTruthy();
  });

  it("M3 · índice: 7 secciones con datos y 6 sin datos contables, en 4 grupos", async () => {
    for (const [datos, botones] of [[resumen(), 7], [resumen(vacio), 6]] as const) {
      cleanup();
      montar({ datos });
      await screen.findByRole("region", { name: "Datos generales" });
      const indice = screen.getByRole("navigation", { name: "Secciones internas del cliente" });
      expect(indice.querySelectorAll("button")).toHaveLength(botones);
      expect(indice.querySelectorAll(".client-summary__index-group")).toHaveLength(4);
    }
  });

  it("M4 · resultados de búsqueda: cada resultado abre su sección", async () => {
    montar();
    cambiarValor(await screen.findByLabelText(/Buscar en este cliente/), "noviembre");
    const resultados = document.querySelectorAll(".client-summary__search-results li");
    expect(resultados).toHaveLength(2);
    fireEvent.click(within(resultados[0] as HTMLElement).getByRole("button"));
    expect(await screen.findByRole("region", { name: /Obligaciones/ })).toBeTruthy();
  });

  it("M5 · resumen: 4 datos de estado; «Qué sigue» solo aparece si falta algo (completo y vacío)", async () => {
    for (const datos of [resumen(), resumen(vacio)]) {
      cleanup();
      montar({ datos });
      const resumenSeccion = await screen.findByRole("region", { name: "Datos generales" });
      expect(resumenSeccion.querySelectorAll("dt")).toHaveLength(4);
      const accesos = resumenSeccion.querySelector(".client-summary__overview-links") as HTMLElement | null;
      if (datos.fiscal.profiles.length > 0) expect(accesos).toBeNull();
      else expect(within(accesos as HTMLElement).getAllByRole("button").map((boton) => boton.textContent)).toEqual(["Generar obligaciones"]);
    }
  });

  it("M6 · períodos contables: ejercicio con su período mensual; sin períodos la sección no se lista", async () => {
    montar({ datos: resumen({ ejercicios: [conPeriodo] as never }) });
    await abrir("Períodos contables");
    const contables = await screen.findByRole("region", { name: /Períodos contables/ });
    expect(within(contables).getByRole("heading", { level: 3, name: "2026" })).toBeTruthy();
    expect(within(contables).getByText("noviembre de 2026")).toBeTruthy();
    cleanup();
    montar({ datos: resumen(vacio) });
    await screen.findByRole("region", { name: "Datos generales" });
    expect(screen.queryByRole("button", { name: "Períodos contables" })).toBeNull();
  });

  it("M7 · períodos fiscales: viven en Obligaciones; los que no tienen obligación se listan debajo de la tabla", async () => {
    montar({ datos: resumen({ obligaciones: [] }) });
    await abrir("Obligaciones");
    const seccion = await screen.findByRole("region", { name: /Obligaciones/ });
    // D7A-13: la etiqueta de la API («Noviembre 2026») se lee con formato único
    expect(within(seccion).getByText(/Períodos fiscales sin obligación: IVA · noviembre de 2026/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Períodos fiscales" })).toBeNull();
  });

  it("M8 · obligaciones: 4 columnas y una fila con su estado; o vacío", async () => {
    montar();
    await abrir("Obligaciones");
    const seccion = await screen.findByRole("region", { name: /Obligaciones/ });
    expect(within(seccion).getAllByRole("columnheader")).toHaveLength(4);
    expect(within(seccion).getAllByRole("row")).toHaveLength(2);
    expect(within(seccion).getByText("Pendiente")).toBeTruthy();
    cleanup();
    montar({ datos: resumen(vacio) });
    await abrir("Obligaciones");
    expect(await screen.findByText("Sin obligaciones")).toBeTruthy();
  });

  it("M9 · ficha contable: solo los datos cargados; lo que falta se resume con salida", async () => {
    montar();
    await abrir("Ficha contable");
    const ficha = await screen.findByRole("region", { name: "Ficha contable" });
    expect(ficha.querySelectorAll("dt")).toHaveLength(9);
    expect(within(ficha).getByText("RTIC")).toBeTruthy();
    expect(within(ficha).getByText("Comercio")).toBeTruthy();
    cleanup();
    montar({ datos: resumen(vacio) });
    await abrir("Ficha contable");
    const fichaVacia = await screen.findByRole("region", { name: "Ficha contable" });
    expect(fichaVacia.querySelectorAll("dt")).toHaveLength(0);
    expect(within(fichaVacia).getByRole("link", { name: "Completar lo que falta" })).toBeTruthy();
    expect(within(fichaVacia).getByRole("link", { name: "Cargar el domicilio fiscal" })).toBeTruthy();
  });

  it("M10 · perfil fiscal: 7 datos e historial de versiones; o «Sin perfil fiscal»", async () => {
    montar();
    await abrir("Perfil fiscal");
    const seccion = await screen.findByRole("region", { name: "Perfil del contribuyente" });
    expect(seccion.querySelectorAll(".client-summary__facts dt")).toHaveLength(7);
    expect(within(seccion).getByText("Historial de versiones")).toBeTruthy();
    cleanup();
    montar({ datos: resumen({ perfiles: [] }) });
    await abrir("Perfil fiscal");
    expect(await screen.findByText("Sin perfil fiscal")).toBeTruthy();
  });

  it("M11 · regímenes adheridos: régimen, impuesto, jurisdicción y estado; o «Sin inscripciones»", async () => {
    montar();
    await abrir("Regímenes adheridos");
    const seccion = await screen.findByRole("region", { name: /Regímenes adheridos/ });
    expect(seccion.querySelectorAll("li")).toHaveLength(1);
    expect(within(seccion).getByText("Régimen general")).toBeTruthy();
    expect(within(seccion).getByText("Activo")).toBeTruthy();
    cleanup();
    montar({ datos: resumen({ inscripciones: [] }) });
    await abrir("Regímenes adheridos");
    expect(await screen.findByText("Sin inscripciones")).toBeTruthy();
  });

  it("M12 · actividades registradas: actividad y Principal o Secundaria; o «Sin actividades»", async () => {
    montar();
    await abrir("Actividades registradas");
    const seccion = await screen.findByRole("region", { name: /Actividades registradas/ });
    expect(seccion.querySelectorAll("li")).toHaveLength(1);
    expect(within(seccion).getByText("Comercio minorista")).toBeTruthy();
    expect(within(seccion).getByText("Principal en Argentina")).toBeTruthy();
    cleanup();
    montar({ datos: resumen({ actividades: [] }) });
    await abrir("Actividades registradas");
    expect(await screen.findByText("Sin actividades")).toBeTruthy();
  });

  it("M13 · catálogos: plan de cuentas, contrapartes y centros de costo; con todo en cero la sección no se lista", async () => {
    montar();
    await abrir("Catálogos");
    const seccion = await screen.findByRole("region", { name: "Catálogos del cliente" });
    expect(Array.from(seccion.querySelectorAll("li"), (li) => li.textContent)).toEqual([
      "Plan de cuentas1",
      "Contrapartes2",
      "Centros de costo activos3",
    ]);
    cleanup();
    montar({ datos: resumen(vacio) });
    await screen.findByRole("region", { name: "Datos generales" });
    expect(screen.queryByRole("button", { name: "Catálogos" })).toBeNull();
  });
});
