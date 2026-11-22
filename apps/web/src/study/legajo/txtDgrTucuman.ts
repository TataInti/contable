import { formatCuit } from "../../lib/cuit";

/**
 * Lector de los TXT de «Mis Recaudaciones» de la DGR de Tucumán (formato F611).
 *
 * Función pura: recibe el nombre y el texto del archivo y devuelve filas en la forma que espera el
 * normalizador de retenciones y percepciones (packages/tax-engine), más los errores y avisos por línea.
 *
 *  - per<CUIT>_F611_<ddmmaaaahhmm>.txt   percepciones sufridas, ancho fijo de 108.
 *  - ret<CUIT>_F611_<ddmmaaaahhmm>.txt   retenciones sufridas, ancho fijo de 108.
 *  - reca<CUIT>_F611_<ddmmaaaahhmm>.txt  recaudaciones bancarias, ancho fijo de 57.
 *  - …_F611CM_…                          Convenio Multilateral: se incorpora más adelante.
 *
 * Las posiciones salen de la medición de archivos reales (formatos-tucuman.md, «Verificación de Ciro»);
 * son una lectura respaldada por las muestras, pendiente de confirmar con los contadores.
 * El CUIT del nombre del archivo es el del contribuyente.
 */

export type TipoTxtDgr = "PERCEPCION" | "RETENCION" | "RECAUDACION";

/** Fuente del Legajo a la que va cada tipo de archivo. Hoy las tres comparten una sola fuente de IIBB Tucumán. */
export const CODIGO_FUENTE_IIBB_TUCUMAN = "IIBB_RPI_TUC";
export const FUENTE_DE_TXT_DGR: Readonly<Record<TipoTxtDgr, string>> = {
  PERCEPCION: CODIGO_FUENTE_IIBB_TUCUMAN,
  RETENCION: CODIGO_FUENTE_IIBB_TUCUMAN,
  RECAUDACION: CODIGO_FUENTE_IIBB_TUCUMAN,
};

interface DatosDeTipo {
  prefijo: string;
  /** «Este archivo es de …» */
  nombre: string;
  /** «las de …» */
  plural: string;
  ancho: number;
}

const DATOS_DE_TIPO: Readonly<Record<TipoTxtDgr, DatosDeTipo>> = {
  PERCEPCION: { prefijo: "per", nombre: "percepciones sufridas", plural: "percepciones", ancho: 108 },
  RETENCION: { prefijo: "ret", nombre: "retenciones sufridas", plural: "retenciones", ancho: 108 },
  RECAUDACION: { prefijo: "reca", nombre: "recaudaciones bancarias", plural: "recaudaciones", ancho: 57 },
};

const TIPO_POR_PREFIJO: Readonly<Record<string, TipoTxtDgr>> = {
  per: "PERCEPCION",
  ret: "RETENCION",
  reca: "RECAUDACION",
};

/** Nombre reconocible como TXT de la DGR: prefijo, dígitos y «_F611». Lo demás sigue el camino de siempre. */
const NOMBRE_DGR = /^(per|ret|reca)(\d*)_F611(CM)?_.*\.txt$/i;
/** Forma completa: CUIT de 11 dígitos, fecha y hora; admite la copia « (1)» o «-1» del navegador. */
const NOMBRE_COMPLETO = /^(per|ret|reca)(\d{11})_F611_\d{12}(?:\s*\(\d+\)|-\d+)?\.txt$/i;
const NOMBRE_CM = /^(per|ret|reca)(\d{11})_F611CM_\d{12}(?:\s*\(\d+\)|-\d+)?\.txt$/i;

export function esArchivoTxtDgrTucuman(fileName: string): boolean {
  return NOMBRE_DGR.test(fileName);
}

/** Tipo según el nombre del archivo; null si no es un TXT de la DGR o es de Convenio Multilateral. */
export function tipoDeTxtDgrTucuman(fileName: string): TipoTxtDgr | null {
  const coincidencia = NOMBRE_DGR.exec(fileName);
  if (!coincidencia || coincidencia[3]) return null;
  return TIPO_POR_PREFIJO[coincidencia[1]!.toLowerCase()] ?? null;
}

/**
 * Mensaje si el archivo va en una fuente que no le corresponde; null si la fuente es la correcta o el archivo
 * no es un TXT de la DGR. `fuentes` son las del legajo: con ellas el mensaje nombra la correcta o dice que falta.
 */
