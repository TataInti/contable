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
const diffDir = path.join(outputDir, "diff");
const basePath = "/reference-gallery.html";

await Promise.all([fs.mkdir(demoDir, { recursive: true }), fs.mkdir(dsDir, { recursive: true }), fs.mkdir(diffDir, { recursive: true })]);
const server = await createServer({
  root: packageDir,
  configFile: false,
  logLevel: "warn",
  server: { host: "127.0.0.1", port: 0, strictPort: true, open: false },
});
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Vite no devolvió un puerto TCP local válido");
  const baseUrl = `http://127.0.0.1:${address.port}${basePath}`;

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const demo = await context.newPage();
  await demo.goto(pathToFileURL(demoPath).href, { waitUntil: "networkidle" });
  await demo.evaluate(() => document.fonts.ready);
  await demo.waitForSelector(".cover-grid");
  await demo.screenshot({ path: path.join(demoDir, "portada.png"), animations: "disabled" });

  const ds = await context.newPage();
  await ds.goto(baseUrl, { waitUntil: "networkidle" });
  await ds.evaluate(() => document.fonts.ready);
  await ds.waitForSelector(".month-summary");
  await ds.screenshot({ path: path.join(dsDir, "portada.png"), animations: "disabled" });
  await context.close();

  const result = spawnSync("python3", [path.join(scriptDir, "visual-diff.py"), path.join(demoDir, "portada.png"), path.join(dsDir, "portada.png"), path.join(diffDir, "portada.png"), path.join(outputDir, "resultado.json"), "3"], { encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (browser) await browser.close();
  await server.close();
}
