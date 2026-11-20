// Datos sintéticos «Demo» para las pruebas de caracterización del Legajo (K3 a K7).
// CUIT ficticios: ningún dato corresponde a un cliente real.
import type { FiscalBooksSummary } from "../fiscalBooksExport";
import type { CreditLot, EvidenceDocument, FiscalTaxPeriod, TaxRegime, TaxType } from "./tipos";

export const FIRMA_DEMO = "firm-a";
export const CLIENTE_DEMO = "client-a";
export const CUIT_CLIENTE_DEMO = "20999999998";
export const PERIODO_ELEGIDO_DEMO = "period-a";

export const periodoIibbDemo: FiscalTaxPeriod = {
  id: "period-a",
  taxTypeId: "tax-type-a",
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  label: "2026-10",
  taxType: { name: "Ingresos Brutos", isActive: true },
};

export const periodoIvaDemo: FiscalTaxPeriod = {
  id: "period-iva",
  taxTypeId: "tax-type-iva",
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  label: "2026-10",
  taxType: { name: "IVA", isActive: true },
};

export const tiposDemo: TaxType[] = [
  { id: "tax-type-a", code: "IIBB", name: "Ingresos Brutos", isActive: true },
  { id: "tax-type-iva", code: "IVA", name: "IVA", isActive: true },
];

export const regimenesDemo: TaxRegime[] = [
  {
    id: "regime-a",
    name: "IIBB Tucumán",
    isActive: true,
    taxTypeId: "tax-type-a",
    jurisdictionId: "jur-tuc",
    jurisdiction: { name: "Tucumán", isActive: true },
    taxType: { name: "Ingresos Brutos", isActive: true },
  },
];

export const jurisdiccionesDemo = [{ id: "jur-tuc", name: "Tucumán", isActive: true }];

export const documentosDemo: EvidenceDocument[] = [
  {
    id: "doc-a",
    category: "ACUSE",
    status: "READY",
    createdAt: "2026-11-01T00:00:00.000Z",
    fileVersions: [{ originalName: "constancia-demo.pdf" }],
  },
  {
    id: "doc-b",
    category: "RESPALDO",
    status: "REVIEWED",
    createdAt: "2026-11-01T00:00:00.000Z",
    fileVersions: [{ originalName: "respaldo-demo.pdf" }],
  },
];

export const saldoDemo: CreditLot = {
  id: "lot-a",
  taxTypeId: "tax-type-a",
  jurisdictionId: "jur-tuc",
  regimeId: "regime-a",
  periodId: "period-a",
  kind: "SALDO_A_FAVOR",
  originalAmount: "1000.00",
  available: "1000.00",
  evidenceDocumentId: null,
  reference: "Saldo Demo",
  createdBy: { id: "user-demo", name: "Persona Demo" },
  createdAt: "2026-11-01T00:00:00.000Z",
  history: [],
  movements: [],
};

export function legajoDemo(status = "COLLECTING_INPUTS") {
  return {
    id: "wp-a",
    preparedByUserId: null,
    reviewedByUserId: null,
    finalizedByUserId: null,
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    revision: 1,
    status,
    inputHash: null,
    outputHash: null,
    settlements: [],
    controls: [],
  };
}

function fuenteDemo(code: string, label: string) {
  return {
    code,
    label,
    required: true,
    present: false,
    count: 0,
    taxTypeId: "tax-type-iva",
    periodId: "period-iva",
    origin: "ARCA",
    adapterVersion: "IVA_V1",
    expectedColumns: [],
    batches: [],
  };
}

export const fuentesDemo = [
  fuenteDemo("ARCA_IVA_SALES", "ARCA IVA ventas"),
  fuenteDemo("ARCA_IVA_PURCHASES", "ARCA IVA compras"),
];

// Fuente que no es de IVA: su lote se importa con «Importar lote».
export const fuenteRetencionesDemo = {
  code: "RETENCIONES_IIBB_DEMO",
  label: "Retenciones IIBB Demo",
  required: false,
  present: false,
  count: 0,
  taxTypeId: "tax-type-a",
  periodId: "period-a",
  origin: "ARCA",
  adapterVersion: "RET_V1",
  expectedColumns: ["fecha", "comprobante", "importe"],
  batches: [],
};

