// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { MeContext, PortalContext } from "../lib/api";
import { ClientContextProvider, type ClientContextValue, useClientContext } from "./ClientContext";

interface MockSession {
  status: "loading" | "authenticated" | "unauthenticated";
  me: MeContext | null;
  portalContexts: PortalContext[];
  error: null;
  refresh: () => Promise<void>;
}

const sessionMock = vi.hoisted(() => ({ current: null as unknown as MockSession }));

vi.mock("../session/SessionContext", () => ({
  useSession: () => sessionMock.current,
}));

const STUDY_STORAGE_KEY = "contable.context.v2.study";
const PORTAL_STORAGE_KEY = "contable.context.v2.portal";
let latestContext: ClientContextValue | undefined;

function period(periodId: string) {
  return { periodId, label: periodId, status: "OPEN" };
}

function firm(
  firmId: string,
  clients: Array<{ clientId: string; periodIds: string[] }>,
): MeContext["firms"][number] {
  return {
    firmId,
    firmName: firmId,
    role: "OWNER",
    capabilities: [`${firmId}.read`],
    clients: clients.map((client) => ({
      clientId: client.clientId,
      clientName: client.clientId,
      periods: client.periodIds.map(period),
    })),
  };
}

function portalContext(firmId: string, clientId: string, periodIds: string[]): PortalContext {
  return {
    firmId,
    firmName: firmId,
    clientId,
    clientName: clientId,
    role: "CLIENT",
    periods: periodIds.map(period),
  };
}

function Probe() {
  latestContext = useClientContext();
  return null;
}

function TestTree({ path, children }: { path: string; children?: ReactNode }) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <ClientContextProvider>
        <Probe />
        {children}
      </ClientContextProvider>
    </MemoryRouter>
  );
}

function currentContext(): ClientContextValue {
  if (!latestContext) throw new Error("El contexto todavía no fue renderizado");
  return latestContext;
}

function authenticated(me: MeContext | null, portalContexts: PortalContext[] = []): MockSession {
  return { status: "authenticated", me, portalContexts, error: null, refresh: vi.fn() };
}

