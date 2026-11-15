import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

/*
 * Pruebas en serie sobre las tablas de liquidación.
 *
 * Varias pruebas de liquidación desactivan los triggers inmutables con
 * `ALTER TABLE … DISABLE TRIGGER` dentro de una transacción. Ese DDL toma un
 * bloqueo SHARE ROW EXCLUSIVE sobre la tabla y choca con los INSERT/DELETE de
 * otra transacción. Si dos archivos escriben esas tablas a la vez sobre la misma
 * base, PostgreSQL puede formar un ciclo de bloqueos y abortar una de las dos
 * con `40P01 deadlock detected` (CI: settlement-tem, settlement-iibb, settlement-cm03,
 * workpaper, profitability, ingestion). En un VPS de dos núcleos no aparece,
 * porque Vitest usa un worker menos que los núcleos disponibles.
 *
 * Por eso los archivos de prueba que escriben estas tablas, directa o
 * indirectamente (por sus imports), corren en serie en un proyecto aparte. El
 * resto de la suite sigue en paralelo. La lista se calcula al cargar la
 * configuración: un archivo nuevo que escriba estas tablas entra en la serie
 * sin editar esta configuración.
 */
const API_ROOT = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(API_ROOT, "src");
const SETTLEMENT_TABLES = ["tax_settlements", "settlement_inputs", "tax_settlement_lines", "tax_differences"];
const SETTLEMENT_MODELS = ["taxSettlement", "settlementInput", "taxSettlementLine", "taxDifference"];
const TABLE_REF = new RegExp(SETTLEMENT_TABLES.join("|"));
const MODEL_REF = new RegExp(`\\.(?:${SETTLEMENT_MODELS.join("|")})\\.`);
const IMPORT_REF = /(?:\bfrom\s+|\bimport\(\s*|\bvi\.mock\(\s*)["'](\.{1,2}\/[^"']+)["']/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

function resolveImport(from: string, specifier: string): string | undefined {
  const base = resolve(dirname(from), specifier.replace(/\.(?:js|ts)$/, ""));
  return [`${base}.ts`, join(base, "index.ts")].find((candidate) => existsSync(candidate));
}

function settlementWriterTests(): string[] {
  const files = sourceFiles(SRC_ROOT);
  const sources = new Map(files.map((file) => [file, readFileSync(file, "utf8")] as const));
  const imports = new Map(
    files.map((file) => [
      file,
      [...(sources.get(file) ?? "").matchAll(IMPORT_REF)]
        .map((match) => resolveImport(file, match[1] ?? ""))
        .filter((target): target is string => target !== undefined),
    ] as const),
  );
  const touches = new Set(
    files.filter((file) => {
      const source = sources.get(file) ?? "";
      return TABLE_REF.test(source) || MODEL_REF.test(source);
    }),
  );
  for (let changed = true; changed; ) {
    changed = false;
    for (const file of files) {
      if (!touches.has(file) && (imports.get(file) ?? []).some((target) => touches.has(target))) {
        touches.add(file);
        changed = true;
      }
    }
  }
  return files
    .filter((file) => file.endsWith(".test.ts") && touches.has(file))
    .map((file) => relative(API_ROOT, file))
    .sort();
}

const serialFiles = settlementWriterTests();

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "liquidacion-en-serie",
          include: serialFiles,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "resto",
          include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)"],
          exclude: [...configDefaults.exclude, ...serialFiles],
        },
      },
    ],
  },
});