export function avisoDeFuenteEquivocada(
  fileName: string,
  fuente: { code: string; label: string },
  fuentes?: readonly { code: string; label: string }[],
): string | null {
  const tipo = tipoDeTxtDgrTucuman(fileName);
  if (!tipo) return null;
  const codigoCorrecto = FUENTE_DE_TXT_DGR[tipo];
  if (fuente.code === codigoCorrecto) return null;
  const correcta = fuentes?.find((candidata) => candidata.code === codigoCorrecto);
  if (fuentes && !correcta) {
    return "Este legajo no tiene la fuente de Ingresos Brutos de Tucumán: habilitá Ingresos Brutos en la Configuración fiscal del cliente.";
  }
  const destino = correcta ? `«${correcta.label}»` : "de Ingresos Brutos de Tucumán";
  return (
    `Este archivo es de ${DATOS_DE_TIPO[tipo].nombre} de Ingresos Brutos de Tucumán y va en la fuente ${destino}, ` +
    `no en «${fuente.label}». Elegí esa fuente y volvé a importar.`
  );
}

export interface OpcionesLecturaTxtDgr {
  /** CUIT del cliente activo (con o sin guiones). Sin él no se compara con el del archivo. */
  clientCuit?: string;
  /** Período de la fuente: las fechas fuera de este rango se avisan. */
  periodo?: { startDate: string; endDate: string };
}

export interface LecturaTxtDgr {
  tipo: TipoTxtDgr | null;
  filas: Record<string, unknown>[];
  /** Impiden la carga; cada uno dice la línea y el motivo. */
  errores: string[];
  /** No impiden la carga. */
  avisos: string[];
}

const soloDigitos = (valor: string) => valor.replace(/\D/g, "");
/** CUIT de 11 dígitos con dígito verificador correcto (módulo 11, pesos 5-4-3-2-7-6-5-4-3-2). */
function cuitValido(valor: string): boolean {
  if (!/^\d{11}$/.test(valor)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acumulado, peso, indice) => acumulado + Number(valor[indice]) * peso, 0);
  const verificador = (11 - (suma % 11)) % 11;
  return verificador === Number(valor[10]);
}
const NUMERO = /^-?\d+(\.\d+)?$/;

/** Convierte partes de calendario a ISO si existen de verdad (31/02 no existe). */
function fechaIso(anio: string, mes: string, dia: string): string | null {
  const a = Number(anio);
  const m = Number(mes);
  const d = Number(dia);
  const fecha = new Date(Date.UTC(a, m - 1, d));
  if (fecha.getUTCFullYear() !== a || fecha.getUTCMonth() !== m - 1 || fecha.getUTCDate() !== d) return null;
  return `${anio}-${mes}-${dia}`;
}

const aDdMmAaaa = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function describirForma(largo: number): string | null {
  if (largo === 57) return "una recaudación bancaria (reca…)";
  if (largo === 108) return "percepciones o retenciones (per… o ret…)";
  return null;
}

function unir(numeros: number[]): string {
  if (numeros.length === 1) return String(numeros[0]);
  return `${numeros.slice(0, -1).join(", ")} y ${numeros[numeros.length - 1]}`;
}

interface FilaLeida {
  linea: number;
  fila: Record<string, unknown>;
  issuedOn: string;
}

