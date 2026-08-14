import { Queue } from "bullmq";
import { prisma } from "../lib/prisma.js";

const ALLOWED_TOPICS = new Set(["documents", "exports", "notifications", "recurrences", "ai", "maintenance"]);

interface ClaimedEvent {
  id: string;
  topic: string;
  eventType: string;
  aggregateId: string;
  payload: unknown;
}

export class OutboxPublisher {
  private queues = new Map<string, Queue>();

  private queue(topic: string): Queue {
    const current = this.queues.get(topic);
    if (current) return current;
    const queue = new Queue(topic, { connection: { url: process.env.REDIS_URL ?? "redis://localhost:6379" } });
    this.queues.set(topic, queue);
    return queue;
  }

  async dispatchPending(limit = 25): Promise<number> {
    const events = await prisma.$queryRaw<ClaimedEvent[]>`SELECT * FROM app_claim_outbox(${limit})`;
    let published = 0;
    for (const event of events) {
      try {
        if (!ALLOWED_TOPICS.has(event.topic)) throw new Error(`OUTBOX_TOPIC_NOT_ALLOWED:${event.topic}`);
        await this.queue(event.topic).add(event.eventType, event.payload, {
          jobId: event.aggregateId,
          attempts: 5,
          backoff: { type: "exponential", delay: 1_000 },
          removeOnComplete: { age: 86_400, count: 1_000 },
          removeOnFail: false,
        });
        await prisma.$queryRaw`SELECT app_complete_outbox(${event.id})`;
        published++;
      } catch (error) {
        await prisma.$queryRaw`SELECT app_fail_outbox(${event.id}, ${error instanceof Error ? error.message : "UNKNOWN"})`;
      }
    }
    return published;
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }
}

export const outboxPublisher = new OutboxPublisher();
