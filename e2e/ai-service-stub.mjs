// Stub determinístico del servicio de IA para el job E2E (solo CI y pruebas locales).
// Responde readiness y, para los calendarios fiscales, la lectura fijada en
// e2e/fixtures/calendario-arca-2027-lectura-ia.csv (datos sintéticos). El resto de
// las rutas responde 404, como antes: no valida funciones de IA de comprobantes.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("./fixtures/calendario-arca-2027-lectura-ia.csv", import.meta.url));
const port = Number(process.env.AI_STUB_PORT ?? 8000);

const server = createServer((request, response) => {
  if (request.url === "/health/ready") {
    response.writeHead(200);
    response.end("ok");
    return;
  }
  if (request.method === "POST" && request.url === "/internal/v1/calendar-extractions") {
    request.resume();
    request.on("end", () => {
      const csv = readFileSync(fixture, "utf-8");
      const rowCount = csv.trim().split("\n").length - 1;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          status: "READ",
          reason: null,
          csv,
          pageCount: 1,
          rowCount,
          model: "stub-e2e",
          provider: "stub-e2e",
          promptVersion: "calendar-ar-v1",
        }),
      );
    });
    return;
  }
  response.writeHead(404);
  response.end();
});

server.listen(port, () => console.log(`ai stub escuchando en ${port}`));
