import {
  isRealIsoDate,
  TAX_CALENDAR_IMPORT_COLUMNS,
  TAX_CALENDAR_IMPORT_MAX_BYTES,
  TAX_CALENDAR_IMPORT_MAX_ROWS,
  TAX_CALENDAR_IMPORT_REQUIRED_COLUMNS,
  taxCalendarEntryInputSchema,
  type TaxCalendarEntryInput,
  type TaxCalendarImportNotice,
  type TaxCalendarImportRejection,
} from "@contable/contracts";

/**
 * Lector y mapeo del CSV de calendarios fiscales (corte 2b-1). Son funciones puras:
 * no tocan la base. El servicio decide qué se escribe.
 *
 * Mapeo a una celda: la validación final es `taxCalendarEntryInputSchema`, la misma
 * que usa la carga a mano. Acá solo se traducen los valores del archivo y los motivos
 * de los formatos del CSV (fechas, dígitos, período) con el texto que pide el brief.
 */

export type ColumnaCsv = (typeof TAX_CALENDAR_IMPORT_COLUMNS)[number];

/** El archivo entero no se puede importar (vacío, sin encabezados, demasiado grande). */
export class ArchivoCsvInvalidoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchivoCsvInvalidoError";
  }
}

export interface FilaCsv {
  /** Número de fila de la hoja: el encabezado es la 1. */
  fila: number;
  /** Valores de las columnas conocidas, por nombre, sin espacios de los extremos. */
  valores: Partial<Record<ColumnaCsv, string>>;
  /** Cantidad de valores con texto que no tienen encabezado (fila mal alineada). */
  valoresSinColumna: number;
}

export interface LecturaCsv {
  columnasIgnoradas: string[];
  filas: FilaCsv[];
}

/** Forma de `extraction` en la celda importada (brief 2b-1). */
export type ExtraccionCsv = {
  origen: "importación CSV";
  bloque: string;
  origen_celda: string;
  confianza: string;
  verificado_en_imagen: string;
  fila: number;
};

/** Celda lista para guardar: pasó la validación de la carga manual. */
export interface CeldaMapeada {
  fila: number;
  entrada: TaxCalendarEntryInput;
  /** FLAGGED (dudosa) si la confianza no es «alta» o no está verificada en imagen; REVIEWED si no. */
  revision: "FLAGGED" | "REVIEWED";
  paginaOrigen: number | null;
  extraccion: ExtraccionCsv;
  avisos: TaxCalendarImportNotice[];
}

export interface ResultadoFila {
  celda: CeldaMapeada | null;
  rechazos: TaxCalendarImportRejection[];
}

export interface ResultadoImportacion {
  totalFilas: number;
  celdas: CeldaMapeada[];
  rechazadas: TaxCalendarImportRejection[];
  avisos: TaxCalendarImportNotice[];
}

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

const TODAS_LAS_TERMINACIONES = "0123456789";

const COLUMNA_DE_CAMPO: Readonly<Record<string, ColumnaCsv>> = {
  conceptLabel: "concepto",
  groupingKind: "criterio_agrupacion",
  endingDigits: "digitos",
  dueDate: "fecha_completa",
  referencePeriodStart: "periodo_referencia",
  referencePeriodEnd: "periodo_referencia",
  referenceLabel: "periodo_referencia",
  noteText: "nota",
};

/** Sin mayúsculas, tildes ni espacios sobrantes: «Terminación  de CUIT» = «terminacion de cuit». */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Separa el texto en registros (RFC 4180): comas, comillas dobles con «""» y saltos CRLF o LF dentro de comillas. */
export function parsearRegistrosCsv(texto: string): string[][] {
  const t = texto.startsWith("\uFEFF") ? texto.slice(1) : texto;
  const registros: string[][] = [];
  let registro: string[] = [];
  let campo = "";
  let entreComillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i] as string;
    if (entreComillas) {
      if (c !== '"') {
        campo += c;
      } else if (t[i + 1] === '"') {
        campo += '"';
        i++;
      } else {
        entreComillas = false;
      }
      continue;
    }
    if (c === '"' && campo === "") {
      entreComillas = true;
    } else if (c === ",") {
      registro.push(campo);
      campo = "";
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      registro.push(campo);
      registros.push(registro);
      registro = [];
      campo = "";
    } else {
      campo += c;
    }
  }
  if (entreComillas) {
    throw new ArchivoCsvInvalidoError(
      "Hay una comilla sin cerrar: revisá el archivo, cada campo con comillas debe cerrarse.",
    );
  }
  if (campo !== "" || registro.length > 0) {
    registro.push(campo);
    registros.push(registro);
  }
  return registros;
}

