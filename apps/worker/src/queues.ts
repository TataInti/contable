import { Queue, Worker } from "bullmq";

export interface QueueConfig {
  redisUrl: string;
  concurrency: number;
}

export function loadQueueConfig(): QueueConfig {
  return {
    redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
    concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? "4", 10),
  };
}

/** Colas del producto (ADR-007). */
export const QUEUE_NAMES = [
  "documents",
  "exports",
  "notifications",
  "recurrences",
  "ai",
  "maintenance",
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

export function createQueue(name: QueueName, config: QueueConfig): Queue {
  return new Queue(name, { connection: { url: config.redisUrl } });
}

export function createWorker(
  name: QueueName,
  handler: (job: { id: string; name: string; data: unknown }) => Promise<void>,
  config: QueueConfig,
): Worker {
  const worker = new Worker(
    name,
    async (job) => {
      await handler({ id: job.id ?? "", name: job.name, data: job.data });
    },
    {
      connection: { url: config.redisUrl },
      concurrency: config.concurrency,
    },
  );
  return worker;
}