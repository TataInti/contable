import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Control de patrones de interfaz: lo que el sistema de diseño define una vez
 * no se vuelve a escribir a mano en una pantalla.
 *
 * Cada regla tiene una lista de excepciones conocidas (deuda registrada). El
 * test falla si aparece un uso nuevo, y también si una excepción ya no hace
 * falta, para que la lista sólo pueda achicarse.
 */

const SRC = resolve(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({
  path: relative(SRC, path),
  text: readFileSync(path, "utf8"),
}));

interface Rule {
  name: string;
  why: string;
  pattern: RegExp;
  /** Archivo → cantidad de usos tolerados (deuda registrada). */
  allowed: Record<string, number>;
}

const RULES: Rule[] = [
  {
    name: "confirmación de acción dibujada en la pantalla",
    why: "El resultado de una acción se avisa con useNotify(): notify.success o notify.error.",
    pattern: /Acción completada|action-receipt--page|\bsetReceipt\(/g,
    allowed: {},
  },
  {
    name: "recibo en línea",
    why: "Un estado del documento se muestra como texto o StatusBadge; una confirmación, con useNotify().",
    pattern: /className="action-receipt(?!--page)/g,
    allowed: {
      // Estados del documento en la revisión; se convierten al rediseñar la Bandeja.
      "study/StudyBandeja.tsx": 3,
    },
  },
];

describe("patrones de interfaz centralizados", () => {
  for (const rule of RULES) {
    it(`no reintroduce: ${rule.name}`, () => {
      const found: Record<string, number> = {};
      for (const file of files) {
        const count = file.text.match(rule.pattern)?.length ?? 0;
        if (count > 0) found[file.path] = count;
      }
      // Usos nuevos: fallan con la explicación de qué usar en su lugar.
      const added = Object.entries(found)
        .filter(([path, count]) => count > (rule.allowed[path] ?? 0))
        .map(([path, count]) => `${path}: ${count} (permitidos ${rule.allowed[path] ?? 0})`);
      expect(added, rule.why).toEqual([]);
      // Excepciones que ya no hacen falta: hay que quitarlas de la lista.
      const stale = Object.entries(rule.allowed)
        .filter(([path, count]) => (found[path] ?? 0) < count)
        .map(([path, count]) => `${path}: quedan ${found[path] ?? 0} de ${count}`);
      expect(stale, "Actualizá la lista de excepciones: la deuda bajó.").toEqual([]);
    });
  }
});
