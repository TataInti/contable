// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
// Caracterización de las etapas Controles (K13) y Cierre del Legajo con datos sintéticos «Demo» (Foco 2.3d).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@contable/design-system";
import type { ClientContextValue } from "../../context/ClientContext";
import { api } from "../../lib/api";
import { StudyExpedienteMensual } from "../StudyExpedienteMensual";
import {
  CLIENTE_DEMO,
  FIRMA_DEMO,
  PERIODO_ELEGIDO_DEMO,
  legajoDemo,
  rutasDemo,
} from "./datosDemoLegajo";
import type { EvidenceDocument, Workpaper } from "./tipos";
import { abrirListado, cambiarValor } from "../../test/elegirOpcion";

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

vi.mock("../../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

vi.mock("../../session/SessionContext", () => ({
  useSession: () => ({
    status: "authenticated",
    me: null,
    portalContexts: [],
    error: null,
    refresh: async () => {},
  }),
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

const LEGAJO = `/firms/${FIRMA_DEMO}/clients/${CLIENTE_DEMO}/monthly-tax-workpapers/wp-a`;
const PERMISOS_REVISION = ["client.read", "tax.settlements.review"];
const HASH_ENTRADA = `a1b2c3d4e5f60718${"0".repeat(48)}`;
const HASH_SALIDA = `ffeeddccbbaa9988${"1".repeat(48)}`;
const MOTIVO_ACCIONES = "Falta escribir el motivo o cómo se resolvió.";
const CONFIRMACION_EXIMIR =
  "Vas a eximir el control «Conciliación con Portal IVA» con el motivo «Diferencia menor aceptada». Quedará registrado como eximido.";

type Control = Workpaper["controls"][number];

// Control bloqueante: el único que admite respaldo al resolverlo.
function bloqueante(overrides: Partial<Control> = {}): Control {
  return {
    id: "control-a",
    code: "BOOK_RATE_RECONCILIATION",
    severity: "BLOCKING",
    status: "OPEN",
    expected: null,
    actual: null,
    tolerance: null,
    evidenceDocumentId: null,
    resolution: null,
    ...overrides,
  };
}

// Control no bloqueante: se resuelve o se exime, sin respaldo.
function advertencia(overrides: Partial<Control> = {}): Control {
  return {
    id: "control-b",
    code: "PORTAL_IVA_RECONCILIATION",
    severity: "WARNING",
    status: "OPEN",
    expected: null,
    actual: null,
    tolerance: null,
    evidenceDocumentId: null,
    resolution: null,
    ...overrides,
  };
}

function documento(id: string, nombre: string, status: string): EvidenceDocument {
  return {
    id,
    category: "RESPALDO",
    status,
    createdAt: "2026-11-01T00:00:00.000Z",
    fileVersions: [{ originalName: nombre }],
  };
}

const DOCUMENTOS_DEMO = [
  documento("doc-revisado", "revisado-demo.pdf", "REVIEWED"),
  documento("doc-listo", "listo-demo.pdf", "READY"),
  documento("doc-aplicado", "aplicado-demo.pdf", "APPLIED"),
  documento("doc-extraido", "extraido-demo.pdf", "EXTRACTED"),
];

interface Escena {
  controles?: Control[];
  legajo?: Partial<Workpaper>;
  documentos?: EvidenceDocument[];
  documentosFallan?: boolean;
}

// Respuestas del legajo «Demo». Los controles vienen dentro del propio legajo.
function fijarRespuestas({
  controles = [],
  legajo = {},
  documentos = DOCUMENTOS_DEMO,
  documentosFallan = false,
}: Escena = {}) {
  const wp = { ...legajoDemo("REVIEWED"), controls: controles, ...legajo } as Workpaper;
  const rutas = rutasDemo({ legajos: [wp], documentos });
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (documentosFallan && path.endsWith("/documents")) {
      return Promise.reject(new Error("Sin respuesta del servidor"));
    }
    return rutas(path);
  }) as never);
}

function fijarContexto(permisos: string[]) {
  contextMock.current = {
    firmId: FIRMA_DEMO,
    clientId: CLIENTE_DEMO,
    periodId: PERIODO_ELEGIDO_DEMO,
    isReady: true,
    capabilities: new Set(permisos),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  };
}

function renderLegajo() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <StudyExpedienteMensual />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

async function abrirEtapa(nombre: RegExp) {
  fireEvent.click(await screen.findByRole("tab", { name: nombre }));
  if (/Controles/.test(nombre.source)) {
    let abrir = screen.queryAllByRole("button", { name: /^Abrir / });
    if (!abrir.length) {
      const resueltos = screen.queryByRole("button", { name: /^Resueltos \([1-9]/ });
      if (resueltos) {
        fireEvent.click(resueltos);
        abrir = screen.queryAllByRole("button", { name: /^Abrir / });
      }
    }
    if (abrir[0]) fireEvent.click(abrir[0]);
  }
}

// Llamadas de resolución de controles: [url, cuerpo].
function llamadasResolve() {
  return (
    vi.mocked(api.post).mock.calls as unknown as Array<[string, Record<string, unknown>]>
  ).filter(([url]) => url.endsWith("/resolve"));
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  sessionStorage.setItem("contable:firm-a:client-a:selected-tax-period", PERIODO_ELEGIDO_DEMO);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  fijarRespuestas();
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.patch).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
});

