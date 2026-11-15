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
const MOTIVO_RESOLVER = "Escribí la resolución para resolver el control.";
const MOTIVO_EXIMIR = "Escribí el motivo para eximir el control.";
const CONFIRMACION_EXIMIR =
  "Vas a eximir este control con el motivo escrito. Quedará registrado como eximido.";

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
    fireEvent.change(screen.getByRole("textbox", { name: "Resolución BOOK_RATE_RECONCILIATION" }), {
      target: { value: "Conciliado con el libro IVA Demo" },
    });
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
    expect(screen.getAllByRole("button", { name: "Resolver" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Eximir" })).toHaveLength(1);
  });

  it("lista para respaldo solo los documentos revisados, listos o aplicados, con su estado", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({ controles: [bloqueante()] });
    renderLegajo();
    await abrirEtapa(/Controles/);

    const evidencia = await screen.findByRole("combobox", {
      name: "Evidencia BOOK_RATE_RECONCILIATION",
    });
    expect(
      within(evidencia).getByRole("option", { name: "Sin documento de respaldo" }),
    ).toBeInTheDocument();
    expect(
      within(evidencia).getByRole("option", { name: "revisado-demo.pdf · Revisado" }),
    ).toBeInTheDocument();
    expect(
      within(evidencia).getByRole("option", { name: "listo-demo.pdf · Listo" }),
    ).toBeInTheDocument();
    expect(
      within(evidencia).getByRole("option", { name: "aplicado-demo.pdf · Aplicado" }),
    ).toBeInTheDocument();
    expect(within(evidencia).queryByRole("option", { name: /extraido-demo/ })).toBeNull();
  });

  it("Resolver con respaldo envía la resolución, RESOLVED y el documento elegido", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({ controles: [bloqueante()] });
    renderLegajo();
    await abrirEtapa(/Controles/);

    fireEvent.change(
      await screen.findByRole("textbox", { name: "Resolución BOOK_RATE_RECONCILIATION" }),
      {
        target: { value: "Conciliado con el libro IVA Demo" },
      },
    );
    fireEvent.change(
      await screen.findByRole("combobox", { name: "Evidencia BOOK_RATE_RECONCILIATION" }),
      {
        target: { value: "doc-listo" },
      },
    );
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

    fireEvent.change(
      await screen.findByRole("textbox", { name: "Resolución PORTAL_IVA_RECONCILIATION" }),
      {
        target: { value: "Diferencia de redondeo" },
      },
    );
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

    fireEvent.change(
      await screen.findByRole("textbox", { name: "Resolución PORTAL_IVA_RECONCILIATION" }),
      {
        target: { value: "Diferencia menor aceptada" },
      },
    );
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

    fireEvent.change(
      await screen.findByRole("textbox", { name: "Resolución PORTAL_IVA_RECONCILIATION" }),
      {
        target: { value: "Diferencia menor aceptada" },
      },
    );
    const eximir = screen.getByRole("button", { name: "Eximir" });
    eximir.focus();
    fireEvent.click(eximir);
    expect(await screen.findByText(CONFIRMACION_EXIMIR)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(document.activeElement).toBe(eximir));
    expect(llamadasResolve()).toHaveLength(0);
  });

  it("Resolver y Eximir explican por qué están deshabilitados y dejan de hacerlo al escribir", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({ controles: [bloqueante(), advertencia()] });
    renderLegajo();
    await abrirEtapa(/Controles/);

    expect(await screen.findAllByText(MOTIVO_RESOLVER)).toHaveLength(2);
    expect(screen.getAllByText(MOTIVO_EXIMIR)).toHaveLength(1);
    fireEvent.change(
      screen.getByRole("textbox", { name: "Resolución PORTAL_IVA_RECONCILIATION" }),
      {
        target: { value: "Diferencia menor" },
      },
    );
    expect(screen.getAllByText(MOTIVO_RESOLVER)).toHaveLength(1);
    expect(screen.queryByText(MOTIVO_EXIMIR)).toBeNull();
  });

  it("el error de Resolver aparece junto a su botón y toma el foco", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({ controles: [bloqueante()] });
    vi.mocked(api.post).mockRejectedValue(new Error("No se pudo registrar la resolución"));
    renderLegajo();
    await abrirEtapa(/Controles/);

    fireEvent.change(
      await screen.findByRole("textbox", { name: "Resolución BOOK_RATE_RECONCILIATION" }),
      {
        target: { value: "Conciliado" },
      },
    );
    const resolver = screen.getByRole("button", { name: "Resolver" });
    fireEvent.click(resolver);

    const alerta = await screen.findByText("No se pudo registrar la resolución");
    expect(alerta.getAttribute("role")).toBe("alert");
    expect(alerta.closest(".workpaper-control__resolution")?.contains(resolver)).toBe(true);
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
    expect(
      screen.getAllByText("Tu perfil no puede resolver controles de este legajo."),
    ).toHaveLength(2);
  });

  it("un control que ya no está OPEN no ofrece acciones aunque el perfil pueda revisar", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({
      controles: [bloqueante({ status: "RESOLVED", resolution: "Respaldo conciliado en Demo" })],
    });
    renderLegajo();
    await abrirEtapa(/Controles/);

    expect(await screen.findByText("Respaldo conciliado en Demo")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resolver" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /^Resolución/ })).toBeNull();
  });

  it("sin controles muestra el vacío", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({ controles: [] });
    renderLegajo();
    await abrirEtapa(/Controles/);

    expect(
      await screen.findByText("No hay controles registrados para este legajo."),
    ).toBeInTheDocument();
  });

  it("lista cada control con su nombre, su severidad y el importe pendiente de respaldo", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({ controles: [bloqueante({ expected: "1000.00" })] });
    renderLegajo();
    await abrirEtapa(/Controles/);

    expect(await screen.findByText("Diferencias de libro por alícuota")).toBeInTheDocument();
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

  it("un error al leer los documentos de respaldo se ve junto al control, y Reintentar lo vuelve a leer", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({ controles: [bloqueante()], documentosFallan: true });
    renderLegajo();
    await abrirEtapa(/Controles/);

    expect(
      await screen.findByText("No se pudo leer los documentos de respaldo"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Evidencia BOOK_RATE_RECONCILIATION" }),
    ).toBeNull();

    fijarRespuestas({ controles: [bloqueante()] });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByRole("combobox", { name: "Evidencia BOOK_RATE_RECONCILIATION" }),
    ).toBeInTheDocument();
  });

  it("la etapa no tiene acciones primarias: la única primaria visible es la de la tarjeta", async () => {
    fijarContexto([...PERMISOS_REVISION, "tax.settlements.finalize"]);
    fijarRespuestas({ controles: [bloqueante(), advertencia()] });
    renderLegajo();
    await abrirEtapa(/Controles/);

    await screen.findByRole("combobox", { name: "Evidencia BOOK_RATE_RECONCILIATION" });
    const tarjeta = document.querySelector<HTMLElement>(".workpaper-card");
    expect(tarjeta).not.toBeNull();
    expect(tarjeta!.querySelectorAll(".workpaper-card__body .ds-button--primary")).toHaveLength(0);
    expect(tarjeta!.querySelectorAll(".ds-button--primary")).toHaveLength(1);
    expect(within(tarjeta!).getByRole("button", { name: "Finalizar" })).toBeInTheDocument();
  });
});

