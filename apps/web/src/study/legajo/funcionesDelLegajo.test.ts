import { describe, expect, it } from "vitest";
import { calculationDisabledMessage } from "./etiquetas";
import {
  formatMoney,
  hashSourceFile,
  parseSourceFile,
  selfReviewNote,
} from "../StudyExpedienteMensual";

// Datos sintéticos rotulados «Demo»: nombres, usuarios y cifras inventados, sin datos de clientes.

type Parametros = Parameters<typeof calculationDisabledMessage>[0];
type Fuente = NonNullable<Parametros["sources"]>[number];
type Clasificaciones = NonNullable<Parametros["classifications"]>;
type Imputaciones = NonNullable<Parametros["allocations"]>;

const fuenteFaltante = { required: true, present: false } as Fuente;

function clasificacionesPendientes(pending: number): Clasificaciones {
  return { total: pending, classified: 0, pending, ready: pending === 0, items: [] };
}

function imputacionesPendientes(pending: number): Imputaciones {
  return { total: pending, allocated: 0, pending, ready: pending === 0, items: [] };
}

const sinFaltas: Parametros = {
  status: "CALCULATED",
  sources: [],
  classifications: clasificacionesPendientes(0),
  allocations: imputacionesPendientes(0),
  canCalculate: true,
  isPending: false,
};

// Intl usa un espacio no separable entre el signo y la cifra; se compara con espacio normal.
function normalizarEspacios(texto: string): string {
  return texto.replace(/\s/g, " ");
}

describe("calculationDisabledMessage (motivo por el que no se puede calcular)", () => {
  it("indica que el cálculo está en curso, antes que cualquier otra razón", () => {
    expect(calculationDisabledMessage({ ...sinFaltas, isPending: true, canCalculate: false })).toBe(
      "El cálculo está en curso.",
    );
  });

  it("indica la falta de permiso antes que las faltas de datos", () => {
    expect(
      calculationDisabledMessage({ ...sinFaltas, canCalculate: false, sources: [fuenteFaltante] }),
    ).toBe("Tu perfil no tiene permiso para calcular este legajo.");
  });

  it("nombra las fuentes obligatorias sin revisar", () => {
    expect(calculationDisabledMessage({ ...sinFaltas, sources: [fuenteFaltante] })).toBe(
      "Faltan fuentes obligatorias revisadas.",
    );
  });

  it("nombra las clasificaciones pendientes", () => {
    expect(
      calculationDisabledMessage({ ...sinFaltas, classifications: clasificacionesPendientes(2) }),
    ).toBe("Faltan clasificaciones por completar.");
  });

  it("nombra las retenciones o percepciones pendientes de imputar", () => {
    expect(
      calculationDisabledMessage({ ...sinFaltas, allocations: imputacionesPendientes(1) }),
    ).toBe("Faltan retenciones o percepciones por imputar.");
  });

  it("junta las faltas en el orden fuentes, clasificaciones e imputaciones", () => {
    expect(
      calculationDisabledMessage({
        ...sinFaltas,
        sources: [fuenteFaltante],
        classifications: clasificacionesPendientes(2),
        allocations: imputacionesPendientes(1),
      }),
    ).toBe(
      "Faltan fuentes obligatorias revisadas. Faltan clasificaciones por completar. Faltan retenciones o percepciones por imputar.",
    );
  });

  it("en DRAFT y sin faltas, pide revisar las fuentes para iniciar el cálculo", () => {
    expect(calculationDisabledMessage({ ...sinFaltas, status: "DRAFT" })).toBe(
      "Completá y revisá las fuentes obligatorias para iniciar el cálculo.",
    );
  });

  it("en otro estado y sin faltas, pide revisar fuentes, clasificaciones e imputaciones", () => {
    expect(calculationDisabledMessage(sinFaltas)).toBe(
      "Completá y revisá las fuentes, clasificaciones e imputaciones obligatorias.",
    );
  });
});

describe("formatMoney (importes en pesos)", () => {
  it("usa formato argentino con separador de miles y dos decimales", () => {
    expect(normalizarEspacios(formatMoney("1234.5"))).toBe("$ 1.234,50");
  });

  it("muestra cero cuando el valor falta", () => {
    expect(normalizarEspacios(formatMoney(null))).toBe("$ 0,00");
    expect(normalizarEspacios(formatMoney(undefined))).toBe("$ 0,00");
  });
});