function leerLineaPercepcionRetencion(
  linea: string,
  numero: number,
  tipo: "PERCEPCION" | "RETENCION",
  cuitResponsable: string,
  errores: string[],
): FilaLeida | null {
  const antes = errores.length;
  const campo = (desde: number, hasta: number) => linea.slice(desde - 1, hasta);

  const cuitAgente = campo(1, 11);
  if (!/^\d{11}$/.test(cuitAgente) || !cuitValido(cuitAgente)) {
    errores.push(
      `Línea ${numero}: el CUIT del agente ${formatCuit(cuitAgente)} no es válido (dígito verificador).`,
    );
  }

  const textoFecha = campo(62, 71);
  const partesFecha = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(textoFecha);
  const issuedOn = partesFecha ? fechaIso(partesFecha[3]!, partesFecha[2]!, partesFecha[1]!) : null;
  if (!issuedOn) errores.push(`Línea ${numero}: la fecha ${textoFecha.trim()} no existe. Debe ser dd/mm/aaaa.`);

  const codigoTipo = campo(72, 73).trim();
  if (codigoTipo && !/^\d+$/.test(codigoTipo)) {
    errores.push(`Línea ${numero}: el tipo de comprobante «${codigoTipo}» no es numérico.`);
  }
  const letra = campo(75, 75).trim();
  const puntoDeVenta = campo(77, 80).trim();
  if (puntoDeVenta && !/^\d+$/.test(puntoDeVenta)) {
    errores.push(`Línea ${numero}: el punto de venta «${puntoDeVenta}» no es numérico.`);
  }
  const numeroComprobante = campo(81, 87).trim();
  if (numeroComprobante && !/^\d+$/.test(numeroComprobante)) {
    errores.push(`Línea ${numero}: el número de comprobante «${numeroComprobante}» no es numérico.`);
  }

  const importe = campo(99, 105).trim();
  if (!NUMERO.test(importe)) {
    errores.push(`Línea ${numero}: el importe «${importe}» no es un número con punto decimal.`);
  }

  const marca = campo(106, 106);
  const esperada = tipo === "PERCEPCION" ? "P" : "R";
  if (marca !== esperada) {
    const lee = marca === "P" ? "«P» (percepción)" : marca === "R" ? "«R» (retención)" : `«${marca.trim()}»`;
    errores.push(
      `Línea ${numero}: la marca de la posición 106 es ${lee} y este archivo es de ${DATOS_DE_TIPO[tipo].plural}.`,
    );
  }

  if (errores.length > antes || !issuedOn) return null;

  const identificador = letra || codigoTipo;
  const certificateNumber =
    puntoDeVenta || numeroComprobante
      ? `${identificador ? `${identificador} ` : ""}${puntoDeVenta.padStart(4, "0")}-${numeroComprobante.padStart(8, "0")}`
      : null;

  return {
    linea: numero,
    issuedOn,
    fila: {
      kind: tipo,
      cuitResponsable,
      cuitAgente,
      concept: "IIBB",
      amount: importe,
      issuedOn,
      certificateNumber,
      // La DGR no informa la base imponible: solo el importe.
      baseNoInformada: true,
    },
  };
}

function leerLineaRecaudacion(
  linea: string,
  numero: number,
  cuitResponsable: string,
  errores: string[],
): FilaLeida | null {
  const antes = errores.length;
  const campo = (desde: number, hasta: number) => linea.slice(desde - 1, hasta);

  const cuitAgente = campo(1, 11);
  if (!/^\d{11}$/.test(cuitAgente) || !cuitValido(cuitAgente)) {
    errores.push(
      `Línea ${numero}: el CUIT de la entidad ${formatCuit(cuitAgente)} no es válido (dígito verificador).`,
    );
  }

  const textoFecha = campo(12, 19);
  const partesFecha = /^(\d{4})(\d{2})(\d{2})$/.exec(textoFecha);
  const issuedOn = partesFecha ? fechaIso(partesFecha[1]!, partesFecha[2]!, partesFecha[3]!) : null;
  if (!issuedOn) errores.push(`Línea ${numero}: la fecha ${textoFecha.trim()} no existe. Debe ser aaaammdd.`);

  const cuenta = campo(20, 39);
  if (!/^\d{20}$/.test(cuenta)) {
    errores.push(`Línea ${numero}: el identificador de la cuenta (posiciones 20 a 39) debe tener 20 dígitos.`);
  }

  const importe = campo(49, 57).trim();
  if (!NUMERO.test(importe)) {
    errores.push(`Línea ${numero}: el importe «${importe}» no es un número con punto decimal.`);
  }

  if (errores.length > antes || !issuedOn) return null;

  return {
    linea: numero,
    issuedOn,
    fila: {
      // Una recaudación bancaria se carga como retención con su concepto propio: la liquidación la separa por él.
      kind: "RETENCION",
      cuitResponsable,
      cuitAgente,
      concept: "RECAUDACION_BANCARIA",
      amount: importe,
      issuedOn,
      certificateNumber: cuenta,
      baseNoInformada: true,
    },
  };
}