describe("Legajo · etapa Cierre (K13)", () => {
  it("muestra el texto de cierre, los hashes de 16 caracteres y los controles bloqueantes abiertos", async () => {
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

    expect(await screen.findByText("Cierre y arrastre")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Finalizar congela los hashes y genera los saldos de cierre para el siguiente período.",
      ),
    ).toBeInTheDocument();
    const valor = (etiqueta: string) =>
      screen.getByText(etiqueta).parentElement?.querySelector("dd")?.textContent;
    expect(valor("Hash de entrada")).toBe("a1b2c3d4e5f60718…");
    expect(valor("Hash de salida")).toBe("ffeeddccbbaa9988…");
    expect(valor("Controles bloqueantes")).toBe("2");
  });

  it("sin hashes indica cuándo se generan", async () => {
    fijarContexto(PERMISOS_REVISION);
    fijarRespuestas({ legajo: { inputHash: null, outputHash: null }, controles: [] });
    renderLegajo();
    await abrirEtapa(/Cierre/);

    expect(await screen.findByText("Cierre y arrastre")).toBeInTheDocument();
    const valor = (etiqueta: string) =>
      screen.getByText(etiqueta).parentElement?.querySelector("dd")?.textContent;
    expect(valor("Hash de entrada")).toBe("Se genera al calcular");
    expect(valor("Hash de salida")).toBe("Se genera al finalizar");
    expect(valor("Controles bloqueantes")).toBe("0");
  });
});