/**
 * Lee el archivo completo: tope de tamaño, encabezados (en cualquier orden), columnas
 * obligatorias y tope de filas. Lanza ArchivoCsvInvalidoError si el archivo no se puede
 * importar. Las filas en blanco no cuentan; el número de fila es el de la hoja.
 */
export function leerCsvCalendario(texto: string): LecturaCsv {
  const bytes = Buffer.byteLength(texto, "utf8");
  if (bytes > TAX_CALENDAR_IMPORT_MAX_BYTES) {
    throw new ArchivoCsvInvalidoError(
      `El archivo supera el máximo de 1 MB (pesa ${Math.ceil(bytes / 1024)} KB). Dividilo en archivos más chicos.`,
    );
  }
  const registros = parsearRegistrosCsv(texto)
    .map((valores, indice) => ({ fila: indice + 1, valores }))
    .filter((registro) => registro.valores.some((valor) => valor.trim() !== ""));
  const cabecera = registros[0];
  if (!cabecera) {
    throw new ArchivoCsvInvalidoError(
      "El archivo está vacío. Subí un CSV con el encabezado y al menos una fila.",
    );
  }
  const encabezados = cabecera.valores.map(normalizarTexto);
  for (const columna of TAX_CALENDAR_IMPORT_COLUMNS) {
    if (encabezados.filter((nombre) => nombre === columna).length > 1) {
      throw new ArchivoCsvInvalidoError(
        `La columna «${columna}» aparece dos veces en el encabezado.`,
      );
    }
  }
  const faltantes = TAX_CALENDAR_IMPORT_REQUIRED_COLUMNS.filter(
    (columna) => !encabezados.includes(columna),
  );
  if (faltantes.length > 0) {
    throw new ArchivoCsvInvalidoError(
      `Faltan columnas obligatorias en el encabezado: ${faltantes.join(", ")}. Revisá la primera fila del archivo.`,
    );
  }
  const conocidas = new Set<string>(TAX_CALENDAR_IMPORT_COLUMNS);
  const columnasIgnoradas = [
    ...new Set(encabezados.filter((nombre) => nombre !== "" && !conocidas.has(nombre))),
  ];
  const datos = registros.slice(1);
  if (datos.length === 0) {
    throw new ArchivoCsvInvalidoError(
      "El archivo tiene encabezado pero no tiene filas de datos debajo.",
    );
  }
  if (datos.length > TAX_CALENDAR_IMPORT_MAX_ROWS) {
    throw new ArchivoCsvInvalidoError(
      `El archivo tiene ${datos.length} filas y el máximo es ${TAX_CALENDAR_IMPORT_MAX_ROWS.toLocaleString("es-AR")}. Dividilo en archivos más chicos.`,
    );
  }
  const filas = datos.map(({ fila, valores }): FilaCsv => {
    const porColumna: Partial<Record<ColumnaCsv, string>> = {};
    encabezados.forEach((nombre, indice) => {
      if (conocidas.has(nombre)) porColumna[nombre as ColumnaCsv] = (valores[indice] ?? "").trim();
    });
    const valoresSinColumna = valores
      .slice(encabezados.length)
      .filter((valor) => valor.trim() !== "").length;
    return { fila, valores: porColumna, valoresSinColumna };
  });
  return { columnasIgnoradas, filas };
}

/** Dígitos de una celda: rango «0-3», lista «0-1-2-3», juntos «0123» o «todos». Devuelve las terminaciones ordenadas. */
function interpretarDigitos(
  bruto: string,
  agrupacion: "ENDING_DIGITS" | "ALL",
): { terminaciones: string | null } | { error: string } {
  const texto = bruto.replace(/\s+/g, "").toLowerCase();
  if (agrupacion === "ALL") {
    return texto === "todos"
      ? { terminaciones: null }
      : { error: `Con agrupación «todos», los dígitos van como «todos» (recibido «${bruto}»)` };
  }
  if (texto === "todos") return { terminaciones: TODAS_LAS_TERMINACIONES };
  let digitos: string[];
  if (/^\d-\d$/.test(texto)) {
    const [desde = 0, hasta = 0] = texto.split("-").map(Number);
    if (desde > hasta) return { error: `El rango «${bruto}» va de menor a mayor, por ejemplo 0-3` };
    digitos = Array.from({ length: hasta - desde + 1 }, (_, i) => String(desde + i));
  } else if (/^\d(-\d)+$/.test(texto)) {
    digitos = texto.split("-");
  } else if (/^\d{1,10}$/.test(texto)) {
    digitos = texto.split("");
  } else {
    return {
      error: `No reconozco los dígitos «${bruto}»: usá un rango (0-3), una lista (0-1-2-3), los dígitos juntos (0123) o «todos»`,
    };
  }
  if (new Set(digitos).size !== digitos.length)
    return { error: `Hay dígitos repetidos en «${bruto}»` };
  return { terminaciones: [...digitos].sort().join("") };
}

