import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { loadConfig } from "./config.js";
import { authPlugin } from "./auth/routes.js";
import { authGuardPlugin } from "./auth/guard.js";
import { firmRoutes } from "./firms/routes.js";
import { clientRoutes } from "./clients/routes.js";
import { documentRoutes } from "./documents/routes.js";
import { journalRoutes } from "./journal/routes.js";
import { bankingRoutes } from "./banking/routes.js";
import { taxRoutes } from "./tax/routes.js";
import { fiscalFoundationRoutes } from "./tax/fiscal-foundation-routes.js";
import { ingestionRoutes } from "./tax/ingestion-routes.js";
import { settlementRoutes } from "./tax/settlement-routes.js";
import { reportingRoutes } from "./reporting/routes.js";
import { assistantRoutes } from "./assistant/routes.js";
import { biRoutes } from "./bi/routes.js";
import { flagRoutes } from "./flags/routes.js";
import { portalRoutes } from "./portal/routes.js";
import { ObjectStorage } from "@contable/storage";
import { prisma } from "./lib/prisma.js";
import { ZodError } from "zod";
import { createConnection } from "node:net";
import { outboxPublisher } from "./jobs/outbox-publisher.js";

export interface HealthChecks {
  postgres: () => Promise<boolean>;
  valkey: () => Promise<boolean>;
  minio: () => Promise<boolean>;
  ai: () => Promise<boolean>;
}

async function pingValkey(): Promise<boolean> {
  const target = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
  return new Promise((resolve) => {
    const socket = createConnection({ host: target.hostname, port: Number(target.port || 6379) });
    const finish = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1_500);
    socket.once("connect", () => socket.write("*1\r\n$4\r\nPING\r\n"));
    socket.once("data", (chunk) => finish(chunk.toString().startsWith("+PONG")));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function defaultHealthChecks(storage: ObjectStorage): HealthChecks {
  return {
    postgres: () => prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    valkey: pingValkey,
    minio: () => storage.healthy(),
    ai: async () => {
      const base = process.env.AI_SERVICE_URL;
      if (!base) return process.env.NODE_ENV !== "production";
      try {
        const res = await fetch(`${base.replace(/\/$/, "")}/health/ready`, { signal: AbortSignal.timeout(1_500) });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}

export async function buildServer(overrides?: Partial<HealthChecks>): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  // Asegurar buckets de MinIO al arrancar (se omite en test)
  const storage = new ObjectStorage();
  const checks = { ...defaultHealthChecks(storage), ...overrides };
  if (process.env.NODE_ENV !== "test") {
    await storage.ensureBuckets().catch((err) => {
      app.log.warn({ err }, "No se pudieron asegurar los buckets de MinIO");
    });
  }

  // Liveness: proceso vivo, sin dependencias
  app.get("/health/live", async () => ({ status: "ok" }));

  // Readiness: dependencias indispensables
  app.get("/health/ready", async () => {
    const names = Object.keys(checks) as (keyof HealthChecks)[];
    const values = await Promise.all(names.map(async (name) => [name, await checks[name]()] as const));
    const dependencies = Object.fromEntries(values) as Record<keyof HealthChecks, boolean>;
    const ready = Object.values(dependencies).every(Boolean);
    return ready
      ? { status: "ready", dependencies }
      : Promise.reject(Object.assign(new Error("DEPENDENCY_UNAVAILABLE"), { statusCode: 503, dependencies }));
  });

  // Startup: inicialización/migraciones requeridas
  app.get("/health/startup", async () => ({ status: "started" }));

  app.get("/api/v1/ping", async () => ({ data: { message: "pong" } }));

  authPlugin(app);
  authGuardPlugin(app);
  firmRoutes(app);
  clientRoutes(app);
  documentRoutes(app);
  journalRoutes(app);
  bankingRoutes(app);
  taxRoutes(app);
  fiscalFoundationRoutes(app);
  ingestionRoutes(app);
  settlementRoutes(app);
  reportingRoutes(app);
  assistantRoutes(app);
  biRoutes(app);
  flagRoutes(app);
  portalRoutes(app);

  let outboxTimer: ReturnType<typeof setInterval> | undefined;
  if (process.env.NODE_ENV !== "test") {
    outboxTimer = setInterval(() => {
      void outboxPublisher.dispatchPending().catch((error) => app.log.error({ error }, "Falló el dispatcher de outbox"));
    }, 5_000);
    outboxTimer.unref();
  }
  app.addHook("onClose", async () => {
    if (outboxTimer) clearInterval(outboxTimer);
    await outboxPublisher.close();
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: { code: "NOT_FOUND", message: "Ruta no encontrada" } }),
  );

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "La solicitud contiene datos inválidos", details: err.issues },
      });
    }
    const typed = err as Error & { statusCode?: number; code?: string; dependencies?: unknown };
    const status = typed.statusCode && typed.statusCode >= 400 ? typed.statusCode : 500;
    const code = typed.code ?? (typed.message === "DEPENDENCY_UNAVAILABLE" ? "DEPENDENCY_UNAVAILABLE" : "INTERNAL_ERROR");
    return reply.status(status).send({
      error: {
        code,
        message: status >= 500 && code === "INTERNAL_ERROR" ? "Ocurrió un error interno" : typed.message,
        ...(typed.dependencies ? { dependencies: typed.dependencies } : {}),
      },
    });
  });

  return app;
}

export async function start() {
  const config = loadConfig();
  const app = await buildServer();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "Cerrando servidor");
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ host: config.host, port: config.port });
    app.log.info(`API escuchando en ${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void start();
}
