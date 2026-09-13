import { describe, expect, it } from "vitest";
import { QUEUE_NAMES, createQueue } from "./queues.js";

describe("queues", () => {
  it("define colas separadas por dominio", () => {
    expect(QUEUE_NAMES).toContain("documents");
    expect(QUEUE_NAMES).toContain("exports");
    expect(QUEUE_NAMES).toContain("notifications");
    expect(QUEUE_NAMES).toContain("recurrences");
    expect(QUEUE_NAMES).toContain("ai");
    expect(QUEUE_NAMES).toContain("maintenance");
  });

  it("createQueue requiere url de redis", () => {
    const q = createQueue("documents", { redisUrl: "redis://localhost:6379", concurrency: 1, prefix: "test" });
    expect(q.name).toBe("documents");
    expect(q.opts.prefix).toBe("test");
    void q.close();
  });
});
