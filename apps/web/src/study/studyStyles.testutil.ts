import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Texto de todos los estilos del estudio, en el orden en que se cargan.
 * `study.css` es sólo el índice; los estilos viven en `src/study/styles`.
 */
export function readStudyStyles(): string {
  const dir = resolve(process.cwd(), "src/study/styles");
  return readdirSync(dir)
    .filter((file) => file.endsWith(".css"))
    .sort()
    .map((file) => readFileSync(resolve(dir, file), "utf8"))
    .join("\n");
}