/** Mes de un período «aaaa-mm»: primer y último día, y el texto «julio de 2026». */
function periodoMensual(
  anio: number,
  mes: number,
): { inicio: string; fin: string; etiqueta: string } {
  const mm = String(mes).padStart(2, "0");
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return {
    inicio: `${anio}-${mm}-01`,
    fin: `${anio}-${mm}-${String(ultimoDia).padStart(2, "0")}`,
    etiqueta: `${MESES[mes - 1]} de ${anio}`,
  };
}

/** Traduce una fila del archivo a una celda, o a los motivos por los que no se importa. */
export function mapearFila(entrada: FilaCsv): ResultadoFila {
  const { fila, valores } = entrada;
  const rechazos: TaxCalendarImportRejection[] = [];
  const avisos: TaxCalendarImportNotice[] = [];
  const columnasConError = new Set<ColumnaCsv>();
  const rechazar = (columna: ColumnaCsv | null, motivo: string) => {
    rechazos.push({
      fila,
      columna,
      motivo,
      valorRecibido: columna ? valores[columna] || null : null,
    });
    if (columna) columnasConError.add(columna);
  };

  if (entrada.valoresSinColumna > 0) {
    rechazar(
      null,
      `La fila tiene ${entrada.valoresSinColumna} valor(es) de más: revisá las comas y las comillas de esta fila`,
    );
    return { celda: null, rechazos };
  }

  const candidato: Record<string, unknown> = { conceptLabel: valores.concepto ?? "" };

  const criterioBruto = valores.criterio_agrupacion ?? "";
  const criterio = normalizarTexto(criterioBruto);
  let agrupacion: "ENDING_DIGITS" | "ALL" | null = null;
  if (criterio === "terminacion de cuit") agrupacion = "ENDING_DIGITS";
  else if (criterio === "todos") agrupacion = "ALL";
  else {
    rechazar(
      "criterio_agrupacion",
      criterioBruto === ""
        ? "Falta la agrupación: usá «terminación de CUIT» o «todos»"
        : `No reconozco la agrupación «${criterioBruto}»: usá «terminación de CUIT» o «todos»`,
    );
  }
  if (agrupacion) candidato.groupingKind = agrupacion;

  const digitosBrutos = valores.digitos ?? "";
  if (digitosBrutos === "") {
    rechazar(
      "digitos",
      "Faltan los dígitos: usá un rango (0-3), una lista (0-1-2-3), los dígitos juntos (0123) o «todos»",
    );
  } else if (agrupacion) {
    const digitos = interpretarDigitos(digitosBrutos, agrupacion);
    if ("error" in digitos) rechazar("digitos", digitos.error);
    else if (digitos.terminaciones) candidato.endingDigits = digitos.terminaciones;
  }

  const fechaBruta = valores.fecha_completa ?? "";
  if (fechaBruta === "") rechazar("fecha_completa", "Falta la fecha de vencimiento");
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaBruta))
    rechazar("fecha_completa", "La fecha debe tener el formato aaaa-mm-dd");
  else if (!isRealIsoDate(fechaBruta)) rechazar("fecha_completa", "La fecha no existe");
  else candidato.dueDate = fechaBruta;

  const periodo = valores.periodo_referencia ?? "";
  if (periodo === "") {
    rechazar("periodo_referencia", "Falta el período de referencia");
  } else {
    const mensual = /^(\d{4})-(\d{2})$/.exec(periodo);
    if (!mensual) {
      candidato.referenceLabel = periodo;
      avisos.push({
        fila,
        motivo: `El período «${periodo}» es texto libre: se importa solo con ese texto, sin fechas de referencia`,
      });
    } else {
      const anio = Number(mensual[1]);
      const mes = Number(mensual[2]);
      if (anio < 2000 || anio > 2100) {
        rechazar("periodo_referencia", "El año del período debe estar entre 2000 y 2100");
      } else if (mes < 1 || mes > 12) {
        rechazar("periodo_referencia", "El mes del período no existe: va de 01 a 12");
      } else {
        const mes2 = periodoMensual(anio, mes);
        candidato.referencePeriodStart = mes2.inicio;
        candidato.referencePeriodEnd = mes2.fin;
        candidato.referenceLabel = mes2.etiqueta;
      }
    }
  }

  const nota = valores.nota ?? "";
  if (nota !== "") candidato.noteText = nota;

  const confianzaBruta = valores.confianza ?? "";
  const verificadoBruto = valores.verificado_en_imagen ?? "";
  const motivosDeDuda: string[] = [];
  if (normalizarTexto(confianzaBruta) !== "alta") {
    motivosDeDuda.push(
      confianzaBruta === "" ? "sin dato de confianza" : `confianza «${confianzaBruta}»`,
    );
  }
  if (normalizarTexto(verificadoBruto) !== "si") motivosDeDuda.push("no verificada en imagen");
  const revision = motivosDeDuda.length > 0 ? "FLAGGED" : "REVIEWED";

  const origen = valores.origen_celda ?? "";
  const pagina = /p[áa]g\.\s*(\d+)/i.exec(origen);
  const paginaOrigen = pagina?.[1] ? Number(pagina[1]) : null;

  const extraccion: ExtraccionCsv = {
    origen: "importación CSV",
    bloque: valores.bloque ?? "",
    origen_celda: origen,
    confianza: confianzaBruta,
    verificado_en_imagen: verificadoBruto,
    fila,
  };

  const validacion = taxCalendarEntryInputSchema.safeParse(candidato);
  if (!validacion.success) {
    for (const issue of validacion.error.issues) {
      const campo = String(issue.path[0] ?? "");
      const columna = COLUMNA_DE_CAMPO[campo];
      if (columna && columnasConError.has(columna)) continue;
      rechazar(columna ?? null, issue.message);
    }
  }
  if (rechazos.length > 0 || !validacion.success) {
    return { celda: null, rechazos };
  }

  if (revision === "FLAGGED") {
    avisos.push({
      fila,
      motivo: `Queda marcada como dudosa (${motivosDeDuda.join("; ")}). Revisala en la grilla antes de publicar.`,
    });
  }
  return {
    celda: { fila, entrada: validacion.data, revision, paginaOrigen, extraccion, avisos },
    rechazos,
  };
}