export function leerTxtDgrTucuman(
  fileName: string,
  content: string,
  opciones: OpcionesLecturaTxtDgr = {},
): LecturaTxtDgr {
  const errores: string[] = [];
  const avisos: string[] = [];
  const resultado = (tipo: TipoTxtDgr | null, filas: Record<string, unknown>[] = []): LecturaTxtDgr => ({
    tipo,
    filas: errores.length > 0 ? [] : filas,
    errores,
    avisos: errores.length > 0 ? [] : avisos,
  });

  if (NOMBRE_CM.test(fileName) || /_F611CM_/i.test(fileName)) {
    errores.push(
      "Convenio Multilateral se incorpora más adelante. Este archivo (F611CM) todavía no se puede cargar.",
    );
    return resultado(null);
  }

  const tipo = tipoDeTxtDgrTucuman(fileName);
  if (!tipo) {
    errores.push("El nombre del archivo no corresponde a un TXT de «Mis Recaudaciones».");
    return resultado(null);
  }
  const datos = DATOS_DE_TIPO[tipo];

  const nombre = NOMBRE_COMPLETO.exec(fileName);
  if (!nombre) {
    errores.push(
      `El nombre del archivo debe ser ${datos.prefijo}<CUIT>_F611_<ddmmaaaahhmm>.txt, tal como lo baja «Mis Recaudaciones».`,
    );
  }
  const cuitDelArchivo = nombre?.[2] ?? "";
  if (nombre) {
    if (!cuitValido(cuitDelArchivo)) {
      errores.push(`El CUIT del nombre del archivo (${formatCuit(cuitDelArchivo)}) no es válido.`);
    } else if (opciones.clientCuit) {
      const delCliente = soloDigitos(opciones.clientCuit);
      if (delCliente.length === 11 && delCliente !== cuitDelArchivo) {
        errores.push(
          `Este archivo es del CUIT ${formatCuit(cuitDelArchivo)}, no del cliente (CUIT ${formatCuit(delCliente)}).`,
        );
      }
    }
  }

  const lineas = content
    .replace(/^\uFEFF/, "")
    .split(/\r\n|\n|\r/)
    .map((texto, indice) => ({ texto, numero: indice + 1 }))
    .filter(({ texto }) => texto.trim().length > 0);
  if (lineas.length === 0) {
    errores.push("El archivo no tiene líneas.");
    return resultado(tipo);
  }

  // Forma del archivo: si todas las líneas miden lo mismo y no es el ancho del tipo, se dice de qué forma parecen.
  const largos = new Set(lineas.map(({ texto }) => texto.length));
  const largoUnico = largos.size === 1 ? [...largos][0]! : null;
  const todasDeOtraForma = largoUnico !== null && largoUnico !== datos.ancho;
  if (todasDeOtraForma) {
    const forma = describirForma(largoUnico);
    errores.push(
      forma
        ? `Las líneas miden ${largoUnico} caracteres: tienen la forma de ${forma}, no de ${datos.plural} (${datos.ancho}).`
        : `Las líneas miden ${largoUnico} caracteres y las de ${datos.plural} miden ${datos.ancho}.`,
    );
  }

  const filas: FilaLeida[] = [];
  const vistas = new Map<string, number>();
  if (!todasDeOtraForma) {
    for (const { texto, numero } of lineas) {
      if (texto.length !== datos.ancho) {
        errores.push(`Línea ${numero}: mide ${texto.length} caracteres y las de ${datos.plural} miden ${datos.ancho}.`);
        continue;
      }
      const repetida = vistas.get(texto);
      if (repetida !== undefined) {
        errores.push(`Línea ${numero}: repite la línea ${repetida}.`);
        continue;
      }
      vistas.set(texto, numero);
      const leida =
        tipo === "RECAUDACION"
          ? leerLineaRecaudacion(texto, numero, cuitDelArchivo, errores)
          : leerLineaPercepcionRetencion(texto, numero, tipo, cuitDelArchivo, errores);
      if (leida) filas.push(leida);
    }
  }

  if (opciones.periodo && errores.length === 0) {
    const desde = opciones.periodo.startDate.slice(0, 10);
    const hasta = opciones.periodo.endDate.slice(0, 10);
    const fuera = filas.filter(({ issuedOn }) => issuedOn < desde || issuedOn > hasta).map(({ linea }) => linea);
    if (fuera.length > 0) {
      avisos.push(
        `${fuera.length} ${fuera.length === 1 ? "línea tiene" : "líneas tienen"} fecha fuera del período ` +
          `(${aDdMmAaaa(desde)} al ${aDdMmAaaa(hasta)}): ${fuera.length === 1 ? "línea" : "líneas"} ${unir(fuera)}. ` +
          `${fuera.length === 1 ? "Se carga" : "Se cargan"} igual.`,
      );
    }
  }

  return resultado(
    tipo,
    filas.map(({ fila }) => fila),
  );
}
