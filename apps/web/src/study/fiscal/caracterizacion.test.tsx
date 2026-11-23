// @vitest-environment jsdom
// Caracterización de Configuración fiscal (Foco 7a.1). Fija el comportamiento vigente, incluidos los
// defectos del informe (§3.2 y §4.3). Datos sintéticos rotulados «SINTÉTICO», CUIT 20111111112.
// Cada prueba que fija un defecto lleva junto a la aserción «// vigente: …» con la decisión que lo cambia.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "@contable/design-system";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { api } from "../../lib/api";
import { formatearRango } from "../../lib/formatoFechas";
import { StudyOnboardingFiscal } from "../StudyOnboardingFiscal";
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
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      del: vi.fn(),
      postWithHeaders: vi.fn(),
    } as unknown as typeof actual.api,
  };
});

const IVA = { id: "tax-1", code: "IVA", name: "IVA", isActive: true };
const regimenIva = {
  id: "reg-iva",
  code: "REG-IVA",
  name: "Régimen IVA",
  isActive: true,
  taxType: { id: "tax-1", name: "IVA", isActive: true },
  jurisdiction: { name: "Argentina", isActive: true },
};
const regimenGan = {
  id: "reg-gan",
  code: "REG-GAN",
  name: "Régimen Ganancias",
  isActive: true,
  taxType: { id: "tax-2", name: "Ganancias", isActive: true },
  jurisdiction: { name: "Argentina", isActive: true },
};
const perfilActivo = {
  id: "profile-1",
  version: 1,
  legalName: "Cliente SINTÉTICO SA",
  cuit: "20111111112",
  personType: "JURIDICA",
  nationalCondition: "RESPONSABLE_INSCRIPTO",
  fiscalAddress: "Av. Sintética 100",
  status: "ACTIVE",
};
const inscripcionIva = { id: "reg-row-iva", status: "ACTIVE", validFrom: "2026-11-01", validTo: null, registrationNumber: null, profile: { version: 1 }, regime: regimenIva };
const inscripcionGan = { id: "reg-row-gan", status: "ACTIVE", validFrom: "2026-11-01", validTo: null, registrationNumber: null, profile: { version: 1 }, regime: regimenGan };
const actividadVigente = {
  id: "act-row-1",
  isPrimary: true,
  validFrom: "2026-11-01",
  validTo: null,
  profile: { version: 1 },
  activity: { code: "620100", name: "Desarrollo de software", isActive: true, jurisdiction: { name: "Argentina", isActive: true } },
};
const periodoIva = { id: "period-1", taxTypeId: "tax-1", startDate: "2026-11-01", endDate: "2026-11-30", label: "Noviembre 2026", taxType: IVA };
const periodoSinObligacion = { id: "period-2", taxTypeId: "tax-1", startDate: "2026-10-01", endDate: "2026-10-31", label: "Octubre 2026", taxType: IVA };
const obligacion = {
  id: "obl-1",
  status: "PENDING",
  dueDate: "2026-12-20",
  profile: { version: 1 },
  regime: regimenIva,
  period: { id: "period-1", label: "Noviembre 2026", startDate: "2026-11-01", endDate: "2026-11-30" },
};

interface Datos {
  cliente: unknown;
  perfiles: unknown[];
  regimenes: unknown[];
  actividadesCatalogo: unknown[];
  impuestos: unknown[];
  periodos: unknown[];
  obligaciones: unknown[];
  inscripciones: unknown[];
  actividadesCliente: unknown[];
}

const VACIO: Datos = {
  cliente: { cuit: "20111111112", cuitEnding: "2" },
  perfiles: [],
  regimenes: [],
  actividadesCatalogo: [],
  impuestos: [],
  periodos: [],
  obligaciones: [],
  inscripciones: [],
  actividadesCliente: [],
};

interface Montaje {
  datos?: Partial<Datos>;
  fallos?: string[];
  capacidades?: string[];
  pendiente?: boolean;
  toasts?: boolean;
}

function contexto(capacidades: string[]): ClientContextValue {
  return {
    firmId: "firm-a",
    clientId: "client-synthetic",
    periodId: null,
    isReady: true,
    capabilities: new Set(capacidades),
    hasClientAccess: (id) => id === "client-synthetic",
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  };
}