describe("Legajo · etapa Controles (K13)", () => {
  it("Resolver queda deshabilitado hasta escribir la resolución", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({ controles: [bloqueante()] });
    renderLegajo();
    await abrirEtapa(/Controles/);

    expect(
      ((await screen.findByRole("button", { name: "Resolver" })) as HTMLButtonElement).disabled,
    ).toBe(true);
    cambiarValor(screen.getByRole("textbox", { name: "Motivo" }), "Conciliado con el libro IVA Demo");
    expect(
      ((await screen.findByRole("button", { name: "Resolver" })) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("ofrece evidencia solo en los controles bloqueantes y Eximir solo en los no bloqueantes", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({ controles: [bloqueante(), advertencia()] });
    renderLegajo();
    await abrirEtapa(/Controles/);

    expect(
      await screen.findByRole("combobox", { name: "Evidencia BOOK_RATE_RECONCILIATION" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Evidencia PORTAL_IVA_RECONCILIATION" }),
    ).toBeNull();
    expect(screen.getAllByRole("button", { name: "Resolver" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    fireEvent.click(screen.getByRole("button", { name: /Abrir Conciliación con Portal IVA/ }));
    expect(screen.queryByRole("combobox", { name: /^Evidencia/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Eximir" })).toBeInTheDocument();
  });

  it("lista para respaldo solo los documentos revisados, listos o aplicados, con su estado", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({ controles: [bloqueante()] });
    renderLegajo();
    await abrirEtapa(/Controles/);

    await screen.findByRole("combobox", {
      name: "Evidencia BOOK_RATE_RECONCILIATION",
    });
    expect(
      within(abrirListado("Evidencia BOOK_RATE_RECONCILIATION")).getByRole("option", { name: "Sin documento de respaldo" }),
    ).toBeInTheDocument();
    expect(
      within(abrirListado("Evidencia BOOK_RATE_RECONCILIATION")).getByRole("option", { name: "revisado-demo.pdf · Revisado" }),
    ).toBeInTheDocument();
    expect(
      within(abrirListado("Evidencia BOOK_RATE_RECONCILIATION")).getByRole("option", { name: "listo-demo.pdf · Listo" }),
    ).toBeInTheDocument();
    expect(
      within(abrirListado("Evidencia BOOK_RATE_RECONCILIATION")).getByRole("option", { name: "aplicado-demo.pdf · Aplicado" }),
    ).toBeInTheDocument();
    expect(within(abrirListado("Evidencia BOOK_RATE_RECONCILIATION")).queryByRole("option", { name: /extraido-demo/ })).toBeNull();
  });

  it("Resolver con respaldo envía la resolución, RESOLVED y el documento elegido", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({ controles: [bloqueante()] });
    renderLegajo();
    await abrirEtapa(/Controles/);

    cambiarValor(await screen.findByRole("textbox", { name: "Motivo" }), "Conciliado con el libro IVA Demo");
    cambiarValor(await screen.findByRole("combobox", { name: "Evidencia BOOK_RATE_RECONCILIATION" }), "doc-listo");
    fireEvent.click(screen.getByRole("button", { name: "Resolver" }));

    await waitFor(() => expect(llamadasResolve()).toHaveLength(1));
    expect(llamadasResolve()[0]).toStrictEqual([
      `${LEGAJO}/controls/control-a/resolve`,
      {
        resolution: "Conciliado con el libro IVA Demo",
        status: "RESOLVED",
        evidenceDocumentId: "doc-listo",
      },
    ]);
  });

  it("Resolver sin respaldo envía solo la resolución y RESOLVED en el cuerpo", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({ controles: [advertencia()] });
    renderLegajo();
    await abrirEtapa(/Controles/);

    cambiarValor(await screen.findByRole("textbox", { name: "Motivo" }), "Diferencia de redondeo");
    fireEvent.click(screen.getByRole("button", { name: "Resolver" }));

    await waitFor(() => expect(llamadasResolve()).toHaveLength(1));
    expect(llamadasResolve()[0]).toStrictEqual([
      `${LEGAJO}/controls/control-b/resolve`,
      { resolution: "Diferencia de redondeo", status: "RESOLVED" },
    ]);
  });

  it("Eximir de un control no bloqueante envía WAIVED con el motivo, y solo tras confirmar", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({ controles: [advertencia()] });
    renderLegajo();
    await abrirEtapa(/Controles/);

    cambiarValor(await screen.findByRole("textbox", { name: "Motivo" }), "Diferencia menor aceptada");
    fireEvent.click(screen.getByRole("button", { name: "Eximir" }));
    expect(await screen.findByText(CONFIRMACION_EXIMIR)).toBeInTheDocument();
    expect(llamadasResolve()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Sí, eximir" }));
    await waitFor(() => expect(llamadasResolve()).toHaveLength(1));
    expect(llamadasResolve()[0]).toStrictEqual([
      `${LEGAJO}/controls/control-b/resolve`,
      { resolution: "Diferencia menor aceptada", status: "WAIVED" },
    ]);
  });

  it("Eximir pide confirmación y, al cancelar, devuelve el foco a Eximir sin llamar a la API", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({ controles: [advertencia()] });
    renderLegajo();
    await abrirEtapa(/Controles/);

    cambiarValor(await screen.findByRole("textbox", { name: "Motivo" }), "Diferencia menor aceptada");
    const eximir = screen.getByRole("button", { name: "Eximir" });
    eximir.focus();
    fireEvent.click(eximir);
    expect(await screen.findByText(CONFIRMACION_EXIMIR)).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(document.activeElement).toBe(eximir));
    expect(llamadasResolve()).toHaveLength(0);
  });

  it("Resolver y Eximir explican por qué están deshabilitados y dejan de hacerlo al escribir", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({ controles: [bloqueante(), advertencia()] });
    renderLegajo();
    await abrirEtapa(/Controles/);

    expect(await screen.findAllByText(MOTIVO_ACCIONES)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    fireEvent.click(screen.getByRole("button", { name: /Abrir Conciliación con Portal IVA/ }));
    expect(screen.getByRole("button", { name: "Eximir" })).toBeDisabled();
    cambiarValor(screen.getByRole("textbox", { name: "Motivo" }), "Diferencia menor");
    expect(screen.queryByText(MOTIVO_ACCIONES)).toBeNull();
    expect(screen.getByRole("button", { name: "Eximir" })).toBeEnabled();
  });

  it("el error de Resolver aparece junto a su botón y toma el foco", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({ controles: [bloqueante()] });
    vi.mocked(api.post).mockRejectedValue(new Error("No se pudo registrar la resolución"));
    renderLegajo();
    await abrirEtapa(/Controles/);

    cambiarValor(await screen.findByRole("textbox", { name: "Motivo" }), "Conciliado");
    const resolver = screen.getByRole("button", { name: "Resolver" });
    fireEvent.click(resolver);

    const alerta = await screen.findByText("No se pudo registrar la resolución");
    expect(alerta.getAttribute("role")).toBe("alert");
    expect(screen.getByRole("dialog").contains(alerta)).toBe(true);
    expect(screen.getByRole("dialog").contains(resolver)).toBe(true);
    expect(document.activeElement).toBe(alerta.parentElement);
  });

  it("sin tax.settlements.review no ofrece Resolver, Eximir ni campos de resolución, y lo explica", async () => {
    fijarContexto(["client.read"]);
    fijarRespuestas({ controles: [bloqueante(), advertencia()] });
    renderLegajo();
    await abrirEtapa(/Controles/);

    expect(await screen.findByText("Conciliación con Portal IVA")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resolver" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Eximir" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /^Resolución/ })).toBeNull();
    expect(screen.queryByRole("combobox", { name: /^Evidencia/ })).toBeNull();
    expect(screen.getAllByText("Tu perfil no puede resolver controles de este legajo.")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    fireEvent.click(screen.getByRole("button", { name: /Abrir Conciliación con Portal IVA/ }));
    expect(screen.getByText("Tu perfil no puede resolver controles de este legajo.")).toBeInTheDocument();
  });

  it("un control que ya no está OPEN no ofrece acciones aunque el perfil pueda revisar", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({
      controles: [bloqueante({ status: "RESOLVED", resolution: "Respaldo conciliado en Demo" })],
    });
    renderLegajo();
    await abrirEtapa(/Controles/);

    expect(screen.getAllByText("Respaldo conciliado en Demo").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Resolver" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /^Resolución/ })).toBeNull();
  });

  it("sin controles muestra el vacío", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({ controles: [] });
    renderLegajo();
    await abrirEtapa(/Controles/);

    expect(
      await screen.findByText("No hay controles abiertos para este legajo."),
    ).toBeInTheDocument();
  });

  it("lista cada control con su nombre, su severidad y el importe pendiente de respaldo", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({ controles: [bloqueante({ expected: "1000.00" })] });
    renderLegajo();
    await abrirEtapa(/Controles/);

    expect((await screen.findAllByText("Diferencias de libro por alícuota")).length).toBeGreaterThan(0);
    expect(screen.getByText("Bloquea el cierre")).toBeInTheDocument();
    expect(screen.getByText(/Pendiente de respaldo/)).toBeInTheDocument();
  });

  it("la carga de los documentos de respaldo se anuncia con role status", async () => {
    fijarContexto(PERMISOS_REVISION);
    const wp = { ...legajoDemo("REVIEWED"), controls: [bloqueante()] } as Workpaper;
    const rutas = rutasDemo({ legajos: [wp], documentos: DOCUMENTOS_DEMO });
    vi.mocked(api.get).mockImplementation(((path: string) =>
      path.endsWith("/documents") ? new Promise(() => {}) : rutas(path)) as never);
    renderLegajo();
    await abrirEtapa(/Controles/);

    const carga = await screen.findByText("Cargando documentos de respaldo…");
    expect(carga.closest("[role='status']")).not.toBeNull();
  });

  it("un error al leer los documentos de respaldo se ve una vez, fuera de las filas, y Reintentar lo vuelve a leer", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({ controles: [bloqueante()], documentosFallan: true });
    renderLegajo();
    await abrirEtapa(/Controles/);

    const aviso = (
      await screen.findByText("No se pudieron leer los documentos de respaldo")
    ).closest("[role='alert']");
    expect(aviso).not.toBeNull();
    expect(aviso?.closest(".workpaper-control")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Reintentar" })).toHaveLength(1);
    expect(
      screen.queryByRole("combobox", { name: "Evidencia BOOK_RATE_RECONCILIATION" }),
    ).toBeNull();

    fijarRespuestas({ controles: [bloqueante()] });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByRole("combobox", { name: "Evidencia BOOK_RATE_RECONCILIATION" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("No se pudieron leer los documentos de respaldo")).toBeNull();
  });

  it("con error al leer los documentos, la resolución y Resolver siguen operando sin respaldo", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({ controles: [bloqueante()], documentosFallan: true });
    renderLegajo();
    await abrirEtapa(/Controles/);

    await screen.findByText("No se pudieron leer los documentos de respaldo");
    expect((screen.getByRole("button", { name: "Resolver" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(MOTIVO_ACCIONES)).toBeInTheDocument();

    cambiarValor(screen.getByRole("textbox", { name: "Motivo" }), "Conciliado sin respaldo");
    expect((screen.getByRole("button", { name: "Resolver" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.queryByText(MOTIVO_ACCIONES)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resolver" }));

    await waitFor(() => expect(llamadasResolve()).toHaveLength(1));
    expect(llamadasResolve()[0]).toStrictEqual([
      `${LEGAJO}/controls/control-a/resolve`,
      { resolution: "Conciliado sin respaldo", status: "RESOLVED" },
    ]);
  });

  it("con dos controles bloqueantes abiertos y error de lectura hay un solo aviso, con un solo Reintentar", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({
      controles: [
        bloqueante(),
        bloqueante({ id: "control-c", code: "CASH_ALLOCATION_RECONCILIATION" }),
      ],
      documentosFallan: true,
    });
    renderLegajo();
    await abrirEtapa(/Controles/);

    expect(
      await screen.findAllByText("No se pudieron leer los documentos de respaldo"),
    ).toHaveLength(1);
    const alertasDeLectura = screen
      .getAllByRole("alert")
      .filter((alerta) =>
        alerta.textContent?.includes("No se pudieron leer los documentos de respaldo"),
      );
    expect(alertasDeLectura).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Reintentar" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Resolver" })).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: "Motivo" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    fireEvent.click(screen.getByRole("button", { name: /Abrir Caja e imputaciones del período/ }));
    expect(screen.getByRole("heading", { name: "Caja e imputaciones del período" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Motivo" })).toBeInTheDocument();
  });

  it("con documentos de respaldo cargados no hay aviso de lectura ni de carga", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({
      controles: [
        bloqueante(),
        bloqueante({ id: "control-c", code: "CASH_ALLOCATION_RECONCILIATION" }),
      ],
    });
    renderLegajo();
    await abrirEtapa(/Controles/);

    expect(await screen.findAllByRole("combobox", { name: /^Evidencia / })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    fireEvent.click(screen.getByRole("button", { name: /Abrir Caja e imputaciones del período/ }));
    expect(screen.getByRole("combobox", { name: "Evidencia CASH_ALLOCATION_RECONCILIATION" })).toBeInTheDocument();
    expect(screen.queryByText("No se pudieron leer los documentos de respaldo")).toBeNull();
    expect(screen.queryByText("Cargando documentos de respaldo…")).toBeNull();
  });

  it("con dos controles bloqueantes, la carga de los documentos se anuncia una sola vez", async () => {
    fijarContexto(PERMISOS_REVISION);
    const wp = {
      ...legajoDemo("REVIEWED"),
      controls: [
        bloqueante(),
        bloqueante({ id: "control-c", code: "CASH_ALLOCATION_RECONCILIATION" }),
      ],
    } as Workpaper;
    const rutas = rutasDemo({ legajos: [wp], documentos: DOCUMENTOS_DEMO });
    vi.mocked(api.get).mockImplementation(((path: string) =>
      path.endsWith("/documents") ? new Promise(() => {}) : rutas(path)) as never);
    renderLegajo();
    await abrirEtapa(/Controles/);

    const carga = await screen.findAllByText("Cargando documentos de respaldo…");
    expect(carga).toHaveLength(1);
    expect(carga[0]?.closest("[role='status']")).toBeInstanceOf(HTMLElement);
    expect(screen.getAllByRole("button", { name: "Resolver" })).toHaveLength(1);
  });

  it("la etapa no tiene acciones primarias: la única primaria visible es la de la tarjeta", async () => {
    fijarContexto([...PERMISOS_REVISION, "tax.settlements.finalize"]);
    fijarRespuestas({ controles: [bloqueante(), advertencia()] });
    renderLegajo();
    await abrirEtapa(/Controles/);

    await screen.findByRole("combobox", { name: "Evidencia BOOK_RATE_RECONCILIATION" });
    const tarjeta = document.querySelector<HTMLElement>(".work-page");
    expect(tarjeta).not.toBeNull();
    expect(tarjeta!.querySelectorAll(".workpaper-body .ds-button--primary")).toHaveLength(1);
    expect(tarjeta!.querySelectorAll(".ds-button--primary")).toHaveLength(2);
    expect(within(tarjeta!).getByRole("button", { name: "Finalizar" })).toBeInTheDocument();
  });
});

describe("Legajo · etapa Cierre (K13)", () => {
  it("un control bloqueante abierto guía desde Cierre a Controles y no ofrece Finalizar", async () => {
    fijarContexto([...PERMISOS_REVISION, "tax.settlements.finalize"]);
    fijarRespuestas({
      legajo: { status: "CALCULATED" },
      controles: [bloqueante()],
    });
    renderLegajo();
    await abrirEtapa(/Cierre/);

    expect(await screen.findByText("Falta resolver los controles bloqueantes.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finalizar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ir a Controles" }));
    expect(screen.getByRole("tab", { name: /Controles/ })).toHaveAttribute("aria-selected", "true");
  });

  it("sin controles abiertos y sin revisión guía desde Cierre a Cálculo", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({ legajo: { status: "CALCULATED" }, controles: [] });
    renderLegajo();
    await abrirEtapa(/Cierre/);

    expect(await screen.findByText("Falta revisar la liquidación.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finalizar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ir a Cálculo" }));
    expect(screen.getByRole("tab", { name: "Cálculo" })).toHaveAttribute("aria-selected", "true");
  });

  it("con la liquidación revisada ofrece Finalizar y pide confirmación antes de finalizar", async () => {
    fijarContexto([...PERMISOS_REVISION, "tax.settlements.finalize"]);
    fijarRespuestas({ legajo: { status: "REVIEWED" }, controles: [] });
    renderLegajo();
    await abrirEtapa(/Cierre/);

    fireEvent.click(await screen.findByRole("button", { name: "Finalizar" }));
    expect(await screen.findByText(/Finalizar congela los datos del período/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sí, finalizar" })).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalledWith(expect.stringContaining("/finalize"), expect.anything());
  });

  it("muestra los pasos y mantiene las huellas dentro del detalle técnico plegado", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({
      legajo: { status: "FINALIZED", inputHash: HASH_ENTRADA, outputHash: HASH_SALIDA },
      controles: [
        bloqueante({ id: "control-a" }),
        bloqueante({ id: "control-c", code: "CASH_ALLOCATION_RECONCILIATION" }),
        bloqueante({ id: "control-d", status: "RESOLVED", resolution: "Conciliado" }),
        advertencia(),
      ],
    });
    renderLegajo();
    await abrirEtapa(/Cierre/);

    expect(await screen.findByText("Paso 1 · Finalizar")).toBeInTheDocument();
    expect(screen.getByText("Paso 4 · Pago (opcional)")).toBeInTheDocument();
    const detalle = screen.getByText("Detalle técnico");
    expect(detalle.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(detalle);
    const valor = (etiqueta: string) =>
      screen.getByText(etiqueta).parentElement?.querySelector("dd")?.textContent;
    expect(valor("Huella de entrada")).toBe(HASH_ENTRADA);
    expect(valor("Huella de salida")).toBe(HASH_SALIDA);
    expect(valor("Controles bloqueantes")).toBe("2");
  });

  it("sin hashes indica cuándo se generan", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({ legajo: { inputHash: null, outputHash: null }, controles: [] });
    renderLegajo();
    await abrirEtapa(/Cierre/);

    expect(await screen.findByText("Paso 1 · Finalizar")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Detalle técnico"));
    const valor = (etiqueta: string) =>
      screen.getByText(etiqueta).parentElement?.querySelector("dd")?.textContent;
    expect(valor("Huella de entrada")).toBe("Se genera al calcular");
    expect(valor("Huella de salida")).toBe("Se genera al finalizar");
    expect(valor("Controles bloqueantes")).toBe("0");
  });
});

describe("Legajo · Controles: motivo, lugar de las acciones y diálogo de Eximir (Foco 2.7b)", () => {
  it("la ayuda del campo vale para las dos acciones y Resolver y Eximir mantienen su lugar con el campo vacío y lleno", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({ controles: [advertencia()] });
    renderLegajo();
    await abrirEtapa(/Controles/);
    const campo = await screen.findByRole("textbox", {
      name: "Motivo",
    });
    expect(campo).toHaveAttribute("placeholder", "Escribí cómo se resolvió.");
    const grupo = screen.getByRole("dialog");
    const nombres = () => within(grupo).getAllByRole("button").map((boton) => boton.textContent);
    const eximir = within(grupo).getByRole("button", { name: "Eximir" });
    const resolver = within(grupo).getByRole("button", { name: "Resolver" });
    expect(nombres().indexOf("Eximir")).toBeGreaterThan(-1);
    expect(nombres().indexOf("Resolver")).toBeGreaterThan(-1);
    expect(resolver).toBeDisabled();
    const motivo = document.getElementById(eximir.getAttribute("aria-describedby") ?? "");
    expect(motivo).not.toBeNull();
    expect(motivo!).toHaveTextContent(MOTIVO_ACCIONES);
    expect(eximir).toHaveAttribute("aria-describedby", motivo!.id);
    cambiarValor(campo, "Diferencia menor");
    expect(nombres().indexOf("Eximir")).toBeGreaterThan(-1);
    expect(nombres().indexOf("Resolver")).toBeGreaterThan(-1);
    expect(within(grupo).queryByRole("note")).toBeNull();
  });

  it("el contador de controles bloqueantes no es una región de alerta", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({
      controles: [
        bloqueante(),
        bloqueante({ id: "control-c", code: "CASH_ALLOCATION_RECONCILIATION" }),
      ],
    });
    renderLegajo();
    await abrirEtapa(/Controles/);
    const contador = document.querySelector<HTMLElement>(".workpaper-bloqueos");
    expect(contador).not.toBeNull();
    expect(contador!).toHaveTextContent("2 bloqueantes abiertos"); // vigente: cambia con A29
    expect(contador!.getAttribute("role")).toBeNull();
    expect(contador!.closest("[role='alert']")).toBeNull();
    expect(
      screen
        .queryAllByRole("alert")
        .filter((alerta) => /bloqueante/.test(alerta.textContent ?? "")),
    ).toHaveLength(0);
  });

  it("el diálogo de Eximir nombra el control, cita el motivo escrito y no afirma si se puede deshacer", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({ controles: [advertencia()] });
    renderLegajo();
    await abrirEtapa(/Controles/);
    cambiarValor(await screen.findByRole("textbox", { name: "Motivo" }), "Diferencia menor aceptada");
    fireEvent.click(screen.getByRole("button", { name: "Eximir" }));
    const cuerpo = await screen.findByText(CONFIRMACION_EXIMIR);
    expect(cuerpo.textContent).toContain("«Conciliación con Portal IVA»");
    expect(cuerpo.textContent).toContain("«Diferencia menor aceptada»");
    expect(cuerpo.textContent).not.toMatch(/deshac|revers|revert/i);
  });
});

describe("Legajo · Controles: plural del contador de bloqueantes (Foco 2.7b)", () => {
  it("con un solo control bloqueante abierto el contador dice «1 bloqueante abierto»", async () => {
    // vigente: cambia con A29
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({ controles: [bloqueante()] });
    renderLegajo();
    await abrirEtapa(/Controles/);
    expect(document.querySelector(".workpaper-bloqueos")).toHaveTextContent(
      /^1 bloqueante abierto$/,
    );
  });
});
