export interface Workpaper {
  id: string;
  preparedByUserId: string | null;
  reviewedByUserId: string | null;
  finalizedByUserId: string | null;
  periodStart: string;
  periodEnd: string;
  revision: number;
  status: string;
  inputHash: string | null;
  outputHash: string | null;
  settlements: Array<{
    role: string;
    required: boolean;
    settlement: { id: string; status: string; totals: Record<string, string> | null } | null;
  }>;
  controls: Array<{
    id: string;
    code: string;
    severity: string;
    status: string;
    message?: string;
    expected: string | null;
    actual: string | null;
    tolerance: string | null;
    evidenceDocumentId: string | null;
    resolution: string | null;
    resolvedByUserId?: string | null;
    createdAt?: string;
    updatedAt?: string;
  }>;
}

export interface CreditLot {
  id: string;
  taxTypeId: string;
  jurisdictionId: string | null;
  regimeId: string | null;
  periodId: string | null;
  kind: string;
  /** Monto original del saldo (no cambia con las correcciones). */
  originalAmount: string;
  /** Monto vigente: el original con sus correcciones compensatorias. Es el que se ve y se edita. */
  importeVigente?: string;
  available: string;
  evidenceDocumentId: string | null;
  reference: string | null;
  /** Origen del saldo en el libro (la API lo calcula). */
  origin?: "DJ" | "CIERRE" | "MANUAL";
  verificationStatus?: string;
  carryForward?: boolean;
  /** Período del saldo (su mes de origen) y su impuesto. */
  period?: { id: string; label: string | null; startDate: string; endDate: string } | null;
  taxType?: { id: string; code: string; name: string } | null;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  history: Array<{
    id: string;
    createdAt: string;
    changes: Record<string, { from: string | null; to: string | null }>;
    createdBy: { id: string; name: string } | null;
  }>;
  movements: Array<{
    id: string;
    kind: string;
    amount: string;
    reference: string | null;
    createdAt: string;
  }>;
}

export interface TaxPosition {
  obligationId: string;
  status: string;
  dueDate: string | null;
  /** Fecha de la presentación registrada, si ya existe. */
  filedAt?: string | null;
  regime: {
    id: string;
    name: string;
    isActive: boolean;
    taxType: { id: string; name: string; isActive: boolean };
    jurisdiction: { id: string; name: string; isActive: boolean };
  };
  settlement: {
    id: string;
    status: string;
    version: number;
    totals: Record<string, string>;
  } | null;
  accrued: string;
  paid: string;
  pending: string;
  availableCredit: string;
  interest: string;
  totalPayable: string;
  /** Presentación de la liquidación vigente y su declaración jurada (corte 5b-2). La API los entrega; las pantallas actuales no los leen. */
  filingId?: string | null;
  hasAcuse?: boolean;
  hasDeclaration?: boolean;
  declarationDocumentId?: string | null;
  impuestoDeterminado?: string | null;
  saldoFavorTecnico?: string | null;
  saldoLibreDisponibilidad?: string | null;
  totalAPagar?: string | null;
  saldosFavorDetalle?: unknown;
  declaredAt?: string | null;
  periodStatus?: TaxPeriodStatus;
}

/** Estado del período que entrega la API (derivePeriodStatus). La web no lo recalcula. */
export interface TaxPeriodStatus {
  code: "EN_CURSO" | "LEGAJO_FINALIZADO_DJ_PENDIENTE" | "COMPLETO";
  label: string;
  missing: Array<"ACUSE" | "DJ">;
  missingText: string | null;
}

export interface TaxType {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}
export interface TaxRegime {
  id: string;
  name: string;
  isActive: boolean;
  taxTypeId: string;
  jurisdictionId: string;
  jurisdiction: { name: string; isActive: boolean };
  taxType: { name: string; isActive: boolean };
}
export interface FiscalTaxPeriod {
  id: string;
  taxTypeId: string;
  startDate: string;
  endDate: string;
  label: string | null;
  taxType: { name: string; isActive: boolean };
}

export interface EvidenceDocument {
  id: string;
  category: string | null;
  status: string;
  createdAt: string;
  fileVersions?: Array<{ originalName: string }>;
}

interface SifereRate {
  rate: "10.5" | "21" | "27";
  label: string;
  net: string;
  tax: string;
  count: number;
}

interface SifereTax {
  code: string;
  label: string;
  amount: string;
}