function montar({
  datos = {},
  fallos = [],
  capacidades = ["tax.profile.read", "tax.profile.write"],
  pendiente = false,
  toasts = false,
}: Montaje = {}) {
  const d: Datos = { ...VACIO, ...datos };
  contextMock.current = contexto(capacidades);
  vi.mocked(api.get).mockImplementation(((ruta: string) => {
    if (pendiente) return new Promise(() => undefined);
    if (fallos.some((fallo) => ruta === fallo || ruta.endsWith(fallo))) {
      return Promise.reject(new Error("falla sintética"));
    }
    if (ruta === "/tax/regimes") return Promise.resolve(d.regimenes);
    if (ruta === "/tax/activities") return Promise.resolve(d.actividadesCatalogo);
    if (ruta === "/tax/types") return Promise.resolve(d.impuestos);
    if (ruta.endsWith("/tax-profile-versions")) return Promise.resolve(d.perfiles);
    if (ruta.endsWith("/tax-periods")) return Promise.resolve(d.periodos);
    if (ruta.endsWith("/tax-obligations")) return Promise.resolve(d.obligaciones);
    if (ruta.endsWith("/tax-registrations")) return Promise.resolve(d.inscripciones);
    if (ruta.endsWith("/activities")) return Promise.resolve(d.actividadesCliente);
    if (ruta.endsWith("/clients/client-synthetic")) return Promise.resolve(d.cliente);
    return Promise.resolve([]);
  }) as never);
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const pantalla = (
    <MemoryRouter>
      <StudyOnboardingFiscal />
    </MemoryRouter>
  );
  return render(
    <QueryClientProvider client={cliente}>{toasts ? <ToastProvider>{pantalla}</ToastProvider> : pantalla}</QueryClientProvider>,
  );
}

