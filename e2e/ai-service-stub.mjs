// Stub determinístico del servicio de IA para el job E2E (solo CI y pruebas locales).
// Responde readiness y, para los calendarios fiscales, la lectura fijada en
// e2e/fixtures/calendario-arca-2027-lectura-ia.csv (datos sintéticos). El resto de
// las rutas responde 404, como antes: no valida funciones de IA de comprobantes.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("./fixtures/calendario-arca-2027-lectura-ia.csv", import.meta.url));
const port = Number(process.env.AI_STUB_PORT ?? 8000);

// Comprobantes de la Bandeja (POST /internal/v1/extractions): la lectura sale de marcadores sintéticos del
// propio archivo (CUIT_EMISOR=, CUIT_RECEPTOR=, TOTAL=). El archivo se baja por la URL firmada que manda el worker.
const marcador = (texto, nombre) => {
  const coincidencia = texto.match(new RegExp(`${nombre}=([0-9.]+)`));
  return coincidencia ? coincidencia[1] : null;
};

async function leerComprobante(downloadUrl) {
  const respuesta = await fetch(downloadUrl);
  const texto = Buffer.from(await respuesta.arrayBuffer()).toString("latin1");
  const emisor = marcador(texto, "CUIT_EMISOR")?.replace(/\D/g, "") ?? null;
  const receptor = marcador(texto, "CUIT_RECEPTOR")?.replace(/\D/g, "") ?? null;
  const total = marcador(texto, "TOTAL") ?? "121000.00";
  const neto = (Number(total) / 1.21).toFixed(2);
  const iva = (Number(total) - Number(neto)).toFixed(2);
  return {
    schemaVersion: "voucher-ar-v2.1",
    voucher: {
      tipo_documento: "factura",
      letra: "A",
      punto_venta: "0001",
      numero: "00000001",
      fecha: "2026-10-05",
      hora: null,
      cuit_emisor: emisor,
      cuit_receptor: receptor,
      razon_social_emisor: "PROVEEDOR SINTETICO E2E",
      razon_social_receptor: "RECEPTOR SINTETICO E2E",
      condicion_iva: "Responsable Inscripto",
      neto_gravado: neto,
      iva: [{ alicuota: "21", importe: iva }],
      no_gravado: "0.00",
      exento: "0.00",
      percepciones: null,
      total,
      moneda: "ARS",
      cae: null,
      cae_vencimiento: null,
      confianza: {},
    },
    classificationConfidence: 0.98,
    fields: [],
    issues: [],
    reviewReason: null,
    reviewIssues: [],
    ocrEngine: "stub-e2e",
    model: "stub-e2e",
    provider: "stub-e2e",
    promptVersion: "voucher-ar-v2.1-stub",
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 1,
    estimatedCostUsd: 0,
  };
}

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
  if (request.method === "POST" && request.url === "/internal/v1/extractions") {
    const trozos = [];
    request.on("data", (trozo) => trozos.push(trozo));
    request.on("end", async () => {
      try {
        const cuerpo = JSON.parse(Buffer.concat(trozos).toString("utf-8"));
        const lectura = await leerComprobante(cuerpo.source.downloadUrl);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(lectura));
      } catch (error) {
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ detail: String(error) }));
      }
    });
    return;
  }
  response.writeHead(404);
  response.end();
});

server.listen(port, () => console.log(`ai stub escuchando en ${port}`));
