// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import type { ReactNode } from "react";
import { StudyShell } from "./StudyShell";

const state = vi.hoisted(() => ({
  context: null as unknown as ClientContextValue,
  session: null as unknown,
}));

vi.mock("../context/ClientContext", () => ({
  useClientContext: () => state.context,
}));

vi.mock("../session/SessionContext", () => ({
  useSession: () => state.session,
}));

vi.mock("../lib/auth", () => ({ logout: vi.fn() }));

vi.mock("../ui/GuidedTour", () => ({
  GuidedTour: ({ children }: { children: (controls: { startTour: () => void }) => ReactNode }) =>
    children({ startTour: vi.fn() }),
}));

function renderShell(path: string) {
  state.context = {
    firmId: "firm-a",
    clientId: "client-a",
    periodId: "period-a",
    isReady: true,
    capabilities: new Set([
      "client.read",
      "tax.profile.read",
      "tax.rules.read",
      "tax.settlements.read",
      "profitability.read",
      "report.run",
      "ai.use",
      "firm.users.manage",
      "platform.modules.manage",
    ]),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  } as ClientContextValue;
  state.session = {
    status: "authenticated",
    me: {
      isPlatformAdmin: false,
      firms: [{ firmId: "firm-a", firmName: "Estudio Demo", role: "OWNER", clients: [] }],
    },
    portalContexts: [],
    error: null,
    refresh: vi.fn(),
  };

  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<StudyShell />}>
          <Route path="*" element={<p>Contenido de la sección</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("StudyShell", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it.each([
    "/catalogos-fiscales",
    "/reglas-fiscales",
    "/administracion",
    "/administracion-plataforma",
  ])("oculta el contexto de cliente en %s", (path) => {
    renderShell(path);
    expect(document.querySelector("#context-bar")).toBeNull();
  });

  it("conserva el contexto en una pantalla que depende del cliente", () => {
    renderShell("/trabajo");
    expect(document.querySelector("#context-bar")).not.toBeNull();
    expect(screen.getByText("Cliente")).toBeTruthy();
    expect(screen.getByText("Período")).toBeTruthy();
  });

  it("presenta una sola tarjeta neutral y abre las dos opciones de ayuda", () => {
    renderShell("/catalogos-fiscales");
    const help = document.querySelector(".study__help") as HTMLDetailsElement;
    const summary = help.querySelector("summary");

    expect(help).not.toBeNull();
    expect(help.open).toBe(false);
    expect(help.querySelectorAll(":scope > summary")).toHaveLength(1);

    if (!summary) throw new Error("Falta el control de ayuda");
    fireEvent.click(summary);
    expect(help.open).toBe(true);
    expect(screen.getByRole("link", { name: "Ayuda paso a paso" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recorrer el estudio" })).toBeTruthy();
  });
});