function pestana(nombre: RegExp) {
  return screen.getByRole("tab", { name: nombre });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Caracterización · Configuración fiscal: pasos y estado (F1, F2, F10)", () => {
  it("F1 · listas vacías: cinco pasos «Pendiente», una sola primaria y el cajón de perfil con sus ids", async () => {
    montar();
    expect(await screen.findByRole("heading", { level: 1, name: "Configuración fiscal" })).toBeTruthy();
    const pasos = screen.getByRole("navigation", { name: "Pasos del onboarding fiscal" });
    expect(within(pasos).getAllByText("Pendiente", { exact: true })).toHaveLength(5);
    expect(document.querySelectorAll(".dense-page button.ds-button--primary")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Crear perfil fiscal" }));
    const cajon = await screen.findByRole("dialog", { name: "Crear perfil fiscal" });
    expect(cajon.querySelector("#pf-legal-name")).not.toBeNull();
    expect(cajon.querySelector("#pf-cuit")).not.toBeNull();
    const pie = cajon.querySelector(".action-drawer__footer") as HTMLElement;
    expect(within(pie).getByRole("button", { name: "Crear perfil" })).toBeTruthy();
    expect(within(pie).getByRole("button", { name: "Cancelar" })).toBeTruthy();
  });

  it("F2 · una ficha y una configuración fiscal activas completas dan «Configuración completa»", async () => {
    montar({
      datos: {
        cliente: { cuit: "20111111112", cuitEnding: "2", profile: {} },
        perfiles: [perfilActivo],
        inscripciones: [inscripcionIva],
        actividadesCliente: [actividadVigente],
        periodos: [periodoIva],
        obligaciones: [obligacion],
      },
    });
    expect(await screen.findByText("Configuración completa")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Pasos del onboarding fiscal" })).toBeNull();
  });

  it("no marca completa la configuración cuando el perfil fiscal todavía es borrador", async () => {
    montar({
      datos: {
        cliente: { cuit: "20111111112", cuitEnding: "2", profile: {} },
        perfiles: [{ ...perfilActivo, status: "DRAFT" }],
        inscripciones: [inscripcionIva],
        actividadesCliente: [actividadVigente],
        periodos: [periodoIva],
        obligaciones: [obligacion],
      },
    });
    await screen.findByRole("heading", { level: 1, name: "Configuración fiscal" });
    expect(screen.queryByText("Configuración completa")).toBeNull();
  });

  it("F10 · documenta: con consultas pendientes, la pestaña dice 0 y los pasos dicen «Pendiente»", async () => {
    montar({ pendiente: true });
    const pasos = await screen.findByRole("navigation", { name: "Pasos del onboarding fiscal" });
    expect(within(pasos).getAllByText("Pendiente", { exact: true })).toHaveLength(5);
    const regimenes = pestana(/Regímenes/);
    // vigente: defecto 3.2 (la carga se lee como dato); lo cambia 7a.4 (sin D7A-N en §7.2)
    expect(regimenes.querySelector(".dense-count")?.textContent).toBe("0");
    fireEvent.click(regimenes);
    expect(await screen.findByText("Cargando adhesiones…")).toBeTruthy();
  });
});

describe("Caracterización · Configuración fiscal: acciones y cajones (F3 a F7)", () => {
  it("F3 · documenta: «Activar perfil» dispara POST …/activate sin diálogo intermedio", async () => {
    vi.mocked(api.post).mockImplementation((() => Promise.resolve({})) as never);
    montar({ datos: { perfiles: [{ ...perfilActivo, status: "IN_REVIEW" }] } });
    fireEvent.click(await screen.findByRole("button", { name: "Activar perfil" }));
    // vigente: cambia con D7A-2 (confirmación de «Activar perfil»)
    expect(document.querySelector("[role='alertdialog'], [role='dialog']")).toBeNull();
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/firms/firm-a/clients/client-synthetic/tax-profile-versions/profile-1/activate"),
    );
  });

  it("F4 · «Dar de baja» abre «¿Dar de baja <régimen>?»; cancelar no llama a la API", async () => {
    vi.mocked(api.post).mockImplementation((() => Promise.resolve({})) as never);
    montar({ datos: { inscripciones: [inscripcionIva] } });
    fireEvent.click(await screen.findByRole("tab", { name: /Regímenes/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Dar de baja" }));
    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText("¿Dar de baja Régimen IVA?")).toBeTruthy();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    expect(api.post).not.toHaveBeenCalled();
  });

  it("F5 · «Finalizar» actividad abre «¿Finalizar <actividad>?»; cancelar no llama a la API", async () => {
    vi.mocked(api.post).mockImplementation((() => Promise.resolve({})) as never);
    montar({ datos: { actividadesCliente: [actividadVigente] } });
    fireEvent.click(await screen.findByRole("tab", { name: /Actividades/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Finalizar" }));
    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText("¿Finalizar Desarrollo de software?")).toBeTruthy();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    expect(api.post).not.toHaveBeenCalled();
  });

  it("F6 · la inscripción tiene su propio «Desde» (primer día del mes anterior) y no toma la «Vigencia desde» del perfil", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-22T15:00:00Z"));
    try {
      vi.mocked(api.post).mockImplementation((() => Promise.resolve({})) as never);
      montar({ datos: { perfiles: [perfilActivo], regimenes: [regimenIva] } });
      fireEvent.click(await screen.findByRole("button", { name: "Crear nueva versión" }));
      const perfil = await screen.findByRole("dialog", { name: "Crear nueva versión del perfil" });
      cambiarValor(await screen.findByLabelText("Vigencia desde"), "2026-09-15");
      fireEvent.click(within(perfil).getByRole("button", { name: "Cancelar" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

      fireEvent.click(pestana(/Regímenes/));
      fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
      const cajon = await screen.findByRole("dialog", { name: "Registrar inscripción" });
      cambiarValor(cajon.querySelector("#reg-regime") as HTMLSelectElement, "reg-iva");
      fireEvent.click(within(cajon).getByRole("button", { name: "Registrar inscripción" }));
      // cambió con D7A-5 / corte 1F (vigencia propia en el cajón de inscripción)
      await waitFor(() =>
        expect(api.post).toHaveBeenCalledWith(
          "/firms/firm-a/clients/client-synthetic/tax-registrations",
          expect.objectContaining({ profileVersionId: "profile-1", regimeId: "reg-iva", validFrom: "2026-10-01" }),
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("F7 · «Abrir mes» envía {month} y el aviso cuenta las obligaciones creadas o dice que ya estaba abierto", async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({ label: "Octubre 2026", regimes: 3, periodsCreated: 1, obligationsCreated: 3 } as never)
      .mockResolvedValueOnce({ label: "Octubre 2026", regimes: 3, periodsCreated: 0, obligationsCreated: 0 } as never);
    montar({ toasts: true });
    fireEvent.click(await screen.findByRole("tab", { name: /Períodos y obligaciones/ }));
    cambiarValor(document.querySelector("input[type='month']") as HTMLInputElement, "2026-10");
    fireEvent.click(screen.getByRole("button", { name: "Abrir mes" }));
    // vigente: cambia con D7A-3 (confirmación de «Abrir mes»)
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/firms/firm-a/clients/client-synthetic/tax-periods/open-month", { month: "2026-10" }),
    );
    expect(await screen.findByText("Octubre 2026 quedó abierto: 3 obligaciones creadas.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Abrir mes" }));
    expect(await screen.findByText("Octubre 2026 ya estaba abierto: no faltaba ningún período ni obligación.")).toBeTruthy();
  });
});

describe("Caracterización · Configuración fiscal: errores y consultas (F8 y F9)", () => {
  it("F8 · falla de adhesiones: banner «No pudimos cargar las adhesiones.» y la pestaña muestra «Sin regímenes adheridos»", async () => {
    montar({ fallos: ["/tax-registrations"] });
    expect(await screen.findByText("No pudimos cargar las adhesiones.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar las adhesiones" })).toBeTruthy();
    fireEvent.click(pestana(/Regímenes/));
    // vigente: defecto 3.2 (error y vacío conviven); lo cambia 7a.4 (sin D7A-N en §7.2)
    expect(await screen.findByText("Sin regímenes adheridos")).toBeTruthy();
  });

  it("F9 · documenta: si falla la consulta del cliente no se ve el bloque CUIT y el aviso no lo menciona", async () => {
    montar({ fallos: ["/firms/firm-a/clients/client-synthetic"] });
    expect(await screen.findByRole("heading", { level: 1, name: "Configuración fiscal" })).toBeTruthy();
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 10));
    });
    // vigente: defecto 3.2.5 (G08 desaparece en silencio); lo cambia 7a.4 (sin D7A-N en §7.2)
    expect(document.querySelector('dl[aria-label="Cliente"]')).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Caracterización · Configuración fiscal: modo consulta y pestañas (F11 y F16)", () => {
  it("F11 · sin tax.profile.write no hay altas, bajas, finalizaciones ni «Abrir mes»; el vacío explica el permiso", async () => {
    montar({ capacidades: ["tax.profile.read"] });
    expect(
      await screen.findByText("Tenés acceso de consulta; solicitá permiso de edición para crear el perfil."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Crear perfil fiscal" })).toBeNull();
    cleanup();

    montar({
      capacidades: ["tax.profile.read"],
      datos: {
        perfiles: [perfilActivo],
        inscripciones: [inscripcionIva],
        actividadesCliente: [actividadVigente],
        periodos: [periodoIva, periodoSinObligacion],
        obligaciones: [obligacion],
      },
    });
    fireEvent.click(await screen.findByRole("tab", { name: /Regímenes/ }));
    expect(screen.queryByRole("button", { name: "Agregar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dar de baja" })).toBeNull();
    fireEvent.click(pestana(/Actividades/));
    expect(screen.queryByRole("button", { name: "Agregar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Finalizar" })).toBeNull();
    fireEvent.click(pestana(/Períodos y obligaciones/));
    expect(screen.queryByRole("button", { name: "Agregar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Abrir mes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Crear obligación" })).toBeNull();
  });

  it("F16 · cada pestaña tiene una sola primaria (la del encabezado) cuando falta un paso", async () => {
    montar({
      datos: {
        perfiles: [perfilActivo],
        regimenes: [regimenIva],
        impuestos: [IVA],
        inscripciones: [inscripcionIva],
        actividadesCliente: [actividadVigente],
        periodos: [periodoIva],
        obligaciones: [],
      },
    });
    await screen.findByRole("heading", { level: 1, name: "Configuración fiscal" });
    await screen.findByText("Completar obligaciones");
    for (const nombre of [/Resumen/, /Regímenes/, /Actividades/, /Períodos y obligaciones/]) {
      fireEvent.click(pestana(nombre));
      const primarias = document.querySelectorAll(".dense-page button.ds-button--primary");
      expect(primarias).toHaveLength(1);
      expect(primarias[0]?.textContent).toBe("Completar obligaciones");
    }
  });
});

describe("Caracterización · Configuración fiscal: cajones y utilidades (F12 a F15)", () => {
  it("F12 · documenta: en el cajón de perfil el botón principal va primero y «Cancelar» después", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Crear perfil fiscal" }));
    const cajon = await screen.findByRole("dialog", { name: "Crear perfil fiscal" });
    const pie = cajon.querySelector(".action-drawer__footer") as HTMLElement;
    // vigente: orden del pie a corregir en 7a.3 (sin D7A-N en §7.2)
    expect(Array.from(pie.querySelectorAll("button"), (boton) => boton.textContent?.trim())).toEqual(["Crear perfil", "Cancelar"]);
  });

  it("F13 · el cajón de obligación ofrece solo inscripciones ACTIVE del mismo impuesto que el período", async () => {
    // El caso «sin período» (campo deshabilitado) no se alcanza desde la pantalla: el cajón se abre desde una fila con período.
    montar({
      datos: {
        impuestos: [IVA],
        periodos: [periodoIva],
        inscripciones: [inscripcionIva, inscripcionGan],
        regimenes: [regimenIva, regimenGan],
      },
    });
    fireEvent.click(await screen.findByRole("tab", { name: /Períodos y obligaciones/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Crear obligación" }));
    const cajon = await screen.findByRole("dialog", { name: "Crear obligación" });
    const opciones = Array.from(abrirListado("Régimen adherido", cajon).querySelectorAll('[role="option"]'), (opcion) => opcion.textContent);
    expect(opciones).toEqual(["Elegí…", "Régimen IVA · Argentina"]);
  });

  it("F14 · crear período envía el alta, cierra su cajón y no abre el de obligación", async () => {
    vi.mocked(api.post).mockImplementation((() =>
      Promise.resolve({ id: "period-new", taxTypeId: "tax-1", startDate: "2026-10-01", endDate: "2026-10-31", label: "Octubre 2026", taxType: IVA })) as never);
    montar({ datos: { impuestos: [IVA] } });
    fireEvent.click(await screen.findByRole("tab", { name: /Períodos y obligaciones/ }));
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    const cajon = await screen.findByRole("dialog", { name: "Crear período fiscal" });
    cambiarValor(cajon.querySelector("#per-tax-type") as HTMLSelectElement, "tax-1");
    cambiarValor(cajon.querySelector("#per-start") as HTMLInputElement, "2026-10-01");
    cambiarValor(cajon.querySelector("#per-end") as HTMLInputElement, "2026-10-31");
    fireEvent.click(within(cajon).getByRole("button", { name: "Crear período" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/firms/firm-a/clients/client-synthetic/tax-periods",
        expect.objectContaining({ taxTypeId: "tax-1", startDate: "2026-10-01", endDate: "2026-10-31" }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Crear período fiscal" })).toBeNull());
    // Nota (§4.3, F14): el informe esperaba que se abra el cajón de obligación; el código solo cierra el de período.
    expect(screen.queryByRole("dialog", { name: "Crear obligación" })).toBeNull();
  });

  it("F15 · el período muestra sin el prefijo del impuesto y, con rótulo numérico, su rango", async () => {
    const conPrefijo = { id: "p-a", taxTypeId: "tax-1", startDate: "2026-08-01", endDate: "2026-08-31", label: "IVA · Agosto 2026", taxType: IVA };
    const numerico = { id: "p-b", taxTypeId: "tax-1", startDate: "2026-09-01", endDate: "2026-09-30", label: "202609", taxType: IVA };
    montar({ datos: { periodos: [conPrefijo, numerico] } });
    fireEvent.click(await screen.findByRole("tab", { name: /Períodos y obligaciones/ }));
    expect(await screen.findByText("Agosto 2026")).toBeTruthy();
    expect(screen.queryByText("IVA · Agosto 2026")).toBeNull();
    expect(screen.getByText(formatearRango("2026-09-01", "2026-09-30"))).toBeTruthy();
  });
});
