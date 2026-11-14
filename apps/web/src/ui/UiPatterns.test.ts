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
  /** Si está, la regla sólo mira los archivos cuya ruta coincide. */
  only?: RegExp;
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
  {
    name: "botón de peligro sólido fuera de una confirmación",
    why: "En pantallas y filas va variant=\"danger\" (discreto). El sólido es sólo el botón que confirma dentro de un diálogo: usá ConfirmDialog.",
    pattern: /variant="danger-solid"/g,
    allowed: {
      // Diálogos propios que confirman una acción destructiva.
      "ui/DeletionDrawer.tsx": 1,
      "study/ManualExtractionFieldsDialog.tsx": 1,
    },
  },
  {
    name: "selector de densidad en una pantalla",
    why: "La densidad de las tablas es una preferencia de la persona: se cambia una sola vez, en el menú de ayuda (StudyShell).",
    pattern: /<DensitySwitch\b/g,
    allowed: { "shells/StudyShell.tsx": 1 },
  },
  {
    name: "tabla escrita a mano",
    why: "Las tablas son Table (lectura) o DenseTable (lista con selección y detalle). No se escribe <table> en una pantalla.",
    pattern: /<table\b/g,
    allowed: {
      // Deuda registrada: grillas de edición que todavía no tienen componente.
      "study/StudyExpedienteMensual.tsx": 1,
      "study/StudyAdministracion.tsx": 3,
      "study/ManualExtractionFieldsDialog.tsx": 1,
      "study/StudyAyuda.tsx": 1,
    },
  },
  {
    name: "rótulo en mayúsculas sobre un título",
    why: "Pantallas, paneles, cajones y fichas llevan título y, si hace falta, una línea de descripción. Sin rótulo superior.",
    pattern: /study-page__eyebrow|\beyebrow=/g,
    // El portal del cliente tiene su propio encabezado; se revisa aparte.
    only: /^(study|shells|ui)\//,
    allowed: {
      // La página de ayuda es un documento con su propia composición.
      "study/StudyAyuda.tsx": 4,
    },
  },
  {
    name: "confirmación del navegador",
    why: "Una acción riesgosa se confirma con ConfirmDialog (useConfirmAction), nunca con window.confirm o alert.",
    pattern: /window\.(confirm|alert)\(|(?<![.\w])(confirm|alert)\(/g,
    allowed: {},
  },
  {
    name: "rótulo sobre el título de la pantalla",
    why: "El encabezado de pantalla es DenseHeader: título, una línea de descripción y acciones. Sin rótulo superior.",
    pattern: /<DenseHeader\s+eyebrow=/g,
    allowed: {},
  },
];

describe("patrones de interfaz centralizados", () => {
  for (const rule of RULES) {
    it(`no reintroduce: ${rule.name}`, () => {
      const found: Record<string, number> = {};
      for (const file of files) {
        if (rule.only && !rule.only.test(file.path)) continue;
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
