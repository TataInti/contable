import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "vite";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, "..");
const demoPath = "/home/hermes/.hermes/workspace/contable/rediseno-pantallas/v2/prototipo/index.html";
const outputDir = process.env.DS0C_OUTPUT ?? "/home/hermes/.hermes/workspace/contable/rediseno-pantallas/ds-0c";
const demoDir = path.join(outputDir, "demo");
const dsDir = path.join(outputDir, "ds");
const pairedDir = path.join(outputDir, "lado-a-lado");
const screenNames = process.env.DS0C_SCREENS?.split(",").map((screen) => screen.trim()).filter(Boolean) ?? ["portada"];
const demoLegajoTab = { controles: "Controles · 2", "control-panel": "Controles · 2", clasificacion: "Clasificación" };
const dsReady = {
  portada: ".cover-grid",
  controles: ".work-queue",
  "control-panel": '[role="dialog"]',
  clasificacion: ".ds-table",
  triage: ".document-triage",
  cliente: ".object-page",
};

await Promise.all([fs.mkdir(demoDir, { recursive: true }), fs.mkdir(dsDir, { recursive: true }), fs.mkdir(pairedDir, { recursive: true })]);
const server = await createServer({ root: packageDir, configFile: false, logLevel: "warn", server: { host: "127.0.0.1", port: 0, strictPort: true, open: false } });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Vite no devolvió un puerto TCP local válido");
  const baseUrl = `http://127.0.0.1:${address.port}/reference-gallery.html`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const results = [];

  for (const name of screenNames) {
    const demo = await context.newPage();
    await demo.goto(pathToFileURL(demoPath).href, { waitUntil: "networkidle" });
    if (demoLegajoTab[name]) {
      await demo.getByRole("button", { name: demoLegajoTab[name], exact: true }).click();
      if (name === "control-panel") await demo.locator(".list button.textbtn").first().click();
    } else if (name === "triage") {
      await demo.getByRole("button", { name: "Bandeja documental", exact: true }).click();
    } else if (name === "cliente") {
      await demo.getByRole("button", { name: "ZZ-AYUDA Restaurante Nuevo", exact: true }).click();
    }
    await demo.evaluate(() => document.fonts.ready);
    await demo.waitForTimeout(100);
    const demoPathOut = path.join(demoDir, `${name}.png`);
    await demo.screenshot({ path: demoPathOut, animations: "disabled" });

    const ds = await context.newPage();
    await ds.goto(`${baseUrl}?screen=${encodeURIComponent(name)}`, { waitUntil: "networkidle" });
    await ds.evaluate(() => document.fonts.ready);
    await ds.waitForSelector(dsReady[name], { timeout: 10000 });
    await ds.waitForTimeout(100);
    const dsPathOut = path.join(dsDir, `${name}.png`);
    await ds.screenshot({ path: dsPathOut, animations: "disabled" });
    const pairedPath = path.join(pairedDir, `${name}.png`);
    const combined = spawnSync("python3", [path.join(scriptDir, "compose-reference.py"), demoPathOut, dsPathOut, pairedPath], { encoding: "utf8" });
    if (combined.stdout) process.stdout.write(combined.stdout);
    if (combined.stderr) process.stderr.write(combined.stderr);
    if (combined.error) throw combined.error;
    if (combined.status !== 0) throw new Error(`No se pudo componer ${name} (exit ${combined.status})`);
    results.push({ nombre: name, demo: demoPathOut, design_system: dsPathOut, lado_a_lado: pairedPath, dimensiones_por_panel: { ancho: 1440, alto: 900 } });
    await demo.close();
    await ds.close();
  }
  await context.close();
  const result = { criterio: "revisión humana lado a lado; sin umbral de píxeles", pantallas: results };
  const resultPath = path.join(outputDir, "resultado.json");
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  if (browser) await browser.close();
  await server.close();
}
