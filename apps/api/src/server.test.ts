import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./server.js";

let app: FastifyInstance | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
});

async function startTestServer() {
  app = await buildServer({
    postgres: async () => true,
    valkey: async () => true,
    minio: async () => true,
    ai: async () => true,
  });
  await app.ready();
  return app;
}

describe("health endpoints", () => {
  it("GET /health/live responde ok", async () => {
    const server = await startTestServer();
    const res = await server.inject({ method: "GET", url: "/health/live" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("GET /health/ready responde ready", async () => {
    const server = await startTestServer();
    const res = await server.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: "ready",
      dependencies: { postgres: true, valkey: true, minio: true, ai: true },
    });
  });

  it("GET /health/startup responde started", async () => {
    const server = await startTestServer();
    const res = await server.inject({ method: "GET", url: "/health/startup" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "started" });
  });

  it("GET /api/v1/ping responde pong", async () => {
    const server = await startTestServer();
    const res = await server.inject({ method: "GET", url: "/api/v1/ping" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { message: "pong" } });
  });

  it("GET /api/v1/system/ready expone readiness para el frontend", async () => {
    const server = await startTestServer();
    const res = await server.inject({ method: "GET", url: "/api/v1/system/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: {
        status: "ready",
        dependencies: { postgres: true, valkey: true, minio: true, ai: true },
      },
    });
  });

  it("rechaza rutas de negocio sin sesión", async () => {
    const server = await startTestServer();
    const res = await server.inject({ method: "GET", url: "/api/v1/firms/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/clients" });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
    expect(body.error.message).toBe("Se requiere iniciar sesión");
    // F0.8: toda respuesta de error lleva requestId (trace) para correlación.
    expect(typeof body.error.requestId).toBe("string");
  });

  it("una ruta desconocida devuelve 404 y no una página ajena", async () => {
    const server = await startTestServer();
    const res = await server.inject({ method: "GET", url: "/ruta-inexistente" });
    expect(res.statusCode).toBe(404);
  });
});
