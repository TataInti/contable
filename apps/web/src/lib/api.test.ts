// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";

describe("cliente API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.cookie = "csrf_token=; Max-Age=0; path=/";
  });

  it("envía credenciales y CSRF en mutaciones", async () => {
    document.cookie = `csrf_token=${"a".repeat(40)}; path=/`;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { ok: true } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await expect(api.post<{ ok: boolean }>("/example", { value: 1 })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/example", expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      headers: expect.objectContaining({ "X-CSRF-Token": "a".repeat(40) }),
    }));
  });

  it("normaliza errores HTTP del backend", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "Sin permiso", requestId: "req-123" } }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const error = await api.get("/private").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "FORBIDDEN", status: 403, requestId: "req-123", retryable: false });
  });
});
