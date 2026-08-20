import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { openApiSpec, fiscalPaths } from "./spec.js";

/**
 * F2.3: verificación de drift OpenAPI ↔ rutas Fastify.
 *
 * Cada path documentado en el OpenAPI debe existir como ruta registrada en
 * Fastify (mismo método y patrón). Si una ruta documentada no está registrada
 * (o cambió de método), el test falla: la CI detecta el drift.
 */

let app: FastifyInstance | null = null;

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


describe("F2.3 OpenAPI sin drift contra rutas Fastify", () => {
  it("el documento OpenAPI es 3.1 y tiene paths", () => {
    expect(openApiSpec.openapi).toBe("3.1.0");
    expect(Object.keys(openApiSpec.paths).length).toBeGreaterThan(0);
    expect(openApiSpec.components.schemas).toBeTruthy();
  });

  it("cada path documentado existe en Fastify con el mismo método", async () => {
    const server = await startTestServer();
    for (const p of fiscalPaths()) {
      const fastifyUrl = p.path.replace(/\{([A-Za-z]+)\}/g, ":$1");
      const hasRoute = server.hasRoute({ method: p.method.toUpperCase() as "GET", url: fastifyUrl });
      expect(
        hasRoute,
        `Drift: ${p.method.toUpperCase()} ${p.path} documentado en OpenAPI pero no registrado en Fastify`,
      ).toBe(true);
    }
  });

  it("los paths documentados no colisionan entre sí", () => {
    const seen = new Set<string>();
    for (const p of fiscalPaths()) {
      const key = `${p.method} ${p.path}`;
      expect(seen.has(key), `Path duplicado: ${key}`).toBe(false);
      seen.add(key);
    }
  });
});