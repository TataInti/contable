export type RegimenEtiqueta = {
  name?: string | null;
  taxType?: { name?: string | null } | null;
  jurisdiction?: { name?: string | null; kind?: string | null } | null;
};

const ORDEN_JURISDICCION = ["NATIONAL", "PROVINCIAL", "MUNICIPAL"] as const;
const NOMBRE_NIVEL: Record<(typeof ORDEN_JURISDICCION)[number], string> = {
  NATIONAL: "Nacional",
  PROVINCIAL: "Provincial",
  MUNICIPAL: "Municipal",
};

function texto(valor: string | null | undefined): string {
  return valor?.trim() ?? "";
}

export function etiquetaRegimen(regimen: RegimenEtiqueta): string {
  const nombre = texto(regimen.name);
  const datos = [texto(regimen.taxType?.name), texto(regimen.jurisdiction?.name)].filter(Boolean);
  return nombre && datos.length ? `${nombre} — ${datos.join(" · ")}` : nombre || datos.join(" · ");
}

export function ayudaRegimen(regimen: RegimenEtiqueta): string {
  return [
    texto(regimen.taxType?.name) ? `Impuesto: ${texto(regimen.taxType?.name)}` : "",
    texto(regimen.jurisdiction?.name) ? `Jurisdicción: ${texto(regimen.jurisdiction?.name)}` : "",
  ].filter(Boolean).join(" · ");
}

export function ordenarRegimenes<T extends RegimenEtiqueta>(regimenes: T[]): {
  agrupados: boolean;
  grupos: Array<{ nivel: string; nombre: string; regimenes: T[] }>;
  regimenes: T[];
} {
  const agrupados = regimenes.length > 0 && regimenes.every((regimen) =>
    ORDEN_JURISDICCION.includes(regimen.jurisdiction?.kind as (typeof ORDEN_JURISDICCION)[number]),
  );
  if (agrupados) {
    const grupos = ORDEN_JURISDICCION.map((nivel) => ({
      nivel,
      nombre: NOMBRE_NIVEL[nivel],
      regimenes: regimenes
        .filter((regimen) => regimen.jurisdiction?.kind === nivel)
        .sort((a, b) => etiquetaRegimen(a).localeCompare(etiquetaRegimen(b), "es")),
    })).filter((grupo) => grupo.regimenes.length > 0);
    return { agrupados: true, grupos, regimenes: grupos.flatMap((grupo) => grupo.regimenes) };
  }
  const ordenados = [...regimenes].sort((a, b) =>
    [texto(a.jurisdiction?.name), texto(a.name)].join("\u0000").localeCompare(
      [texto(b.jurisdiction?.name), texto(b.name)].join("\u0000"), "es",
    ),
  );
  return { agrupados: false, grupos: [], regimenes: ordenados };
}
