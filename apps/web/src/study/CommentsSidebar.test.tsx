// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { CommentsSidebar, COMMENTS_SIDEBAR_WIDTH, commentsSidebarStorageKey, defaultCommentsSidebarOpen } from "./CommentsSidebar";

const storage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, String(value)),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
};
Object.defineProperty(window, "localStorage", { configurable: true, value: localStorageMock });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: localStorageMock });

vi.mock("../session/SessionContext", () => ({ useSession: () => ({ me: { userId: "user-a" } }) }));
vi.mock("../lib/api", () => ({ api: { get: vi.fn().mockResolvedValue([]) } }));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

function renderSidebar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CommentsSidebar firmId="firm-a" clientId="client-a" periodLabel="noviembre de 2026" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CommentsSidebar", () => {
  it("abre por defecto desde 1200 px y pliega por debajo", () => {
    expect(COMMENTS_SIDEBAR_WIDTH).toBeGreaterThanOrEqual(320);
    expect(COMMENTS_SIDEBAR_WIDTH).toBeLessThanOrEqual(380);
    expect(defaultCommentsSidebarOpen(1199, 2)).toBe(false);
    expect(defaultCommentsSidebarOpen(1200, 2)).toBe(true);
    expect(defaultCommentsSidebarOpen(1280, 2)).toBe(true);
    expect(defaultCommentsSidebarOpen(1440, 2)).toBe(true);
    // 09-7: sin comentarios, plegada por defecto.
    expect(defaultCommentsSidebarOpen(1440, 0)).toBe(false);
  });

  it("recuerda el estado por usuario y permite recuperarlo al volver a abrir", async () => {
    const key = commentsSidebarStorageKey("user-a");
    localStorage.setItem(key, "closed");
    renderSidebar();
    fireEvent.click(await screen.findByRole("button", { name: "Comentarios · 0" }));
    expect(await screen.findByRole("region", { name: "Comentarios" })).toBeTruthy();
    expect(localStorage.getItem(key)).toBe("open");
    expect(api.get).toHaveBeenCalledWith("/firms/firm-a/clients/client-a/comments");
  });

  it("usa claves de almacenamiento distintas para cada usuario", () => {
    expect(commentsSidebarStorageKey("user-a")).not.toBe(commentsSidebarStorageKey("user-b"));
  });
});
