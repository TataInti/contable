/**
 * Alta en lote de usuarios internos: interpreta una lista pegada, una persona
 * por línea (`nombre, email, rol`). Helper puro y testeable por unidad; la
 * creación real se hace una cuenta por vez contra el endpoint individual, de
 * modo que cada alta conserva sus validaciones y su auditoría.
 */

export const BATCH_DEFAULT_ROLE = "PREPARER";

const ROLE_ALIASES: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  ["OWNER", ["owner", "titular"]],
  ["ADMIN", ["admin", "administrador"]],
  ["PREPARER", ["preparer", "preparador"]],
  ["REVIEWER", ["reviewer", "revisor"]],
  ["AUDITOR_READONLY", ["auditor_readonly", "auditor", "auditor solo lectura", "solo lectura"]],
];

const EMAIL_PATTERN = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

export interface BatchUserLine {
  /** Número de línea (base 1) dentro del texto pegado. */
  line: number;
  name: string;
  email: string;
  /** Código de rol resuelto; `null` si el texto de rol no se reconoce. */
  role: string | null;
  error: string | null;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[·_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function resolveBatchRole(raw: string | undefined): string | null {
  const text = normalize(raw ?? "");
  if (!text) return BATCH_DEFAULT_ROLE;
  for (const [code, aliases] of ROLE_ALIASES) {
    if (aliases.some((alias) => normalize(alias) === text)) return code;
  }
  return null;
}

export function parseBatchUsers(text: string): BatchUserLine[] {
  const seen = new Set<string>();
  const result: BatchUserLine[] = [];
  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;
    const [name = "", email = "", roleText] = line.split(",").map((part) => part.trim());
    const role = resolveBatchRole(roleText);
    const emailKey = email.toLowerCase();
    let error: string | null = null;
    if (!name) error = "Falta el nombre.";
    else if (!EMAIL_PATTERN.test(email)) error = "Email inválido o faltante.";
    else if (role === null) error = `Rol desconocido: “${roleText}”.`;
    else if (seen.has(emailKey)) error = "Email repetido en la lista.";
    if (!error) seen.add(emailKey);
    result.push({ line: index + 1, name, email, role, error });
  });
  return result;
}

/** Evita que una celda se interprete como fórmula al abrir el CSV en una planilla. */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function credentialsCsv(
  rows: ReadonlyArray<{ name: string; email: string; role: string; temporaryPassword: string }>,
): string {
  const header = ["nombre", "email", "rol", "contraseña_temporal"].map(csvCell).join(",");
  const body = rows.map((row) =>
    [row.name, row.email, row.role, row.temporaryPassword].map(csvCell).join(","),
  );
  return [header, ...body].join("\n");
}
