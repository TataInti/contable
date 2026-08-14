import { createConnection } from "node:net";

export class ClamAvClient {
  constructor(
    private readonly host = process.env.CLAMAV_HOST ?? "localhost",
    private readonly port = Number(process.env.CLAMAV_PORT ?? 3310),
  ) {}

  scan(buffer: Buffer): Promise<{ clean: boolean; result: string }> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port });
      const responses: Buffer[] = [];
      const timer = setTimeout(() => socket.destroy(new Error("CLAMAV_TIMEOUT")), 15_000);
      socket.once("connect", () => {
        socket.write("zINSTREAM\0");
        const chunkSize = 64 * 1024;
        for (let offset = 0; offset < buffer.length; offset += chunkSize) {
          const chunk = buffer.subarray(offset, offset + chunkSize);
          const length = Buffer.allocUnsafe(4);
          length.writeUInt32BE(chunk.length);
          socket.write(length);
          socket.write(chunk);
        }
        socket.end(Buffer.alloc(4));
      });
      socket.on("data", (chunk) => responses.push(chunk));
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.once("close", (hadError) => {
        clearTimeout(timer);
        if (hadError) return;
        const result = Buffer.concat(responses).toString("utf8").replace(/\0/g, "").trim();
        if (!result) return reject(new Error("CLAMAV_EMPTY_RESPONSE"));
        resolve({ clean: result.endsWith("OK"), result });
      });
    });
  }
}
