import { createWorker, loadQueueConfig, type QueueName } from "./queues.js";
import { ObjectStorage } from "@contable/storage";
import { DocumentProcessor } from "./document-processor.js";
import { AiClient } from "./ai-client.js";
import { processNotification } from "./notification-processor.js";
import { processMaintenance } from "./maintenance-processor.js";
import { processExport } from "./export-processor.js";
import { processRecurrence } from "./recurrence-processor.js";

/**
 * Handlers por cola. Cada job es idempotente por clave natural o deduplicationKey.
 * El outbox/PostgreSQL conserva la intención durable; Valkey no es fuente de verdad.
 */

export interface JobContext {
  queue: QueueName;
  id: string;
  name: string;
  data: unknown;
}

const storage = new ObjectStorage();
const aiClient = new AiClient(storage);
const documentProcessor = new DocumentProcessor(storage, aiClient);

const handlers: Record<QueueName, (ctx: JobContext) => Promise<void>> = {
  documents: async (ctx) => {
    await documentProcessor.process(ctx.data as Parameters<typeof documentProcessor.process>[0]);
  },
  exports: async (ctx) => {
    await processExport(ctx.name, ctx.data);
  },
  notifications: async (ctx) => {
    await processNotification(ctx.name, ctx.data);
  },
  recurrences: async (ctx) => {
    await processRecurrence(ctx.name, ctx.data);
  },
  ai: async (ctx) => {
    throw new Error(`UNSUPPORTED_AI_JOB:${ctx.name}`);
  },
  maintenance: async (ctx) => {
    await processMaintenance(ctx.name, ctx.data);
  },
};

export function startWorkers() {
  const config = loadQueueConfig();
  const enabled = (process.env.WORKER_QUEUES ?? "documents,notifications")
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is QueueName => value in handlers);
  const workers = enabled.map((name) =>
    createWorker(
      name,
      (job) => handlers[name]({ queue: name, ...job }),
      config,
    ),
  );

  workers.forEach((w) => {
    w.on("failed", (job, err) => {
      console.error(`[${w.name}] job ${job?.id} falló:`, err);
    });
  });

  console.log(
    `Worker iniciado: ${workers.length} colas (${enabled.join(", ")})`,
  );
  return workers;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startWorkers();
}