export interface SifereAnalysis {
  direction: "SALE" | "PURCHASE";
  sheetName: string;
  totals: {
    importeTotal: string;
    netoGravado: string;
    iva: string;
    noGravado: string;
    exento: string;
  };
  rates: SifereRate[];
  taxes: SifereTax[];
  detailRows: number;
  validRows: number;
  errorRows: number;
  rows: Array<{
    index: number;
    name: string | null;
    rubro: string | null;
    errors: string[];
  }>;
}
interface WorkpaperSourceBatch {
  id: string;
  importBatchId: string;
  fileName: string | null;
  batchStatus: string;
  reviewStatus: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  snapshotHash: string | null;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  reviewedByName?: string | null;
  createdByName?: string | null;
  retiredByUserId?: string | null;
  retiredByName?: string | null;
  retiredAt?: string | null;
  retireReason?: string | null;
  replacedByBatchId?: string | null;
  replacedAt?: string | null;
  createdByUserId: string | null;
  createdAt: string;
}
export interface WorkpaperSource {
  code: string;
  label: string;
  required: boolean;
  present: boolean;
  /** Pendiente, con lote revisado (cargada) o marcada «Sin movimientos» (corte 2A). */
  status: "PENDING" | "LOADED" | "NO_MOVEMENTS";
  noMovements: { byUserId: string; byName: string; at: string } | null;
  count: number;
  taxTypeId: string | null;
  periodId: string | null;
  origin: string;
  adapterVersion: string;
  expectedColumns: string[];
  batches: WorkpaperSourceBatch[];
}
export interface WorkpaperClassification {
  id: string;
  /** Hallazgo de actividad: mismo código y texto que el cálculo; null si no hay. */
  activityIssue?: { kind: "NOT_IN_FORCE" | "UNCLASSIFIED"; message: string } | null;
  voucherId: string;
  direction: "PURCHASE" | "SALE";
  counterpartyCuit: string;
  documentKind: "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE";
  categoryCode: "SUPER" | "TRANSPORTE" | null;
  activityCode: string | null;
  rateBuckets: Array<{ rate: string; base: string; amount: string }>;
  status: "PENDING" | "CLASSIFIED";
  origin: string | null;
  /** Falso en compras con letra B o C: su IVA no es crédito fiscal. */
  ivaCredit?: boolean;
  /** Excluido del cálculo: cuándo, quién y por qué (null si está incluido). */
  excludedAt?: string | null;
  excludedReason?: string | null;
  excludedBy?: { id: string; name: string } | null;
  voucher: {
    type: string;
    letter: string | null;
    pointOfSale: number;
    number: number;
    issuedOn: string;
    total: string;
  };
}
export interface ClassificationCoverage {
  total: number;
  classified: number;
  pending: number;
  excluded?: number;
  /** Ventas clasificadas con actividad que el cálculo no admite (no vigente o de otro nivel). */
  activityPending?: number;
  ready: boolean;
  items: WorkpaperClassification[];
}
/** Regla «recordar»: la contraparte (CUIT) de un cliente queda asignada a un rubro o una actividad. */
export interface ClassificationRule {
  id: string;
  direction: "PURCHASE" | "SALE";
  counterpartyCuit: string;
  categoryCode: "SUPER" | "TRANSPORTE" | null;
  activityCode: string | null;
  createdByName: string;
  createdAt: string;
}
export interface WorkpaperAllocation {
  id: string;
  sourceCode: string | null;
  sourceType: "WITHHOLDING" | "PERCEPTION";
  amount: string;
  status: "ALLOCATED";
  allocatedJurisdiction: { id: string; code: string; name: string; isActive: boolean } | null;
  certificate: {
    cuitAgent: string;
    certificateNumber: string | null;
    creditKind: string;
    issuedOn: string;
    sourceAmount: string;
  } | null;
  obligation: {
    regime: {
      name: string;
      isActive: boolean;
      taxType: { name: string; isActive: boolean };
      jurisdiction: { name: string; isActive: boolean };
    };
    period: { label: string | null; startDate: string; endDate: string };
  } | null;
}
export interface AllocationCoverage {
  total: number;
  allocated: number;
  pending: number;
  ready: boolean;
  items: WorkpaperAllocation[];
}
export interface TaxJurisdiction {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}
export interface WorkpaperCalculationComponent {
  role: string;
  required: boolean;
  obligationId: string;
  /** Perfil habitual: se liquidó en el expediente anterior (o es el primero del cliente). */
  habitual: boolean;
  /** El motor vigente usa el mínimo que ingresa el contador (IIBB Tucumán). */
  usaMinimoDeclarado: boolean;
  /** Último mínimo que usó el cliente en este impuesto, sin contar la liquidación actual. */
  minimoAnterior: { amount: string } | null;
  obligation: {
    regimeCode: string;
    regimeName: string;
    taxTypeCode: string;
    taxTypeName: string;
    jurisdictionName: string;
  };
  settlement: {
    id: string;
    status: string;
    engineVersion: string;
    ruleVersionId: string | null;
    rulesHash: string;
    totals: Record<string, string> | null;
    lines: Array<{
      id: string;
      position: number;
      concept: string;
      formula: string | null;
      inputs: Record<string, unknown> | null;
      amount: string;
    }>;
    differences: Array<{
      id: string;
      severity: "INFO" | "WARNING" | "BLOCKING";
      status: "OPEN" | "RESOLVED" | "WAIVED";
      code: string;
      message: string;
    }>;
    f931Inputs: Array<{
      id: string;
      sourceId: string;
      snapshot: Record<string, unknown>;
    }>;
    /** Mínimo aplicado a esta liquidación: el que ingresó el contador o el de la categoría. */
    minimo: { amount: string; origen: "CAMPO" | "CATEGORIA"; declaredAt: string | null } | null;
  } | null;
}

export interface CoberturaLegajo {
  components: Array<{
    obligationId: string;
    regimeCode: string;
    taxTypeCode: string;
    required: boolean;
    linked: boolean;
    settlementStatus: string | null;
  }>;
  sources: WorkpaperSource[];
  allowSelfReview: boolean;
}