describe("ClientContextProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    latestContext = undefined;
    sessionMock.current = { status: "loading", me: null, portalContexts: [], error: null, refresh: vi.fn() };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("no pisa la selección guardada mientras la sesión está cargando", async () => {
    const saved = JSON.stringify({ firmId: "firm-a", clientId: "client-a", periodId: "period-a" });
    localStorage.setItem(STUDY_STORAGE_KEY, saved);
    const me = {
      userId: "user-a",
      firms: [firm("firm-a", [{ clientId: "client-a", periodIds: ["period-a"] }])],
    } satisfies MeContext;
    sessionMock.current = { status: "loading", me, portalContexts: [], error: null, refresh: vi.fn() };
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const view = render(<TestTree path="/" />);

    await act(async () => undefined);
    expect(localStorage.getItem(STUDY_STORAGE_KEY)).toBe(saved);
    expect(setItem).not.toHaveBeenCalled();

    sessionMock.current = authenticated(me);
    view.rerender(<TestTree path="/" />);

    await waitFor(() => {
      expect(currentContext()).toMatchObject({
        firmId: "firm-a",
        clientId: "client-a",
        periodId: "period-a",
      });
    });
  });

  it("restaura una selección válida entre varias firmas disponibles", async () => {
    localStorage.setItem(
      STUDY_STORAGE_KEY,
      JSON.stringify({
        firmId: "firm-b",
        clientId: "client-b2",
        periodId: "period-b2",
      }),
    );
    sessionMock.current = authenticated({
      userId: "user-a",
      firms: [
        firm("firm-a", [{ clientId: "client-a", periodIds: ["period-a"] }]),
        firm("firm-b", [
          { clientId: "client-b1", periodIds: ["period-b1"] },
          { clientId: "client-b2", periodIds: ["period-b2"] },
        ]),
      ],
    });
    render(<TestTree path="/" />);

    await waitFor(() => {
      expect(currentContext()).toMatchObject({
        firmId: "firm-b",
        clientId: "client-b2",
        periodId: "period-b2",
      });
    });
  });

  it("agrupa los clientes del portal por firma y restaura el cliente guardado", async () => {
    localStorage.setItem(
      PORTAL_STORAGE_KEY,
      JSON.stringify({
        firmId: "firm-a",
        clientId: "client-b",
        periodId: "period-b",
      }),
    );
    sessionMock.current = authenticated(null, [
      portalContext("firm-a", "client-a", ["period-a"]),
      portalContext("firm-a", "client-b", ["period-b"]),
    ]);
    render(<TestTree path="/portal" />);

    await waitFor(() => {
      expect(currentContext()).toMatchObject({
        firmId: "firm-a",
        clientId: "client-b",
        periodId: "period-b",
      });
      expect(currentContext().capabilities).toEqual(
        new Set([
          "client.read",
          "portal.results.read",
          "portal.documents.upload",
          "portal.requests.respond",
          "message.shared",
        ]),
      );
    });
  });

  it("no elige silenciosamente una firma cuando hay más de una", async () => {
    sessionMock.current = authenticated({
      userId: "user-a",
      firms: [
        firm("firm-a", [{ clientId: "client-a", periodIds: ["period-a"] }]),
        firm("firm-b", [{ clientId: "client-b", periodIds: ["period-b"] }]),
      ],
    });
    render(<TestTree path="/" />);

    await waitFor(() => {
      expect(localStorage.getItem(STUDY_STORAGE_KEY)).toBe(
        JSON.stringify({
          firmId: null,
          clientId: null,
          periodId: null,
        }),
      );
    });
    expect(currentContext()).toMatchObject({ firmId: null, clientId: null, periodId: null });
    expect(currentContext().capabilities.size).toBe(0);
  });

  it("usa una única firma disponible pero exige elegir cliente y período en estudio", async () => {
    localStorage.setItem(
      STUDY_STORAGE_KEY,
      JSON.stringify({
        firmId: "missing-firm",
        clientId: "missing-client",
        periodId: "missing-period",
      }),
    );
    sessionMock.current = authenticated({
      userId: "user-a",
      firms: [
        firm("firm-a", [
          { clientId: "client-a", periodIds: ["period-a", "period-b"] },
          { clientId: "client-b", periodIds: ["period-c"] },
        ]),
      ],
    });
    render(<TestTree path="/" />);

    await waitFor(() => {
      expect(currentContext()).toMatchObject({
        firmId: "firm-a",
        clientId: null,
        periodId: null,
      });
    });
  });

  it("aplica setters encadenados de forma atómica y limpia descendientes inválidos", async () => {
    sessionMock.current = authenticated({
      userId: "user-a",
      firms: [
        firm("firm-a", [{ clientId: "client-a", periodIds: ["period-a"] }]),
        firm("firm-b", [
          { clientId: "client-b1", periodIds: ["period-b1"] },
          { clientId: "client-b2", periodIds: ["period-b2", "period-b3"] },
        ]),
      ],
    });
    render(<TestTree path="/" />);
    await waitFor(() => expect(localStorage.getItem(STUDY_STORAGE_KEY)).not.toBeNull());

    act(() => {
      currentContext().setFirmId("firm-b");
      currentContext().setClientId("client-b2");
      currentContext().setPeriodId("period-b3");
    });
    expect(currentContext()).toMatchObject({
      firmId: "firm-b",
      clientId: "client-b2",
      periodId: "period-b3",
    });

    act(() => currentContext().setPeriodId("missing-period"));
    expect(currentContext()).toMatchObject({
      firmId: "firm-b",
      clientId: "client-b2",
      periodId: null,
    });

    act(() => currentContext().setClientId("missing-client"));
    expect(currentContext()).toMatchObject({ firmId: "firm-b", clientId: null, periodId: null });

    act(() => currentContext().setFirmId("missing-firm"));
    expect(currentContext()).toMatchObject({ firmId: null, clientId: null, periodId: null });
  });

  it("expone la pertenencia del cliente activo para validar enlaces heredados", async () => {
    sessionMock.current = authenticated({
      userId: "user-a",
      firms: [firm("firm-a", [{ clientId: "client-a", periodIds: ["period-a"] }])],
    });
    render(<TestTree path="/" />);

    await waitFor(() => expect(currentContext().isReady).toBe(true));
    expect(currentContext().hasClientAccess("client-a")).toBe(true);
    expect(currentContext().hasClientAccess("client-unknown")).toBe(false);
  });
});
