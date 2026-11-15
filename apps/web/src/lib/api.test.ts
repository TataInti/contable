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
      new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "Sin permiso", requestId: "req-123", dependencies: { minio: false } } }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const error = await api.get("/private").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "FORBIDDEN",
      status: 403,
      requestId: "req-123",
      retryable: false,
      details: expect.objectContaining({ dependencies: { minio: false } }),
    });
  });

  it("conserva los detalles estructurados de validación del backend", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        error: {
          code: "VALIDATION_ERROR",
          message: "La solicitud contiene datos inválidos",
          details: [{ path: ["validFrom"], message: "Invalid date" }],
        },
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const error = await api.post("/tax/rule-packs/pack-1/versions", {}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      details: {
        details: [{ path: ["validFrom"], message: "Invalid date" }],
      },
    });
  });

  describe("getEnvelope (cuerpo completo para listados con meta)", () => {
    const respuestaJson = (status: number, cuerpo: unknown) =>
      new Response(JSON.stringify(cuerpo), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    it("devuelve data y meta, mientras get sigue desenvolviendo data", async () => {
      const cuerpo = {
        data: [{ id: "ob-1" }, { id: "ob-2" }],
        meta: {
          total: 3,
          limit: 2,
          offset: 0,
          options: { taxTypes: [{ id: "iva", name: "IVA" }] },
        },
      };
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () => respuestaJson(200, cuerpo));
      const ruta = "/firms/f1/portfolio/tax-worklist/obligations?limit=2&offset=0";

      await expect(api.get<{ id: string }[]>(ruta)).resolves.toEqual(cuerpo.data);
      await expect(api.getEnvelope<typeof cuerpo>(ruta)).resolves.toEqual(cuerpo);
      expect(fetchMock).toHaveBeenLastCalledWith(
        `/api/v1${ruta}`,
        expect.objectContaining({ method: "GET", credentials: "same-origin" }),
      );
    });

    it.each([
      {
        status: 404,
        error: { code: "NOT_FOUND", message: "No encontramos el panel", requestId: "req-404" },
      },
      {
        status: 500,
        error: { code: "INTERNAL", message: "Falló la lectura del panel", requestId: "req-500" },
      },
    ])("lanza ApiError igual que get ante HTTP $status", async ({ status, error }) => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
        respuestaJson(status, { error }),
      );
      const resumen = (caught: unknown) => ({
        esApiError: caught instanceof ApiError,
        code: (caught as ApiError).code,
        status: (caught as ApiError).status,
        requestId: (caught as ApiError).requestId,
        retryable: (caught as ApiError).retryable,
        message: (caught as Error).message,
      });

      const porGet = resumen(await api.get("/private").catch((caught: unknown) => caught));
      const porEnvelope = resumen(
        await api.getEnvelope("/private").catch((caught: unknown) => caught),
      );

      expect(porEnvelope).toEqual(porGet);
      expect(porEnvelope).toEqual({
        esApiError: true,
        code: error.code,
        status,
        requestId: error.requestId,
        retryable: status >= 500,
        message: error.message,
      });
    });
  });
});