const coberturaDemo = { components: [], sources: fuentesDemo };

const sinClasificaciones = { total: 0, classified: 0, pending: 0, ready: true, items: [] };
const sinImputaciones = { total: 0, allocated: 0, pending: 0, ready: true, items: [] };

export interface OpcionesDemo {
  periodos?: unknown[];
  legajos?: unknown[];
  saldos?: unknown[];
  documentos?: unknown[];
  posiciones?: unknown[];
  fuentes?: unknown[];
  clasificaciones?: unknown;
  imputaciones?: unknown;
  calculo?: unknown[];
  actividades?: unknown[];
  jurisdicciones?: unknown[];
}

/** Resumen de libros del período para el cajón «Exportar libros»: compras con comprobantes y ventas vacías. */
const totalesVacios = {
  neto: "0",
  iva21: "0",
  iva105: "0",
  iva27: "0",
  exento: "0",
  otrosTributos: "0",
  total: "0",
};

export const resumenLibrosDemo: FiscalBooksSummary = {
  period: {
    id: PERIODO_ELEGIDO_DEMO,
    label: "2026-10",
    startDate: "2026-10-01",
    endDate: "2026-10-31",
  },
  books: {
    purchases: {
      title: "Libro de compras",
      included: {
        count: 3,
        totals: { ...totalesVacios, neto: "1000.00", iva21: "210.00", total: "1210.00" },
      },
      excluded: [{ reason: "DRAFT", label: "Borrador: falta aprobarlo", count: 1 }],
      excludedCount: 1,
    },
    sales: {
      title: "Libro de ventas",
      included: { count: 0, totals: totalesVacios },
      excluded: [],
      excludedCount: 0,
    },
  },
};

/** Respuestas de lectura de la pantalla. Las rutas no previstas devuelven una lista vacía. */
export function rutasDemo(opciones: OpcionesDemo = {}) {
  const periodos = opciones.periodos ?? [periodoIibbDemo, periodoIvaDemo];
  const legajos = opciones.legajos ?? [legajoDemo()];
  const saldos = opciones.saldos ?? [saldoDemo];
  const documentos = opciones.documentos ?? documentosDemo;
  const posiciones = opciones.posiciones ?? [];
  return (path: string): Promise<unknown> => {
    if (path.endsWith("/tax-periods")) return Promise.resolve(periodos);
    if (path.includes("/monthly-tax-workpapers?")) return Promise.resolve(legajos);
    if (path.endsWith("/documents")) return Promise.resolve(documentos);
    if (path.endsWith("/coverage")) {
      return Promise.resolve(
        opciones.fuentes ? { ...coberturaDemo, sources: opciones.fuentes } : coberturaDemo,
      );
    }
    if (path.endsWith("/classifications")) {
      return Promise.resolve(opciones.clasificaciones ?? sinClasificaciones);
    }
    if (path.endsWith("/allocations")) {
      return Promise.resolve(opciones.imputaciones ?? sinImputaciones);
    }
    if (path.endsWith("/calculation")) return Promise.resolve(opciones.calculo ?? []);
    if (path.endsWith("/activities")) return Promise.resolve(opciones.actividades ?? []);
    if (path.endsWith("/tax-credit-ledger")) return Promise.resolve(saldos);
    if (path.includes("/tax-position?")) return Promise.resolve(posiciones);
    if (path === "/tax/types") return Promise.resolve(tiposDemo);
    if (path === "/tax/regimes") return Promise.resolve(regimenesDemo);
    if (path === "/tax/jurisdictions") {
      return Promise.resolve(opciones.jurisdicciones ?? jurisdiccionesDemo);
    }
    if (path.includes("/fiscal-books/summary?")) return Promise.resolve(resumenLibrosDemo);
    if (path.endsWith(`/clients/${CLIENTE_DEMO}`)) {
      return Promise.resolve({ id: CLIENTE_DEMO, cuit: CUIT_CLIENTE_DEMO });
    }
    return Promise.resolve([]);
  };
}