describe("selfReviewNote (autorrevisión del legajo)", () => {
  it("no muestra nota si nadie más revisó ni finalizó", () => {
    expect(
      selfReviewNote({
        preparedByUserId: "usuario-demo-1",
        reviewedByUserId: null,
        finalizedByUserId: null,
      }),
    ).toBeNull();
  });

  it("no muestra nota si revisó y finalizó otra persona", () => {
    expect(
      selfReviewNote({
        preparedByUserId: "usuario-demo-1",
        reviewedByUserId: "usuario-demo-2",
        finalizedByUserId: "usuario-demo-3",
      }),
    ).toBeNull();
  });

  it("no muestra nota si el legajo no tiene preparador", () => {
    expect(
      selfReviewNote({
        preparedByUserId: null,
        reviewedByUserId: "usuario-demo-1",
        finalizedByUserId: "usuario-demo-1",
      }),
    ).toBeNull();
  });

  it("avisa si quien preparó también revisó", () => {
    expect(
      selfReviewNote({
        preparedByUserId: "usuario-demo-1",
        reviewedByUserId: "usuario-demo-1",
        finalizedByUserId: null,
      }),
    ).toBe("Legajo revisado por la misma persona que lo preparó.");
  });

  it("avisa si quien preparó también finalizó", () => {
    expect(
      selfReviewNote({
        preparedByUserId: "usuario-demo-1",
        reviewedByUserId: null,
        finalizedByUserId: "usuario-demo-1",
      }),
    ).toBe("Legajo finalizado por la misma persona que lo preparó.");
  });

  it("avisa en una sola nota si quien preparó también revisó y finalizó", () => {
    expect(
      selfReviewNote({
        preparedByUserId: "usuario-demo-1",
        reviewedByUserId: "usuario-demo-1",
        finalizedByUserId: "usuario-demo-1",
      }),
    ).toBe("Legajo revisado y finalizado por la misma persona que lo preparó.");
  });
});

describe("parseSourceFile (lectura de archivos fuente)", () => {
  it("lee un JSON que es un arreglo de filas", () => {
    expect(
      parseSourceFile("demo.json", '[{"Proveedor":"Proveedor Demo","Importe":"100"}]'),
    ).toEqual([{ Proveedor: "Proveedor Demo", Importe: "100" }]);
  });

  it("rechaza un JSON que no es un arreglo de filas", () => {
    expect(() => parseSourceFile("demo.json", '{"Proveedor":"Proveedor Demo"}')).toThrow(
      "El JSON debe contener un arreglo de filas",
    );
    expect(() => parseSourceFile("demo.json", "[1, 2]")).toThrow(
      "El JSON debe contener un arreglo de filas",
    );
  });

  it.each([
    ["punto y coma", "Proveedor;Importe\nProveedor Demo;100"],
    ["tabulación", "Proveedor\tImporte\nProveedor Demo\t100"],
    ["coma", "Proveedor,Importe\nProveedor Demo,100"],
  ])("separa las columnas con %s", (_separador, contenido) => {
    expect(parseSourceFile("demo.csv", contenido)).toEqual([
      { Proveedor: "Proveedor Demo", Importe: "100" },
    ]);
  });

  it("no corta una celda entre comillas aunque tenga el separador", () => {
    expect(parseSourceFile("demo.csv", 'Proveedor;Importe\n"Proveedor; Demo";100')).toEqual([
      { Proveedor: "Proveedor; Demo", Importe: "100" },
    ]);
  });

  it("ignora el BOM al inicio del archivo", () => {
    expect(parseSourceFile("demo.csv", "\uFEFFProveedor;Importe\nProveedor Demo;100")).toEqual([
      { Proveedor: "Proveedor Demo", Importe: "100" },
    ]);
  });

  it("completa con vacío las celdas que faltan en una fila", () => {
    expect(parseSourceFile("demo.csv", "Proveedor;Importe\nProveedor Demo")).toEqual([
      { Proveedor: "Proveedor Demo", Importe: "" },
    ]);
  });

  it("rechaza un encabezado con columnas vacías o duplicadas", () => {
    expect(() => parseSourceFile("demo.csv", "Proveedor;;Importe\nProveedor Demo;x;100")).toThrow(
      "El encabezado contiene columnas vacías o duplicadas",
    );
    expect(() =>
      parseSourceFile("demo.csv", "Proveedor;Proveedor\nProveedor Demo;Proveedor Demo"),
    ).toThrow("El encabezado contiene columnas vacías o duplicadas");
  });

  it("exige encabezado y al menos una fila", () => {
    expect(() => parseSourceFile("demo.csv", "Proveedor;Importe")).toThrow(
      "El archivo debe contener encabezado y al menos una fila",
    );
  });
});

describe("hashSourceFile (huella del archivo)", () => {
  it("devuelve el prefijo sha256: seguido de 64 caracteres hexadecimales", async () => {
    await expect(hashSourceFile("Proveedor Demo;100")).resolves.toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("coincide con el SHA-256 conocido del texto abc", async () => {
    await expect(hashSourceFile("abc")).resolves.toBe(
      "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