/**
 * Clave de duplicado: concepto, período de referencia, agrupación y terminaciones (brief 2b-1).
 * El período es el mes de inicio si lo hay, o el texto libre.
 */
export function claveDeCelda(celda: {
  conceptLabel: string;
  groupingKind: string;
  endingDigits?: string | null;
  referencePeriodStart?: string | null;
  referenceLabel?: string | null;
}): string {
  const periodo = celda.referencePeriodStart
    ? `mes:${celda.referencePeriodStart}`
    : `texto:${normalizarTexto(celda.referenceLabel ?? "")}`;
  const terminaciones =
    celda.groupingKind === "ENDING_DIGITS" ? [...(celda.endingDigits ?? "")].sort().join("") : "";
  return [normalizarTexto(celda.conceptLabel), periodo, celda.groupingKind, terminaciones].join(
    "|",
  );
}

/**
 * Mapea todas las filas y aplica los duplicados: contra las celdas que ya tiene el borrador
 * (`existentes`, por clave) y dentro del archivo (la segunda aparición se rechaza).
 * Los avisos solo quedan para las filas que se importan.
 */
export function mapearImportacion(
  lectura: LecturaCsv,
  existentes: ReadonlySet<string>,
): ResultadoImportacion {
  const celdas: CeldaMapeada[] = [];
  const rechazadas: TaxCalendarImportRejection[] = [];
  const avisos: TaxCalendarImportNotice[] = [];
  const vistas = new Map<string, number>();
  for (const fila of lectura.filas) {
    const resultado = mapearFila(fila);
    if (!resultado.celda) {
      rechazadas.push(...resultado.rechazos);
      continue;
    }
    const { celda } = resultado;
    const clave = claveDeCelda({
      conceptLabel: celda.entrada.conceptLabel,
      groupingKind: celda.entrada.groupingKind,
      endingDigits: celda.entrada.endingDigits ?? null,
      referencePeriodStart: celda.entrada.referencePeriodStart ?? null,
      referenceLabel: celda.entrada.referenceLabel ?? null,
    });
    if (existentes.has(clave)) {
      rechazadas.push({
        fila: fila.fila,
        columna: null,
        motivo: "Ya existe en este calendario",
        valorRecibido: null,
      });
      continue;
    }
    const previa = vistas.get(clave);
    if (previa !== undefined) {
      rechazadas.push({
        fila: fila.fila,
        columna: null,
        motivo: `Repetida: la fila ${previa} del archivo tiene el mismo concepto, período, agrupación y dígitos`,
        valorRecibido: null,
      });
      continue;
    }
    vistas.set(clave, fila.fila);
    celdas.push(celda);
    avisos.push(...celda.avisos);
  }
  return { totalFilas: lectura.filas.length, celdas, rechazadas, avisos };
}
