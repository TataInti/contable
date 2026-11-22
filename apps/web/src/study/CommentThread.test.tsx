// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { CommentThread } from "./CommentThread";

vi.mock("../session/SessionContext", () => ({ useSession: () => ({ me: { userId: "author-1" } }) }));
vi.mock("../lib/api", () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });
function renderThread() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><CommentThread firmId="firm-1" clientId="client-1" periodLabel="Octubre 2026" /></MemoryRouter></QueryClientProvider>);
}

describe("hilo de comentarios", () => {
  it("muestra autor, fecha y permite marcar una nota solo para mí", async () => {
    vi.mocked(api.get).mockResolvedValue([{
      id: "existing-comment", clientId: "client-1", authorUserId: "member-2", authorName: "Mara",
      body: "Comentario de prueba", isPersonal: false, periodLabel: "Septiembre 2026", mentionedUserId: null,
      mentionedName: null, resolvedAt: null, archivedAt: null, createdAt: "2026-09-20T12:00:00.000Z",
      updatedAt: "2026-09-20T12:00:00.000Z", isEdited: false,
    }] as never);
    vi.mocked(api.post).mockResolvedValue({ id: "comment-1" } as never);
    renderThread();
    await screen.findByText("Comentarios del mes");
    expect(await screen.findByText("Mara")).toBeTruthy();
    expect(screen.getByText("Comentario de prueba")).toBeTruthy();
    expect(document.querySelector("time")?.getAttribute("datetime")).toBe("2026-09-20T12:00:00.000Z");
    fireEvent.change(screen.getByLabelText("Escribí un comentario"), { target: { value: "Dato para mi seguimiento" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Solo para mí" }));
    fireEvent.click(screen.getByRole("button", { name: "Comentar" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/firms/firm-1/clients/client-1/comments", expect.objectContaining({ body: "Dato para mi seguimiento", isPersonal: true, mentionedUserId: null })));
  });

  it("carga usuarios del estudio al escribir @", async () => {
    vi.mocked(api.get).mockImplementation(((path: string) => path.includes("/members?") ? Promise.resolve([{ id: "member-2", name: "Mara" }]) : Promise.resolve([])) as never);
    renderThread();
    const editor = await screen.findByLabelText("Escribí un comentario");
    fireEvent.change(editor, { target: { value: "Revisá esto @ma" } });
    await screen.findByRole("button", { name: "Mara" });
    fireEvent.click(screen.getByRole("button", { name: "Mara" }));
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toContain("@Mara"));
  });
});
