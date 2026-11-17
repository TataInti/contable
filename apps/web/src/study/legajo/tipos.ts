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
  }>;
}

export interface CreditLot {
  id: string;
  taxTypeId: string;
  jurisdictionId: string | null;
  regimeId: string | null;
  periodId: string | null;
  kind: string;
  originalAmount: string;
  available: string;
  evidenceDocumentId: string | null;
  reference: string | null;
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
  createdByUserId: string | null;
  createdAt: string;
}
export interface WorkpaperSource {
  code: string;
  label: string;
  required: boolean;
  present: boolean;
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
  voucherId: string;
  direction: "PURCHASE" | "SALE";
  counterpartyCuit: string;
  documentKind: "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE";
  categoryCode: "SUPER" | "TRANSPORTE" | null;
  activityCode: string | null;
  rateBuckets: Array<{ rate: string; base: string; amount: string }>;
  status: "PENDING" | "CLASSIFIED";
  origin: string | null;
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
  ready: boolean;
  items: WorkpaperClassification[];
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
  } | null;
}
export type PositionAction = {
  kind: "PAYMENT" | "FILING" | "DECLARATION";
  position: TaxPosition;
} | null;

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
