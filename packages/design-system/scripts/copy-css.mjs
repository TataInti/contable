import { copyFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, "..", "src");
const distDir = join(__dirname, "..", "dist");

for (const file of readdirSync(srcDir)) {
  if (file.endsWith(".css")) {
    copyFileSync(join(srcDir, file), join(distDir, file));
    console.log(`Copiado ${file} → dist`);
  }
}