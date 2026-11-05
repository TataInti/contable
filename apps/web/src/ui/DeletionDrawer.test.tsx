// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { DeletionDrawer, type DeletionPreview } from "./DeletionDrawer";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: vi.fn(),
      del: vi.fn(),
    },
  };
});

const clientPreview: DeletionPreview = {
  entity: { id: "client-synthetic", kind: "CLIENT", label: "Cliente sintético S.A." },
  confirmation: {
    expected: "Cliente sintético S.A.",
    label: "Escribí la razón social exacta para confirmar",
  },
  totals: { rows: 4 },
  groups: [{ key: "fiscal", label: "Datos fiscales", count: 4 }],
  items: [{ key: "documents", label: "Documentos", count: 4 }],
  blockers: [],
  canDelete: true,
  notes: ["La auditoría se conserva."],
};

function renderDrawer(preview: DeletionPreview, onClose = vi.fn(), onDeleted = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.mocked(api.get).mockResolvedValue(preview);
  vi.mocked(api.del).mockResolvedValue({});
  render(
    <QueryClientProvider client={queryClient}>
      <DeletionDrawer
        isOpen
        path="/firms/firm-synthetic/clients/client-synthetic"
        onClose={onClose}
        onDeleted={onDeleted}
      />
    </QueryClientProvider>,
  );
  return { onClose, onDeleted };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DeletionDrawer", () => {
  it("muestra el impacto y exige escribir el identificador exacto antes de borrar", async () => {
    const { onClose, onDeleted } = renderDrawer(clientPreview);

    expect(await screen.findByRole("heading", { name: "Cliente sintético S.A." })).toBeTruthy();
    expect(screen.getByText("Documentos:")).toBeTruthy();
    expect(screen.getByText("La auditoría se conserva.")).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Eliminar definitivamente" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    const input = screen.getByRole("textbox", {
      name: "Escribí la razón social exacta para confirmar",
    });
    fireEvent.change(input, { target: { value: "Cliente sintético S.A." } });
    await waitFor(() => expect(confirm.disabled).toBe(false));
    expect(api.del).not.toHaveBeenCalled();

    fireEvent.click(confirm);
    await waitFor(() =>
      expect(api.del).toHaveBeenCalledWith(
        "/firms/firm-synthetic/clients/client-synthetic",
        { confirmation: "Cliente sintético S.A." },
      ),
    );
    expect(onDeleted).toHaveBeenCalledWith({});
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("mantiene bloqueada la acción cuando el preview informa dependencias bloqueantes", async () => {
    const blockedPreview: DeletionPreview = {
      ...clientPreview,
      canDelete: false,
      blockers: [{ key: "history", label: "Historial protegido", count: 1 }],
    };
    renderDrawer(blockedPreview);

    expect(await screen.findByText("Historial protegido:")).toBeTruthy();
    expect(screen.getByText("Resolvé las dependencias indicadas antes de eliminar.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Eliminar definitivamente" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.del).not.toHaveBeenCalled();
  });
});
