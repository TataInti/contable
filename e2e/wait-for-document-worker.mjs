import { Queue } from "bullmq";

const queue = new Queue("documents", {
  connection: { url: process.env.REDIS_URL ?? "redis://localhost:6379" },
  prefix: process.env.QUEUE_PREFIX ?? "bull",
});

async function waitForWorker() {
  const deadline = Date.now() + 60_000;

  try {
    while (Date.now() < deadline) {
      const workers = await queue.getWorkers();
      if (workers.length > 0) {
        console.log(`Document worker ready (${workers.length} consumer(s))`);
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error("Timed out waiting for a worker on the documents queue");
  } finally {
    await queue.close();
  }
}

await waitForWorker();