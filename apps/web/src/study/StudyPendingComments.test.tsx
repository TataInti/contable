// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { StudyPendingComments } from "./StudyPendingComments";

const mock = vi.hoisted(() => ({ setClientId: vi.fn() }));
vi.mock("../context/ClientContext", () => ({ useClientContext: () => ({ firmId: "firm-1", setClientId: mock.setClientId }) }));
vi.mock("../lib/api", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
function LocationProbe() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output>; }
function renderInbox() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><StudyPendingComments /><LocationProbe /></MemoryRouter></QueryClientProvider>);
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Pendientes para mí", () => {
  it("muestra cliente y mes, resuelve una mención y abre el hilo del comentario", async () => {
    vi.mocked(api.get).mockResolvedValue([{ id: "comment-1", clientId: "client-1", clientName: "Taller del Norte", periodLabel: "Octubre 2026", body: "Revisar el cierre", authorName: "Mara" }] as never);
    vi.mocked(api.post).mockResolvedValue({} as never);
    renderInbox();
    expect(await screen.findByText("Taller del Norte")).toBeTruthy();
    expect(screen.getByText(/Octubre 2026/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Marcar como resuelto" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/firms/firm-1/comments/comment-1/resolve", {}));
    fireEvent.click(screen.getByRole("button", { name: "Abrir comentario" }));
    expect(mock.setClientId).toHaveBeenCalledWith("client-1");
    expect(screen.getByTestId("location").textContent).toBe("/expediente-mensual?comentario=comment-1");
  });

  it("permite abrir la pestaña Mis notas", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([] as never).mockResolvedValueOnce([] as never);
    renderInbox();
    fireEvent.click(screen.getByRole("tab", { name: "Mis notas" }));
    expect(await screen.findByText("Todavía no guardaste notas personales.")).toBeTruthy();
  });
});
