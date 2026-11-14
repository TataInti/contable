import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button, EmptyState, Field, getStatusBadgeMeta, MoneyField, Table, useNotify } from "@contable/design-system";
import { ApiError, api, type Client } from "../lib/api";
import { RECEIPT_ACCEPT, uploadFilingReceipt, waitForReceiptReady } from "./filingReceipt";
import { useClientContext } from "../context/ClientContext";
import { FieldErrorsFromDetails } from "../components/forms/FieldErrorsFromDetails";
import { useSession } from "../session/SessionContext";
import { ActionDrawer } from "../ui/ActionDrawer";
import { StatusBadge } from "../ui/StatusBadge";
import { WorkpaperSourceReviewAction } from "./WorkpaperSourceReviewAction";
import { Icon } from "../ui/Icon";
import {
  DenseHeader,
  DensePage,
  StatStrip,
  useDensity,
} from "../ui/Dense";
import "./study.css";

function WorkpaperActionError({ error }: { error: Error | null | undefined }) {
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!error || !errorRef.current) return;
    errorRef.current.focus({ preventScroll: true });
    errorRef.current.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [error]);

  if (!error) return null;

  return (
    <div className="workpaper-action-error" ref={errorRef} tabIndex={-1}>
      {error instanceof ApiError ? (
        <FieldErrorsFromDetails error={error} />
      ) : (
        <p className="form-error" role="alert">
          {error.message || "No se pudo completar la acción."}
        </p>
      )}
    </div>
  );
}

/**
 * Legajo de liquidación (F1.6, PLAN §4.6).
 *
 * Vista de trabajo mensual para preparador y revisor: densa, legible y
 * trazable. Usa un stepper persistente (no un wizard que oculte información):
 *   saldos → fuentes → clasificación → cálculo → controles → cierre.
 * Cada total permite drill-down hasta la evidencia fuente.
 */

interface Workpaper {
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

interface CreditLot {
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

interface TaxPosition {
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
}

interface TaxType {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}
interface TaxRegime {
  id: string;
  name: string;
  isActive: boolean;
  taxTypeId: string;
  jurisdictionId: string;
  jurisdiction: { name: string; isActive: boolean };
  taxType: { name: string; isActive: boolean };
}
interface FiscalTaxPeriod {
  id: string;
  taxTypeId: string;
  startDate: string;
  endDate: string;
  label: string | null;
  taxType: { name: string; isActive: boolean };
}

function fiscalTaxPeriodLabel(period: FiscalTaxPeriod) {
  return period.label ?? `${period.startDate.slice(0, 10)} a ${period.endDate.slice(0, 10)}`;
}

function fiscalTaxPeriodSelectionKey(firmId: string, clientId: string) {
  return `contable:${firmId}:${clientId}:selected-tax-period`;
}

function readFiscalTaxPeriodSelection(key: string) {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeFiscalTaxPeriodSelection(key: string, periodId: string) {
  if (typeof window === "undefined") return;
  try {
    if (periodId) window.sessionStorage.setItem(key, periodId);
    else window.sessionStorage.removeItem(key);
  } catch {
    // La selección en memoria sigue funcionando si el navegador bloquea storage.
  }
}

interface EvidenceDocument {
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

interface SifereAnalysis {
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
interface WorkpaperSource {
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
interface WorkpaperClassification {
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
interface ClassificationCoverage {
  total: number;
  classified: number;
  pending: number;
  ready: boolean;
  items: WorkpaperClassification[];
}
interface WorkpaperAllocation {
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
interface AllocationCoverage {
  total: number;
  allocated: number;
  pending: number;
  ready: boolean;
  items: WorkpaperAllocation[];
}
interface TaxJurisdiction {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}
interface WorkpaperCalculationComponent {
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
type PositionAction = { kind: "PAYMENT" | "FILING"; position: TaxPosition } | null;

function calculationDisabledMessage({
  status,
  sources,
  classifications,
  allocations,
  canCalculate,
  isPending,
}: {
  status: string;
  sources: WorkpaperSource[] | undefined;
  classifications: ClassificationCoverage | undefined;
  allocations: AllocationCoverage | undefined;
  canCalculate: boolean;
  isPending: boolean;
}): string {
  if (isPending) return "El cálculo está en curso.";
  if (!canCalculate) return "Tu perfil no tiene permiso para calcular este legajo.";

  const missingSources = sources?.some((source) => source.required && !source.present) ?? false;
  const missingClassifications = (classifications?.pending ?? 0) > 0;
  const missingAllocations = (allocations?.pending ?? 0) > 0;
  const reasons = [
    missingSources ? "Faltan fuentes obligatorias revisadas." : null,
    missingClassifications ? "Faltan clasificaciones por completar." : null,
    missingAllocations ? "Faltan retenciones o percepciones por imputar." : null,
  ].filter((reason): reason is string => reason !== null);

  if (reasons.length > 0) return reasons.join(" ");
  if (status === "DRAFT") return "Completá y revisá las fuentes obligatorias para iniciar el cálculo.";
  return "Completá y revisá las fuentes, clasificaciones e imputaciones obligatorias.";
}

const CALCULATION_LABELS: Record<string, string> = {
  BASE_PAIS: "Base país",
  BASE_TOTAL: "Base imponible",
  IMPUESTO_POR_JURISDICCION: "Impuesto determinado",
  IMPUESTO_POR_ACTIVIDAD: "Impuesto por actividad",
  IMPUESTO_DETERMINADO: "Impuesto determinado",
  MINIMO_APLICADO: "Mínimo aplicado",
  DEBITO_FISCAL: "Débito fiscal",
  CREDITO_FISCAL: "Crédito fiscal",
  CREDITO_DTO_814: "Crédito Dto. 814",
  RETENCIONES_SUFRIDAS: "Retenciones",
  PERCEPCIONES_SUFRIDAS: "Percepciones",
  SALDO_TECNICO_ANTERIOR: "Saldo técnico anterior",
  SALDO_LIBRE_ANTERIOR: "Saldo libre anterior",
  SALDO_TECNICO_A_INGRESAR: "Saldo técnico determinado",
  CREDITOS_SEGUNDO_PARRAFO: "Créditos 2.º párrafo",
  RETENCIONES: "Retenciones",
  PERCEPCIONES: "Percepciones",
  RECAUDACIONES: "Recaudaciones bancarias",
  OTROS_CREDITOS: "Otros créditos",
  SALDO_ANTERIOR: "Saldo a favor anterior",
  TOTAL_A_INGRESAR: "Total a ingresar",
  SALDO_A_FAVOR: "Saldo a favor",
  SALDO_TECNICO_AFTER: "Saldo técnico a favor",
  SALDO_LIBRE_AFTER: "Saldo libre a favor",
};

function calculationLabel(concept: string): string | null {
  if (CALCULATION_LABELS[concept]) return CALCULATION_LABELS[concept];
  for (const [prefix, label] of [
    ["SALDO_ANTERIOR_", "Saldo anterior"],
    ["TOTAL_A_INGRESAR_", "A ingresar"],
    ["SALDO_A_FAVOR_", "Saldo a favor"],
  ] as const) {
    if (concept.startsWith(prefix)) {
      return `${label} · ${concept.slice(prefix.length).replaceAll("_", " ")}`;
    }
  }
  return null;
}

const WORKPAPER_STEPS = [
  {
    title: "Saldos",
    description: "Arrastres, créditos y saldos iniciales antes de calcular.",
  },
  {
    title: "Fuentes",
    description: "Documentación y componentes requeridos para sostener el cálculo.",
  },
  {
    title: "Clasificación",
    description: "Actividades, criterios y configuración que determinan alícuotas.",
  },
  {
    title: "Cálculo",
    description: "Posición fiscal, pagos, presentaciones e intereses del período.",
  },
  {
    title: "Controles",
    description: "Hallazgos, bloqueos y resoluciones antes de cerrar.",
  },
  {
    title: "Cierre",
    description: "Hashes, finalización y arrastre al siguiente período.",
  },
] as const;

const CLASSIFICATION_ORIGIN_LABELS: Record<string, string> = {
  MANUAL: "Elegida a mano",
  VOUCHER_LINE: "Tomada del archivo importado",
  SUPPLIER_MASTER: "Tomada del proveedor",
};

const CONTROL_SEVERITY_LABELS: Record<string, string> = {
  BLOCKING: "Bloquea el cierre",
  WARNING: "Advertencia",
  INFO: "Informativo",
};

const CONTROL_LABELS: Record<string, string> = {
  SUPERSEDED_OPENING_CREDIT: "Saldos de presentaciones reemplazadas",
  BOOK_RATE_RECONCILIATION: "Diferencias de libro por alícuota",
  PORTAL_IVA_RECONCILIATION: "Conciliación con Portal IVA",
  BANK_CREDIT_RECONCILIATION: "Acreditaciones bancarias vs. facturación",
  CASH_ALLOCATION_RECONCILIATION: "Caja e imputaciones del período",
};

function formatMoney(value: string | undefined | null): string {
  const num = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(num);
}

/** Una sola nota cuando quien preparó el legajo también lo revisó o lo finalizó. */
function selfReviewNote(wp: {
  preparedByUserId?: string | null;
  reviewedByUserId?: string | null;
  finalizedByUserId?: string | null;
}): string | null {
  if (!wp.preparedByUserId) return null;
  const reviewed = wp.reviewedByUserId === wp.preparedByUserId;
  const finalized = wp.finalizedByUserId === wp.preparedByUserId;
  if (reviewed && finalized) return "Legajo revisado y finalizado por la misma persona que lo preparó.";
  if (reviewed) return "Legajo revisado por la misma persona que lo preparó.";
  if (finalized) return "Legajo finalizado por la misma persona que lo preparó.";
  return null;
}

function formatDate(value: string | null): string {
  if (!value) return "Sin vencimiento";
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC" }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "UTC",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function SifereAnalysisPanel({ analysis }: { analysis: SifereAnalysis }) {
  return (
    <div className="sifere-analysis">
      <div className="sifere-analysis__totals">
        <span>
          <strong>{formatMoney(analysis.totals.importeTotal)}</strong>
          <small>Importe total</small>
        </span>
        <span>
          <strong>{formatMoney(analysis.totals.netoGravado)}</strong>
          <small>Neto gravado</small>
        </span>
        <span>
          <strong>{formatMoney(analysis.totals.iva)}</strong>
          <small>IVA</small>
        </span>
      </div>
      {analysis.rates.length > 0 ? (
        <table className="sifere-analysis__table">
          <thead>
            <tr>
              <th>Alícuota</th>
              <th className="num">Base</th>
              <th className="num">IVA</th>
              <th className="num">Comp.</th>
            </tr>
          </thead>
          <tbody>
            {analysis.rates.map((rate) => (
              <tr key={rate.rate}>
                <td>{rate.label}</td>
                <td className="num">{formatMoney(rate.net)}</td>
                <td className="num">{formatMoney(rate.tax)}</td>
                <td className="num">{rate.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {analysis.taxes.length > 0 ? (
        <div className="sifere-analysis__taxes">
          <small>Tributos asociados</small>
          {analysis.taxes.map((tax) => (
            <span key={tax.code}>
              {tax.label} · <strong>{formatMoney(tax.amount)}</strong>
            </span>
          ))}
        </div>
      ) : null}
      <small className="muted-copy">
        {analysis.detailRows} comprobantes · {analysis.validRows} válidos
        {analysis.errorRows > 0 ? ` · ${analysis.errorRows} con observaciones` : ""}
      </small>
    </div>
  );
}

function parseDelimitedRow(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseSourceFile(fileName: string, content: string): Record<string, unknown>[] {
  if (fileName.toLowerCase().endsWith(".json")) {
    const parsed = JSON.parse(content) as unknown;
    if (!Array.isArray(parsed) || parsed.some((row) => !row || typeof row !== "object")) {
      throw new Error("El JSON debe contener un arreglo de filas");
    }
    return parsed as Record<string, unknown>[];
  }

  const lines = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error("El archivo debe contener encabezado y al menos una fila");
  const delimiter = [";", "\t", ","].sort(
    (left, right) => lines[0]!.split(right).length - lines[0]!.split(left).length,
  )[0]!;
  const headers = parseDelimitedRow(lines[0]!, delimiter);
  if (new Set(headers).size !== headers.length || headers.some((header) => !header)) {
    throw new Error("El encabezado contiene columnas vacías o duplicadas");
  }
  return lines.slice(1).map((line) => {
    const values = parseDelimitedRow(line, delimiter);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

async function hashSourceFile(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

async function fileToHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function StudyExpedienteMensual() {
  const [density] = useDensity();
  const { firmId, clientId, capabilities } = useClientContext();
  const { me } = useSession();
  const currentUserId = me?.userId ?? null;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const taxPeriodStorageKey =
    firmId && clientId ? fiscalTaxPeriodSelectionKey(firmId, clientId) : null;
  const [taxPeriodSelection, setTaxPeriodSelection] = useState<{
    key: string | null;
    id: string;
  }>({ key: null, id: "" });
  const selectedTaxPeriodId =
    taxPeriodSelection.key === taxPeriodStorageKey ? taxPeriodSelection.id : "";
  const [activeStep, setActiveStep] = useState(0);
  const [showOpening, setShowOpening] = useState(false);
  const [opening, setOpening] = useState({
    taxTypeId: "",
    taxPeriodId: "",
    regimeId: "",
    jurisdictionId: "",
    kind: "SALDO_A_FAVOR",
    amount: "",
    evidenceDocumentId: "",
  });
  const [editingLot, setEditingLot] = useState<CreditLot | null>(null);
  const [editForm, setEditForm] = useState({
    reference: "",
    evidenceDocumentId: "",
    originalAmount: "",
  });
  const [controlResolutions, setControlResolutions] = useState<Record<string, string>>({});
  const [controlEvidence, setControlEvidence] = useState<Record<string, string>>({});
  const [positionAction, setPositionAction] = useState<PositionAction>(null);
  const [paymentForm, setPaymentForm] = useState({
    amount: "",
    paidAt: new Date().toISOString().slice(0, 10),
    method: "TRANSFERENCIA",
    reference: "",
  });
  const [filingForm, setFilingForm] = useState({
    amountFiled: "",
    filedAt: new Date().toISOString().slice(0, 10),
    externalId: "",
    evidenceDocumentId: "",
  });
  const [filingReceipt, setFilingReceipt] = useState<File | null>(null);
  const [sourceCode, setSourceCode] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [classificationDrafts, setClassificationDrafts] = useState<
    Record<string, { categoryCode: string; activityCode: string }>
  >({});
  const [allocationDrafts, setAllocationDrafts] = useState<Record<string, string>>({});
  const [showSifereModal, setShowSifereModal] = useState(false);
  const [sifereFiles, setSifereFiles] = useState<{
    sales: File | null;
    purchases: File | null;
  }>({ sales: null, purchases: null });
  const [sifereAnalysis, setSifereAnalysis] = useState<{
    sales: SifereAnalysis | null;
    purchases: SifereAnalysis | null;
  }>({ sales: null, purchases: null });
  const notify = useNotify();

  const taxPeriodsQuery = useQuery({
    queryKey: ["tax-periods", firmId, clientId],
    queryFn: () => api.get<FiscalTaxPeriod[]>(`/firms/${firmId}/clients/${clientId}/tax-periods`),
    enabled: Boolean(firmId && clientId),
  });
  const selectableTaxPeriods = (taxPeriodsQuery.data ?? []).filter(
    (taxPeriod) => taxPeriod.taxType.isActive,
  );
  const selectedTaxPeriod =
    taxPeriodSelection.key === taxPeriodStorageKey
      ? selectableTaxPeriods.find((taxPeriod) => taxPeriod.id === selectedTaxPeriodId)
      : undefined;

  useEffect(() => {
    if (taxPeriodSelection.key !== taxPeriodStorageKey) {
      setTaxPeriodSelection({
        key: taxPeriodStorageKey,
        id: taxPeriodStorageKey ? readFiscalTaxPeriodSelection(taxPeriodStorageKey) : "",
      });
      return;
    }
    if (!taxPeriodStorageKey || !taxPeriodsQuery.data) return;

    const availablePeriods = taxPeriodsQuery.data.filter((taxPeriod) => taxPeriod.taxType.isActive);
    const nextId = availablePeriods.some((taxPeriod) => taxPeriod.id === taxPeriodSelection.id)
      ? taxPeriodSelection.id
      : (availablePeriods[0]?.id ?? "");
    if (nextId !== taxPeriodSelection.id) {
      setTaxPeriodSelection({ key: taxPeriodStorageKey, id: nextId });
    }
    writeFiscalTaxPeriodSelection(taxPeriodStorageKey, nextId);
  }, [taxPeriodSelection, taxPeriodStorageKey, taxPeriodsQuery.data]);

  const listQuery = useQuery({
    queryKey: ["monthly-workpapers", firmId, clientId, selectedTaxPeriod?.id],
    queryFn: () => {
      if (!selectedTaxPeriod) throw new Error("Seleccioná un período fiscal");
      const from = encodeURIComponent(selectedTaxPeriod.startDate.slice(0, 10));
      const to = encodeURIComponent(selectedTaxPeriod.endDate.slice(0, 10));
      return api.get<Workpaper[]>(
        `/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers?from=${from}&to=${to}`,
      );
    },
    enabled: Boolean(firmId && clientId && selectedTaxPeriod),
  });

  const activeWorkpaperId = listQuery.data?.[0]?.id;
  const coverageQuery = useQuery({
    queryKey: ["monthly-workpaper-coverage", firmId, clientId, activeWorkpaperId],
    queryFn: () =>
      api.get<{
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
      }>(
        `/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${activeWorkpaperId}/coverage`,
      ),
    enabled: Boolean(firmId && clientId && activeWorkpaperId),
  });
  const clientQuery = useQuery({
    queryKey: ["client", firmId, clientId],
    queryFn: () => api.get<Client>(`/firms/${firmId}/clients/${clientId}`),
    enabled: Boolean(firmId && clientId),
  });
  const classificationQuery = useQuery({
    queryKey: ["monthly-workpaper-classifications", firmId, clientId, activeWorkpaperId],
    queryFn: () =>
      api.get<ClassificationCoverage>(
        `/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${activeWorkpaperId}/classifications`,
      ),
    enabled: Boolean(firmId && clientId && activeWorkpaperId),
  });
  const allocationQuery = useQuery({
    queryKey: ["monthly-workpaper-allocations", firmId, clientId, activeWorkpaperId],
    queryFn: () =>
      api.get<AllocationCoverage>(
        `/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${activeWorkpaperId}/allocations`,
      ),
    enabled: Boolean(firmId && clientId && activeWorkpaperId),
  });
  const calculationQuery = useQuery({
    queryKey: ["monthly-workpaper-calculation", firmId, clientId, activeWorkpaperId],
    queryFn: () =>
      api.get<WorkpaperCalculationComponent[]>(
        `/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${activeWorkpaperId}/calculation`,
      ),
    enabled: Boolean(firmId && clientId && activeWorkpaperId),
  });
  const jurisdictionsQuery = useQuery({
    queryKey: ["tax-jurisdictions"],
    queryFn: () => api.get<TaxJurisdiction[]>("/tax/jurisdictions"),
    enabled: Boolean(firmId),
  });
  const ledgerQuery = useQuery({
    queryKey: ["tax-credit-ledger", firmId, clientId],
    queryFn: () => api.get<CreditLot[]>(`/firms/${firmId}/clients/${clientId}/tax-credit-ledger`),
    enabled: Boolean(firmId && clientId),
  });
  // El legajo es por mes y hay un período fiscal por impuesto: la posición reúne
  // todos los períodos del mismo mes, para que cada impuesto tenga su fila.
  const monthTaxPeriodIds = selectedTaxPeriod
    ? (taxPeriodsQuery.data ?? [])
        .filter(
          (taxPeriod) =>
            taxPeriod.startDate.slice(0, 10) === selectedTaxPeriod.startDate.slice(0, 10) &&
            taxPeriod.endDate.slice(0, 10) === selectedTaxPeriod.endDate.slice(0, 10),
        )
        .map((taxPeriod) => taxPeriod.id)
        .sort()
    : [];
  const positionQuery = useQuery({
    queryKey: ["tax-position", firmId, clientId, monthTaxPeriodIds.join(",")],
    queryFn: async () => {
      if (!selectedTaxPeriod) throw new Error("Seleccioná un período fiscal");
      const positions = await Promise.all(
        monthTaxPeriodIds.map((periodId) =>
          api.get<TaxPosition[]>(
            `/firms/${firmId}/clients/${clientId}/tax-position?periodId=${encodeURIComponent(periodId)}`,
          ),
        ),
      );
      return positions.flat();
    },
    enabled: Boolean(firmId && clientId && selectedTaxPeriod && monthTaxPeriodIds.length > 0),
  });
  const taxTypesQuery = useQuery({
    queryKey: ["tax-types"],
    queryFn: () => api.get<TaxType[]>("/tax/types"),
    enabled: Boolean(firmId),
  });
  const regimesQuery = useQuery({
    queryKey: ["tax-regimes"],
    queryFn: () => api.get<TaxRegime[]>("/tax/regimes"),
    enabled: Boolean(firmId),
  });
  // Actividades vigentes del cliente: la clasificación se elige de esta lista, no se escribe.
  const clientActivitiesQuery = useQuery({
    queryKey: ["client-tax-activities", firmId, clientId],
    queryFn: () =>
      api.get<Array<{ validTo: string | null; activity: { code: string; name: string } }>>(
        `/firms/${firmId}/clients/${clientId}/activities`,
      ),
    enabled: Boolean(firmId && clientId),
  });
  const activityOptions = (currentCode: string) => {
    const options = (clientActivitiesQuery.data ?? [])
      .filter((link) => !link.validTo)
      .map((link) => ({ code: link.activity.code, name: link.activity.name }));
    // Un código ya guardado que no está entre las vigentes se conserva como opción.
    if (currentCode && !options.some((option) => option.code === currentCode)) {
      options.unshift({ code: currentCode, name: "" });
    }
    return options;
  };
  const documentsQuery = useQuery({
    queryKey: ["documents", firmId, clientId],
    queryFn: () => api.get<EvidenceDocument[]>(`/firms/${firmId}/clients/${clientId}/documents`),
    enabled: Boolean(firmId && clientId),
  });

  const createMutation = useMutation({
    mutationFn: () => {
      if (!selectedTaxPeriod) throw new Error("Seleccioná un período fiscal");
      return api.post(`/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers`, {
        periodStart: selectedTaxPeriod.startDate.slice(0, 10),
        periodEnd: selectedTaxPeriod.endDate.slice(0, 10),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
    },
  });

  const analyzeSifereMutation = useMutation({
    mutationFn: async ({ direction, file }: { direction: "SALE" | "PURCHASE"; file: File }) => {
      const base64 = await fileToBase64(file);
      return api.post<SifereAnalysis>(
        `/firms/${firmId}/clients/${clientId}/sifere/analyze`,
        { direction, base64 },
      );
    },
    onSuccess: (data, variables) => {
      setSifereAnalysis((current) => ({
        ...current,
        [variables.direction === "SALE" ? "sales" : "purchases"]: data,
      }));
    },
  });

  const importSifereMutation = useMutation({
    mutationFn: async ({ direction, file }: { direction: "SALE" | "PURCHASE"; file: File }) => {
      const source = coverageQuery.data?.sources.find((item) =>
        direction === "SALE" ? item.code === "ARCA_IVA_SALES" : item.code === "ARCA_IVA_PURCHASES",
      );
      if (!source?.taxTypeId || !source?.periodId || !clientQuery.data) {
        throw new Error("La fuente no tiene una obligación fiscal materializada");
      }
      const base64 = await fileToBase64(file);
      const fileHash = await fileToHash(file);
      return api.post<{
        analysis: SifereAnalysis;
        batch: { id: string; status: string; committed: number; duplicates: number };
      }>(
        `/firms/${firmId}/clients/${clientId}/sifere/import`,
        {
          direction,
          base64,
          fileName: file.name,
          fileHash,
          taxTypeId: source.taxTypeId,
          periodId: source.periodId,
          clientCuit: clientQuery.data.cuit,
          ...(activeWorkpaperId ? { workpaperId: activeWorkpaperId } : {}),
        },
      );
    },
    onSuccess: (data) => {
      setShowSifereModal(false);
      setSifereFiles({ sales: null, purchases: null });
      setSifereAnalysis({ sales: null, purchases: null });
      notify.success(
        `Se importaron ${data.batch.committed} comprobante(s) de ${data.analysis.direction === "SALE" ? "ventas" : "compras"} (${data.analysis.sheetName}). Quedaron asociados al cliente y al período activo.`,
      );
      void queryClient.invalidateQueries({
        queryKey: ["monthly-workpaper-coverage", firmId, clientId],
      });
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
    },
  });

  const calculateMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${id}/calculate`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
      void queryClient.invalidateQueries({
        queryKey: ["monthly-workpaper-coverage", firmId, clientId],
      });
      void queryClient.invalidateQueries({ queryKey: ["tax-position", firmId, clientId] });
      void queryClient.invalidateQueries({ queryKey: ["tax-settlements", firmId, clientId] });
      void queryClient.invalidateQueries({
        queryKey: ["monthly-workpaper-calculation", firmId, clientId],
      });
    },
  });

  const sourceUploadMutation = useMutation({
    mutationFn: async () => {
      const source = coverageQuery.data?.sources.find((item) => item.code === sourceCode);
      if (!source || !sourceFile || !activeWorkpaperId || !clientQuery.data) {
        throw new Error("Seleccioná una fuente y un archivo antes de importar");
      }
      if (!source.taxTypeId || !source.periodId) {
        throw new Error("La fuente no tiene una obligación fiscal materializada");
      }

      const content = await sourceFile.text();
      const rows = parseSourceFile(sourceFile.name, content);
      if (rows.length > 20_000) throw new Error("El lote supera el máximo de 20.000 filas");
      const fileHash = await hashSourceFile(content);
      const batch = await api.post<{
        id: string;
        status: string;
        errorRows: number;
      }>(`/firms/${firmId}/clients/${clientId}/import-batches`, {
        origin: source.origin,
        taxTypeId: source.taxTypeId,
        periodId: source.periodId,
        adapterVersion: source.adapterVersion,
        fileName: sourceFile.name,
        fileHash,
        workpaperId: activeWorkpaperId,
        sourceCode: source.code,
      });

      let status = batch.status;
      let errorRows = batch.errorRows;
      if (status === "UPLOADED") {
        const validation = await api.post<{ totals: { errorRows: number } }>(
          `/firms/${firmId}/clients/${clientId}/import-batches/${batch.id}/validate`,
          { rows },
        );
        status = "VALIDATED";
        errorRows = validation.totals.errorRows;
      }
      if (errorRows > 0) {
        throw new Error(
          `El lote quedó validado con ${errorRows} fila(s) observadas. Corregí el archivo antes de reimportar.`,
        );
      }
      if (status === "VALIDATED") {
        await api.post(`/firms/${firmId}/clients/${clientId}/import-batches/${batch.id}/commit`, {
          clientCuit: clientQuery.data.cuit,
        });
      }
    },
    onSuccess: () => {
      setSourceFile(null);
      void queryClient.invalidateQueries({
        queryKey: ["monthly-workpaper-coverage", firmId, clientId],
      });
    },
  });

  const reviewSourceMutation = useMutation({
    mutationFn: (sourceLinkId: string) =>
      api.post(
        `/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${activeWorkpaperId}/sources/${sourceLinkId}/review`,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["monthly-workpaper-coverage", firmId, clientId],
      });
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
      void queryClient.invalidateQueries({
        queryKey: ["monthly-workpaper-classifications", firmId, clientId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["monthly-workpaper-allocations", firmId, clientId],
      });
    },
  });

  const classifyVoucherMutation = useMutation({
    mutationFn: (classification: WorkpaperClassification) => {
      const draft = classificationDrafts[classification.id] ?? {
        categoryCode: classification.categoryCode ?? "",
        activityCode: classification.activityCode ?? "",
      };
      if (classification.direction === "PURCHASE" && !draft.categoryCode) {
        throw new Error("Seleccioná el rubro de la compra");
      }
      if (classification.direction === "SALE" && !draft.activityCode.trim()) {
        throw new Error("Indicá la actividad fiscal de la venta");
      }
      return api.patch(
        `/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${activeWorkpaperId}/classifications/${classification.id}`,
        {
          ...(classification.direction === "PURCHASE"
            ? {
                categoryCode: draft.categoryCode,
                ...(draft.activityCode.trim() ? { activityCode: draft.activityCode.trim() } : {}),
                saveSupplierProfile: true,
              }
            : { activityCode: draft.activityCode.trim() }),
        },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["monthly-workpaper-classifications", firmId, clientId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["monthly-workpaper-coverage", firmId, clientId],
      });
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
    },
  });

  const reallocateInputMutation = useMutation({
    mutationFn: (allocation: WorkpaperAllocation) => {
      const jurisdiction =
        allocationDrafts[allocation.id] ?? allocation.allocatedJurisdiction?.code ?? "";
      if (!jurisdiction) throw new Error("Seleccioná una jurisdicción para la imputación");
      return api.patch(
        `/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${activeWorkpaperId}/allocations/${allocation.id}`,
        { jurisdiction },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["monthly-workpaper-allocations", firmId, clientId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["monthly-workpaper-coverage", firmId, clientId],
      });
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
    },
  });

  const submitMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${id}/submit-review`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) =>
      api.post(`/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${id}/review`, {
        approved,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${id}/finalize`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
    },
  });
  const rectifyMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${id}/rectify`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
    },
  });
  const resolveControlMutation = useMutation({
    mutationFn: ({
      workpaperId,
      findingId,
      status,
      evidenceDocumentId,
    }: {
      workpaperId: string;
      findingId: string;
      status: "RESOLVED" | "WAIVED";
      evidenceDocumentId?: string;
    }) =>
      api.post(
        `/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${workpaperId}/controls/${findingId}/resolve`,
        {
          resolution: controlResolutions[findingId]?.trim(),
          status,
          ...(evidenceDocumentId ? { evidenceDocumentId } : {}),
        },
      ),
    onSuccess: (_, variables) => {
      setControlResolutions((values) => ({ ...values, [variables.findingId]: "" }));
      setControlEvidence((values) => ({ ...values, [variables.findingId]: "" }));
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
      void queryClient.invalidateQueries({
        queryKey: ["monthly-workpaper-coverage", firmId, clientId],
      });
    },
  });
  const calculateInterestMutation = useMutation({
    mutationFn: ({
      workpaperId,
      obligationId,
    }: {
      workpaperId: string;
      obligationId: string;
    }) =>
      api.post(
        `/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${workpaperId}/interest-snapshots`,
        {
          obligationId,
          asOfDate: new Date().toISOString().slice(0, 10),
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["tax-position", firmId, clientId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["monthly-workpapers", firmId, clientId],
      });
    },
  });
  const recordPaymentMutation = useMutation({
    mutationFn: () =>
      api.post(
        `/firms/${firmId}/clients/${clientId}/tax-obligations/${positionAction?.position.obligationId}/payments`,
        {
          ...(positionAction?.position.settlement
            ? { settlementId: positionAction.position.settlement.id }
            : {}),
          paidAt: paymentForm.paidAt,
          amount: paymentForm.amount,
          method: paymentForm.method,
          ...(paymentForm.reference.trim() ? { reference: paymentForm.reference.trim() } : {}),
        },
      ),
    onSuccess: () => {
      setPositionAction(null);
      setPaymentForm({
        amount: "",
        paidAt: new Date().toISOString().slice(0, 10),
        method: "TRANSFERENCIA",
        reference: "",
      });
      void queryClient.invalidateQueries({
        queryKey: ["tax-position", firmId, clientId],
      });
    },
  });
  const recordFilingMutation = useMutation({
    mutationFn: async () => {
      const base = `/firms/${firmId}/clients/${clientId}`;
      // La constancia es obligatoria: se elige una ya subida o se sube en este mismo paso.
      let evidenceDocumentId = filingForm.evidenceDocumentId;
      if (!evidenceDocumentId) {
        if (!filingReceipt) throw new Error("Adjuntá la constancia de presentación.");
        evidenceDocumentId = await uploadFilingReceipt(base, filingReceipt);
        setFilingForm((form) => ({ ...form, evidenceDocumentId }));
        setFilingReceipt(null);
        await queryClient.invalidateQueries({ queryKey: ["documents", firmId, clientId] });
        await waitForReceiptReady(base, evidenceDocumentId);
      }
      return api.post(
        `${base}/tax-obligations/${positionAction?.position.obligationId}/filings`,
        {
          settlementId: positionAction?.position.settlement?.id,
          filedAt: filingForm.filedAt,
          amountFiled: filingForm.amountFiled,
          ...(filingForm.externalId.trim() ? { externalId: filingForm.externalId.trim() } : {}),
          evidenceDocumentId,
        },
      );
    },
    onSuccess: () => {
      notify.success("Presentación registrada con su constancia.");
      setFilingReceipt(null);
      setPositionAction(null);
      setFilingForm({
        amountFiled: "",
        filedAt: new Date().toISOString().slice(0, 10),
        externalId: "",
        evidenceDocumentId: "",
      });
      void queryClient.invalidateQueries({
        queryKey: ["tax-position", firmId, clientId],
      });
    },
  });

  const openingMutation = useMutation({
    mutationFn: () =>
      api.post(`/firms/${firmId}/clients/${clientId}/tax-credit-ledger/opening`, {
        taxTypeId: opening.taxTypeId,
        ...(opening.regimeId ? { regimeId: opening.regimeId } : {}),
        ...(opening.jurisdictionId ? { jurisdictionId: opening.jurisdictionId } : {}),
        periodId: opening.taxPeriodId,
        kind: opening.kind,
        amount: opening.amount,
        ...(opening.evidenceDocumentId ? { evidenceDocumentId: opening.evidenceDocumentId } : {}),
      }),
    onSuccess: () => {
      setShowOpening(false);
      setOpening({
        taxTypeId: "",
        taxPeriodId: "",
        regimeId: "",
        jurisdictionId: "",
        kind: "SALDO_A_FAVOR",
        amount: "",
        evidenceDocumentId: "",
      });
      void queryClient.invalidateQueries({ queryKey: ["tax-credit-ledger", firmId, clientId] });
      void queryClient.invalidateQueries({
        queryKey: ["tax-position", firmId, clientId],
      });
    },
  });

  const editLotMutation = useMutation({
    mutationFn: () => {
      if (!editingLot) throw new Error("No hay registro seleccionado");
      const payload: Record<string, unknown> = {
        reference: editForm.reference || null,
        evidenceDocumentId: editForm.evidenceDocumentId || null,
      };
      if (editForm.originalAmount) {
        payload.originalAmount = editForm.originalAmount;
      }
      return api.patch(
        `/firms/${firmId}/clients/${clientId}/tax-credit-ledger/${editingLot.id}`,
        payload,
      );
    },
    onSuccess: () => {
      setEditingLot(null);
      setEditForm({ reference: "", evidenceDocumentId: "", originalAmount: "" });
      void queryClient.invalidateQueries({ queryKey: ["tax-credit-ledger", firmId, clientId] });
    },
  });

  if (!firmId || !clientId) {
    return (
      <div className="study-page">
        <EmptyState
          title="Elegí un cliente"
          description="El legajo se organiza dentro de un cliente explícito."
        />
      </div>
    );
  }

  const workpapers = listQuery.data ?? [];
  const openingRegimes = (regimesQuery.data ?? []).filter(
    (regime) => regime.isActive && (!opening.taxTypeId || regime.taxTypeId === opening.taxTypeId),
  );
  const openingTaxPeriods = (taxPeriodsQuery.data ?? []).filter(
    (taxPeriod) => taxPeriod.taxType.isActive && (!opening.taxTypeId || taxPeriod.taxTypeId === opening.taxTypeId),
  );
  const safeActiveStep = Math.min(Math.max(activeStep, 0), WORKPAPER_STEPS.length - 1);
  // Constancias ya subidas (por el estudio o por el cliente desde el portal) y listas para usar.
  const filingReceiptDocuments = (documentsQuery.data ?? []).filter(
    (document) => document.category === "ACUSE" && ["READY", "APPLIED"].includes(document.status),
  );
  const eligibleEvidenceDocuments = (documentsQuery.data ?? []).filter((document) =>
    ["READY", "APPLIED", "REVIEWED"].includes(document.status),
  );
  const activeStepMeta = WORKPAPER_STEPS[safeActiveStep]!;
  const previousStep = WORKPAPER_STEPS[safeActiveStep - 1];
  const nextStep = WORKPAPER_STEPS[safeActiveStep + 1];
  const goToStep = (index: number) =>
    setActiveStep(Math.min(Math.max(index, 0), WORKPAPER_STEPS.length - 1));
  const goToPreviousStep = () => setActiveStep((value) => Math.max(value - 1, 0));
  const goToNextStep = () =>
    setActiveStep((value) => Math.min(value + 1, WORKPAPER_STEPS.length - 1));

  return (
    <DensePage density={density} flow>
      <DenseHeader
        title="Legajo"
        description="Coordina IVA, IIBB y TEM del período con evidencia trazable."
        actions={
          <>
          <Button
            variant="secondary"
            disabled={!capabilities.has("tax.vouchers.prepare")}
            onClick={() => setShowSifereModal(true)}
          >
            <Icon name="upload" size={16} />
            Subir Excel
          </Button>
          <Button
            variant="primary"
            disabled={!selectedTaxPeriod || createMutation.isPending || !capabilities.has("tax.settlements.calculate")}
            onClick={() => void createMutation.mutate()}
          >
            <Icon name="plus" size={16} />
            Nuevo legajo
          </Button>
          <WorkpaperActionError error={createMutation.error} />
        
          </>
        }
      />

      {taxPeriodsQuery.isLoading ? (
        <div className="study-state" role="status">
          Cargando períodos fiscales…
        </div>
      ) : taxPeriodsQuery.isError ? (
        <EmptyState
          title="No se pudieron cargar los períodos fiscales"
          description="Reintentá la consulta para volver a cargar los períodos del cliente."
          action={
            <Button variant="secondary" onClick={() => void taxPeriodsQuery.refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : selectableTaxPeriods.length ? (
        <section className="study-page__section" aria-label="Período fiscal">
          <div className="ds-field">
            <label className="ds-field__label" htmlFor="monthly-workpaper-tax-period">
              Período fiscal
            </label>
            <select
              id="monthly-workpaper-tax-period"
              className="ds-field__input"
              value={selectedTaxPeriodId}
              onChange={(event) => {
                const id = event.target.value;
                setTaxPeriodSelection({ key: taxPeriodStorageKey, id });
                if (taxPeriodStorageKey) {
                  writeFiscalTaxPeriodSelection(taxPeriodStorageKey, id);
                }
              }}
            >
              <option value="">Seleccioná un período fiscal…</option>
              {selectableTaxPeriods.map((taxPeriod) => (
                <option key={taxPeriod.id} value={taxPeriod.id}>
                  {taxPeriod.taxType.name} · {fiscalTaxPeriodLabel(taxPeriod)}
                </option>
              ))}
            </select>
          </div>
        </section>
      ) : (
        <EmptyState
          title="Configurá un período fiscal"
          description="El legajo organiza las obligaciones del mes seleccionado."
          action={
            <Button variant="secondary" onClick={() => navigate("/configuracion-fiscal")}>
              Abrir configuración fiscal
            </Button>
          }
        />
      )}

      <StatStrip
        label="Estado del legajo"
        items={[
          { key: "workpapers", label: "Legajos", value: workpapers.length },
          { key: "step", label: "Etapa actual", value: activeStepMeta.title },
          { key: "components", label: "Componentes", value: coverageQuery.data?.components.length ?? "—" },
        ]}
      />



      <ActionDrawer
        isOpen={showSifereModal}
        onClose={() => setShowSifereModal(false)}
        title="Subir libros IVA (Excel)"
        description="Subí por separado el libro de compras y el de ventas. El análisis de alícuotas y tributos no depende de que esté completo: lo podés correr con lo que ya tengas."
        size="wide"
      >
        <div className="sifere-upload">
          {(["SALE", "PURCHASE"] as const).map((direction) => {
            const file = direction === "SALE" ? sifereFiles.sales : sifereFiles.purchases;
            const analysis = direction === "SALE" ? sifereAnalysis.sales : sifereAnalysis.purchases;
            const isAnalyzing = analyzeSifereMutation.isPending && analyzeSifereMutation.variables?.direction === direction;
            const isImporting = importSifereMutation.isPending && importSifereMutation.variables?.direction === direction;
            return (
              <section className="sifere-upload__side" key={direction}>
                <h3>{direction === "SALE" ? "Ventas" : "Compras"}</h3>
                <div className="sifere-upload__actions">
                  <a
                    className="ds-button ds-button--sm ds-button--ghost"
                    href={`/api/v1/firms/${firmId}/clients/${clientId}/sifere/template?direction=${direction}`}
                    download
                  >
                    Modelo .xlsx
                  </a>
                  <label className="sifere-upload__file">
                    <input
                      type="file"
                      accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      onChange={(event) => {
                        const selected = event.target.files?.[0] ?? null;
                        setSifereFiles((current) => ({
                          ...current,
                          [direction === "SALE" ? "sales" : "purchases"]: selected,
                        }));
                        setSifereAnalysis((current) => ({
                          ...current,
                          [direction === "SALE" ? "sales" : "purchases"]: null,
                        }));
                      }}
                    />
                    <span>{file ? file.name : "Elegí el .xlsx del libro"}</span>
                  </label>
                </div>
                <div className="sifere-upload__actions">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!file || isAnalyzing}
                    loading={isAnalyzing}
                    onClick={() => {
                      if (file) {
                        analyzeSifereMutation.mutate({ direction, file });
                      }
                    }}
                  >
                    Analizar alícuotas
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!file || !analysis || isImporting || !activeWorkpaperId}
                    loading={isImporting}
                    onClick={() => {
                      if (file) {
                        importSifereMutation.mutate({ direction, file });
                      }
                    }}
                  >
                    Importar
                  </Button>
                </div>
                <WorkpaperActionError
                  error={
                    analyzeSifereMutation.variables?.direction === direction
                      ? analyzeSifereMutation.error
                      : null
                  }
                />
                <WorkpaperActionError
                  error={
                    importSifereMutation.variables?.direction === direction
                      ? importSifereMutation.error
                      : null
                  }
                />
                {analysis ? <SifereAnalysisPanel analysis={analysis} /> : null}
              </section>
            );
          })}
        </div>
      </ActionDrawer>

      <ActionDrawer
        isOpen={showOpening}
        onClose={() => setShowOpening(false)}
        title="Cargar saldo inicial"
        description="Registrá un saldo a favor o arrastre. Podés adjuntar un respaldo documental o cargarlo manualmente; en ambos casos queda registrado el usuario que lo hizo."
        size="wide"
      >
        <form
          className="opening-credit-form"
          onSubmit={(event) => {
            event.preventDefault();
            openingMutation.mutate();
          }}
        >
          <div className="ds-field">
            <label className="ds-field__label" htmlFor="opening-tax-type">
              Impuesto
            </label>
            <select
              id="opening-tax-type"
              className="ds-field__input"
              value={opening.taxTypeId}
              onChange={(event) =>
                setOpening((value) => ({
                  ...value,
                  taxTypeId: event.target.value,
                  taxPeriodId: "",
                  regimeId: "",
                  jurisdictionId: "",
                  kind:
                    event.target.value &&
                    taxTypesQuery.data?.find((type) => type.id === event.target.value)?.code ===
                      "IVA"
                      ? "IVA_LIBRE"
                      : "SALDO_A_FAVOR",
                }))
              }
              required
            >
              <option value="">Seleccioná…</option>
              {(taxTypesQuery.data ?? []).filter((type) => type.isActive).map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </div>
          <div className="ds-field">
            <label className="ds-field__label" htmlFor="opening-tax-period">
              Período fiscal
            </label>
            <select
              id="opening-tax-period"
              className="ds-field__input"
              value={opening.taxPeriodId}
              onChange={(event) =>
                setOpening((value) => ({ ...value, taxPeriodId: event.target.value }))
              }
              required
              disabled={!opening.taxTypeId}
            >
              <option value="">Seleccioná…</option>
              {openingTaxPeriods.map((taxPeriod) => (
                <option key={taxPeriod.id} value={taxPeriod.id}>
                  {taxPeriod.label ??
                    `${taxPeriod.startDate.slice(0, 10)} a ${taxPeriod.endDate.slice(0, 10)}`}
                </option>
              ))}
            </select>
          </div>
          <div className="ds-field">
            <label className="ds-field__label" htmlFor="opening-regime">
              Régimen
            </label>
            <select
              id="opening-regime"
              className="ds-field__input"
              value={opening.regimeId}
              onChange={(event) => {
                const regime = openingRegimes.find((item) => item.id === event.target.value);
                setOpening((value) => ({
                  ...value,
                  regimeId: event.target.value,
                  jurisdictionId: regime?.jurisdictionId ?? "",
                }));
              }}
            >
              <option value="">Sin régimen específico</option>
              {openingRegimes.map((regime) => (
                <option key={regime.id} value={regime.id}>
                  {regime.name} · {regime.jurisdiction.name}
                </option>
              ))}
            </select>
          </div>
          <div className="ds-field">
            <label className="ds-field__label" htmlFor="opening-kind">
              Naturaleza
            </label>
            <select
              id="opening-kind"
              className="ds-field__input"
              value={opening.kind}
              onChange={(event) => setOpening((value) => ({ ...value, kind: event.target.value }))}
            >
              <option value="SALDO_A_FAVOR">Saldo a favor</option>
              {taxTypesQuery.data?.find((type) => type.id === opening.taxTypeId)?.code === "IVA" ? (
                <>
                  <option value="IVA_TECNICO">IVA · saldo técnico</option>
                  <option value="IVA_LIBRE">IVA · libre disponibilidad</option>
                </>
              ) : null}
            </select>
          </div>
          <MoneyField
            label="Importe"
            id="opening-amount"
            value={opening.amount}
            onChange={(value) => setOpening((state) => ({ ...state, amount: value }))}
            required
          />
          <div className="ds-field">
            <label className="ds-field__label" htmlFor="opening-evidence">
              Documento de respaldo
            </label>
            <select
              id="opening-evidence"
              className="ds-field__input"
              value={opening.evidenceDocumentId}
              onChange={(event) =>
                setOpening((value) => ({ ...value, evidenceDocumentId: event.target.value }))
              }
            >
              <option value="">Sin documento (carga manual)</option>
              {documentsQuery.data?.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.fileVersions?.[0]?.originalName ?? document.category ?? "Documento"}
                </option>
              ))}
            </select>
          </div>
          <div className="opening-credit-form__actions">
            <Button
              type="submit"
              loading={openingMutation.isPending}
              disabled={!opening.taxTypeId || !opening.taxPeriodId || !opening.amount}
            >
              Registrar saldo
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowOpening(false)}>
              Cancelar
            </Button>
          </div>
          <WorkpaperActionError error={openingMutation.error} />
        </form>
      </ActionDrawer>

      <ActionDrawer
        isOpen={editingLot !== null}
        onClose={() => setEditingLot(null)}
        title="Editar saldo"
        description="Actualizá el monto, la referencia o el documento de respaldo del saldo. Cada cambio queda registrado en el log con usuario y fecha."
        size="wide"
      >
        {editingLot ? (
          <form
            className="opening-credit-form"
            onSubmit={(event) => {
              event.preventDefault();
              editLotMutation.mutate();
            }}
          >
            <div className="ds-field">
              <label className="ds-field__label">Saldo</label>
              <p className="muted-copy">
                <strong>{editingLot.kind.replaceAll("_", " ")}</strong> ·{" "}
                {formatMoney(editingLot.originalAmount)}
              </p>
            </div>
            <Field
              label="Monto original"
              id="edit-lot-amount"
              type="number"
              step="0.01"
              value={editForm.originalAmount}
              onChange={(event) =>
                setEditForm((form) => ({ ...form, originalAmount: event.target.value }))
              }
              placeholder="0,00"
            />
            <Field
              label="Referencia"
              id="edit-lot-reference"
              value={editForm.reference}
              onChange={(event) =>
                setEditForm((form) => ({ ...form, reference: event.target.value }))
              }
              placeholder="Opcional"
            />
            <div className="ds-field">
              <label className="ds-field__label" htmlFor="edit-lot-evidence">
                Documento de respaldo
              </label>
              <select
                id="edit-lot-evidence"
                className="ds-field__input"
                value={editForm.evidenceDocumentId}
                onChange={(event) =>
                  setEditForm((form) => ({ ...form, evidenceDocumentId: event.target.value }))
                }
              >
                <option value="">Sin documento (carga manual)</option>
                {documentsQuery.data?.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.fileVersions?.[0]?.originalName ?? document.category ?? "Documento"}
                  </option>
                ))}
              </select>
            </div>
            <WorkpaperActionError error={editLotMutation.error} />
            <div className="opening-credit-form__actions">
              <Button type="submit" loading={editLotMutation.isPending}>
                Guardar cambios
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditingLot(null)}>
                Cancelar
              </Button>
            </div>
          </form>
        ) : null}
      </ActionDrawer>

      <ActionDrawer
        isOpen={positionAction?.kind === "PAYMENT"}
        onClose={() => setPositionAction(null)}
        title={
          positionAction?.kind === "PAYMENT"
            ? `Registrar pago · ${positionAction.position.regime.taxType.name}`
            : "Registrar pago"
        }
        description="El pago se registrará de forma manual y actualizará el saldo pendiente."
      >
        {positionAction?.kind === "PAYMENT" ? (
          <form
            className="study-form study-form--compact fiscal-action-form"
            onSubmit={(event) => {
              event.preventDefault();
              recordPaymentMutation.mutate();
            }}
          >
            <MoneyField
              label="Importe"
              id="tax-payment-amount"
              value={paymentForm.amount}
              onChange={(value) => setPaymentForm({ ...paymentForm, amount: value })}
              required
            />
            <Field
              label="Fecha de pago"
              id="tax-payment-date"
              type="date"
              value={paymentForm.paidAt}
              onChange={(event) => setPaymentForm({ ...paymentForm, paidAt: event.target.value })}
              required
            />
            <div className="ds-field">
              <label className="ds-field__label" htmlFor="tax-payment-method">
                Medio
              </label>
              <select
                id="tax-payment-method"
                className="ds-field__input"
                value={paymentForm.method}
                onChange={(event) => setPaymentForm({ ...paymentForm, method: event.target.value })}
              >
                <option value="TRANSFERENCIA">Transferencia</option>
                <option value="VEP">VEP</option>
                <option value="EFECTIVO">Efectivo</option>
                <option value="OTRO">Otro</option>
              </select>
            </div>
            <Field
              label="Referencia"
              id="tax-payment-reference"
              value={paymentForm.reference}
              onChange={(event) =>
                setPaymentForm({ ...paymentForm, reference: event.target.value })
              }
              placeholder="Opcional"
            />
            <div className="study-form__actions">
              <Button
                type="submit"
                loading={recordPaymentMutation.isPending}
                disabled={!paymentForm.amount}
              >
                Registrar pago
              </Button>
              <Button type="button" variant="ghost" onClick={() => setPositionAction(null)}>
                Cancelar
              </Button>
            </div>
            <WorkpaperActionError error={recordPaymentMutation.error} />
          </form>
        ) : null}
      </ActionDrawer>

      <ActionDrawer
        isOpen={positionAction?.kind === "FILING"}
        onClose={() => setPositionAction(null)}
        title={
          positionAction?.kind === "FILING"
            ? `Registrar presentación · ${positionAction.position.regime.taxType.name}`
            : "Registrar presentación"
        }
        description="Cargá los datos de la presentación y adjuntá la constancia que emite el organismo."
        size="wide"
      >
        {positionAction?.kind === "FILING" ? (
          <form
            className="study-form study-form--compact fiscal-action-form"
            onSubmit={(event) => {
              event.preventDefault();
              recordFilingMutation.mutate();
            }}
          >
            <MoneyField
              label="Importe presentado"
              id="tax-filing-amount"
              value={filingForm.amountFiled}
              onChange={(value) => setFilingForm({ ...filingForm, amountFiled: value })}
              required
            />
            <Field
              label="Fecha de presentación"
              id="tax-filing-date"
              type="date"
              value={filingForm.filedAt}
              onChange={(event) => setFilingForm({ ...filingForm, filedAt: event.target.value })}
              required
            />
            <Field
              label="Identificador externo"
              id="tax-filing-external-id"
              value={filingForm.externalId}
              onChange={(event) => setFilingForm({ ...filingForm, externalId: event.target.value })}
              placeholder="Opcional"
            />
            <div className="ds-field fiscal-action-form__wide">
              <label className="ds-field__label" htmlFor="tax-filing-evidence">
                Constancia de presentación
              </label>
              <select
                id="tax-filing-evidence"
                className="ds-field__input"
                value={filingForm.evidenceDocumentId}
                onChange={(event) =>
                  setFilingForm({ ...filingForm, evidenceDocumentId: event.target.value })
                }
              >
                <option value="">Subir una constancia nueva</option>
                {filingReceiptDocuments.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.fileVersions?.[0]?.originalName ?? "Constancia"} ·{" "}
                    {getStatusBadgeMeta(document.status).label}
                  </option>
                ))}
              </select>
              <small className="ds-field__hint">
                Es el comprobante que emite el organismo. Sin constancia la presentación no queda registrada.
              </small>
            </div>
            {!filingForm.evidenceDocumentId ? (
              <div className="ds-field fiscal-action-form__wide">
                <label className="ds-field__label" htmlFor="tax-filing-receipt">
                  Archivo de la constancia
                </label>
                <input
                  id="tax-filing-receipt"
                  className="ds-field__input"
                  type="file"
                  accept={RECEIPT_ACCEPT}
                  required
                  onChange={(event) => setFilingReceipt(event.target.files?.[0] ?? null)}
                />
                <small className="ds-field__hint">PDF o imagen.</small>
              </div>
            ) : null}
            <div className="study-form__actions">
              <Button
                type="submit"
                loading={recordFilingMutation.isPending}
                loadingLabel="Subiendo y validando la constancia"
                disabled={
                  !positionAction.position.settlement ||
                  !filingForm.amountFiled ||
                  (!filingForm.evidenceDocumentId && !filingReceipt)
                }
              >
                Registrar presentación
              </Button>
              <Button type="button" variant="ghost" onClick={() => setPositionAction(null)}>
                Cancelar
              </Button>
            </div>
            <WorkpaperActionError error={recordFilingMutation.error} />
          </form>
        ) : null}
      </ActionDrawer>

      {listQuery.isLoading ? (
        <div className="study-page__state" role="status">
          Cargando legajos…
        </div>
      ) : listQuery.isError ? (
        <div className="study-page__state" role="alert">
          No se pudieron cargar los legajos. Reintentá en un momento.
        </div>
      ) : !selectedTaxPeriod ? (
        <EmptyState
          title="Elegí un período fiscal"
          description="Seleccioná un período fiscal para consultar o crear el legajo del mes."
        />
      ) : workpapers.length === 0 ? (
        <EmptyState
          title="Sin legajos para este período"
          description="Creá un legajo para coordinar las liquidaciones del período."
          action={
            capabilities.has("tax.settlements.calculate") ? (
              <Button onClick={() => createMutation.mutate()} loading={createMutation.isPending}>
                Crear legajo
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="workpaper-list">
          {workpapers.map((wp) => {
            const blocking = wp.controls.filter(
              (c) => c.severity === "BLOCKING" && c.status === "OPEN",
            );
            const canEditSources = [
              "DRAFT",
              "COLLECTING_INPUTS",
              "READY_TO_CALCULATE",
              "CHANGES_REQUESTED",
            ].includes(wp.status);
            const canCalculate = capabilities.has("tax.settlements.calculate");
            const calculateDisabled =
              calculateMutation.isPending ||
              wp.status !== "READY_TO_CALCULATE" ||
              !canCalculate;
            const calculateDisabledReason = calculateDisabled
              ? calculationDisabledMessage({
                  status: wp.status,
                  sources: coverageQuery.data?.sources,
                  classifications: classificationQuery.data,
                  allocations: allocationQuery.data,
                  canCalculate,
                  isPending: calculateMutation.isPending,
                })
              : null;
            const selfReviewBlocked = Boolean(
              currentUserId &&
              wp.preparedByUserId === currentUserId &&
              coverageQuery.data &&
              !coverageQuery.data.allowSelfReview &&
              ((wp.status === "IN_REVIEW" && capabilities.has("tax.settlements.review")) ||
                (wp.status === "REVIEWED" && capabilities.has("tax.settlements.finalize"))),
            );
            return (
              <article className="workpaper-card" key={wp.id}>
                <div className="workpaper-card__header">
                  <div>
                    <h2>
                      {wp.periodStart.slice(0, 7)} · Revisión {wp.revision}
                    </h2>
                    <StatusBadge status={wp.status} />
                    {selfReviewNote(wp) ? (
                      <small className="muted-copy" role="status">
                        {selfReviewNote(wp)}
                      </small>
                    ) : null}
                  </div>
                  {blocking.length > 0 ? (
                    <span className="workpaper-card__blocking" role="alert">
                      {blocking.length} control(es) bloqueante(s)
                    </span>
                  ) : null}
                </div>

                <div className="workpaper-process" aria-label="Navegación del legajo">
                  <div className="workpaper-process__current">
                    <span className="workpaper-process__index">
                      Etapa {safeActiveStep + 1} de {WORKPAPER_STEPS.length}
                    </span>
                    <h3>{activeStepMeta.title}</h3>
                    <p>{activeStepMeta.description}</p>
                  </div>
                  <div className="workpaper-process__controls">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!previousStep}
                      onClick={goToPreviousStep}
                    >
                      {previousStep ? `Anterior: ${previousStep.title}` : "Anterior"}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!nextStep}
                      onClick={goToNextStep}
                    >
                      {nextStep ? `Siguiente: ${nextStep.title}` : "Siguiente"}
                    </Button>
                  </div>
                  <div
                    className="workpaper-process__menu"
                    role="tablist"
                    aria-label="Menú completo del legajo"
                  >
                    {WORKPAPER_STEPS.map((step, index) => (
                      <button
                        key={step.title}
                        type="button"
                        role="tab"
                        aria-selected={safeActiveStep === index}
                        aria-controls={`workpaper-${wp.id}-stage`}
                        className={`workpaper-step${safeActiveStep === index ? " workpaper-step--active" : ""}`}
                        onClick={() => goToStep(index)}
                      >
                        <span className="workpaper-step__number">{index + 1}</span>
                        <span>{step.title}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div
                  className="workpaper-card__body"
                  id={`workpaper-${wp.id}-stage`}
                  role="tabpanel"
                  aria-live="polite"
                >
                  {safeActiveStep === 0 ? (
                    <div className="workpaper-stage">
                      <div className="workpaper-stage__heading">
                        <div>
                          <strong>Saldos a favor y arrastres</strong>
                          <small>
                            Disponibles por impuesto, régimen y jurisdicción. Cada saldo conserva su
                            respaldo.
                          </small>
                        </div>
                        <span className="workpaper-stage__actions">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void ledgerQuery.refetch()}
                          >
                            Actualizar
                          </Button>
                          {capabilities.has("tax.settlements.calculate") ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setShowOpening((visible) => !visible)}
                            >
                              <Icon name="plus" size={15} /> Cargar saldo inicial
                            </Button>
                          ) : null}
                        </span>
                      </div>
                      {ledgerQuery.isLoading ? (
                        <p className="muted-copy">Cargando saldos…</p>
                      ) : (
                        <Table<CreditLot>
                          rows={ledgerQuery.data ?? []}
                          rowKey={(lot) => lot.id}
                          empty="No hay saldos a favor disponibles para este cliente."
                          columns={[
                            {
                              key: "kind",
                              header: "Saldo",
                              render: (lot) => (
                                <>
                                  <strong>{lot.kind.replaceAll("_", " ")}</strong>
                                  <br />
                                  <small>{lot.movements.length} movimiento(s)</small>
                                </>
                              ),
                            },
                            {
                              key: "scope",
                              header: "Alcance",
                              render: (lot) => (lot.regimeId ? "Régimen específico" : "Impuesto"),
                            },
                            {
                              key: "original",
                              header: "Original",
                              align: "right",
                              render: (lot) => formatMoney(lot.originalAmount),
                            },
                            {
                              key: "available",
                              header: "Disponible",
                              align: "right",
                              render: (lot) => <strong>{formatMoney(lot.available)}</strong>,
                            },
                            {
                              key: "movements",
                              header: "Movimientos",
                              render: (lot) =>
                                lot.movements.length === 0 ? (
                                  "Sin aplicaciones"
                                ) : (
                                  <details className="workpaper-credit-movements">
                                    <summary>{lot.movements.length} movimiento(s)</summary>
                                    <ul>
                                      {lot.movements.map((movement) => (
                                        <li key={movement.id}>
                                          <span>{movement.kind.replaceAll("_", " ")}</span>
                                          <strong>{formatMoney(movement.amount)}</strong>
                                          {movement.reference ? <small>{movement.reference}</small> : null}
                                        </li>
                                      ))}
                                    </ul>
                                  </details>
                                ),
                            },
                            {
                              key: "evidence",
                              header: "Respaldo",
                              render: (lot) =>
                                lot.reference ??
                                (lot.evidenceDocumentId
                                  ? "Documentado"
                                  : lot.createdBy
                                    ? `Carga manual · ${lot.createdBy.name}`
                                    : "Cierre de liquidación"),
                            },
                            {
                              key: "log",
                              header: "Log",
                              render: (lot) =>
                                !lot.history || lot.history.length === 0 ? (
                                  <span className="muted-copy">Sin cambios</span>
                                ) : (
                                  <details className="workpaper-credit-log">
                                    <summary>{lot.history.length} cambio(s)</summary>
                                    <ul>
                                      {lot.history.map((entry) => (
                                        <li key={entry.id}>
                                          <span>
                                            {entry.createdBy?.name ?? "Usuario"} ·{" "}
                                            {formatDateTime(entry.createdAt)}
                                          </span>
                                          <ul className="workpaper-credit-log__changes">
                                            {Object.entries(entry.changes ?? {}).map(
                                              ([field, diff]) => (
                                                <li key={field}>
                                                  <strong>{field}</strong>:{" "}
                                                  {diff?.from ?? "—"} → {diff?.to ?? "—"}
                                                </li>
                                              ),
                                            )}
                                          </ul>
                                        </li>
                                      ))}
                                    </ul>
                                  </details>
                                ),
                            },
                            {
                              key: "actions",
                              header: "",
                              align: "right",
                              render: (lot) =>
                                capabilities.has("tax.settlements.calculate") ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      setEditingLot(lot);
                                      setEditForm({
                                        reference: lot.reference ?? "",
                                        evidenceDocumentId: lot.evidenceDocumentId ?? "",
                                        originalAmount: lot.originalAmount ?? "",
                                      });
                                    }}
                                  >
                                    Editar
                                  </Button>
                                ) : null,
                            },
                          ]}
                        />
                      )}
                    </div>
                  ) : safeActiveStep === 1 ? (
                    <div className="workpaper-stage">
                      <div className="workpaper-stage__heading">
                        <div>
                          <strong>Cobertura de fuentes</strong>
                          <small>
                            El legajo declara qué llegó y qué todavía bloquea el cálculo.
                          </small>
                        </div>
                        <span className="workpaper-stage__actions">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void coverageQuery.refetch()}
                          >
                            Actualizar
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => navigate("/bandeja")}
                          >
                            Ir a bandeja
                          </Button>
                        </span>
                      </div>
                      {coverageQuery.isLoading ? (
                        <p className="muted-copy">Verificando cobertura…</p>
                      ) : (
                        <>
                          {canEditSources &&
                          capabilities.has("tax.vouchers.prepare") &&
                          (coverageQuery.data?.sources.length ?? 0) > 0 ? (
                            <div className="workpaper-source-import">
                              <label>
                                <span>Fuente</span>
                                <select
                                  value={sourceCode}
                                  onChange={(event) => {
                                    setSourceCode(event.target.value);
                                    setSourceFile(null);
                                  }}
                                >
                                  <option value="">Seleccionar…</option>
                                  {(coverageQuery.data?.sources ?? []).map((source) => (
                                    <option key={source.code} value={source.code}>
                                      {source.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                <span>Archivo CSV, TXT o JSON</span>
                                <input
                                  type="file"
                                  accept=".csv,.txt,.json,text/csv,text/plain,application/json"
                                  onChange={(event) =>
                                    setSourceFile(event.target.files?.[0] ?? null)
                                  }
                                />
                              </label>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={
                                  !sourceCode || !sourceFile || sourceUploadMutation.isPending
                                }
                                onClick={() => sourceUploadMutation.mutate()}
                              >
                                {sourceUploadMutation.isPending ? "Procesando…" : "Importar lote"}
                              </Button>
                              <WorkpaperActionError error={sourceUploadMutation.error} />
                              {sourceCode ? (
                                <small>
                                  Columnas esperadas: {coverageQuery.data?.sources
                                    .find((source) => source.code === sourceCode)
                                    ?.expectedColumns.join(", ")}
                                </small>
                              ) : null}
                            </div>
                          ) : null}
                          <Table
                            rows={coverageQuery.data?.sources ?? []}
                            rowKey={(source) => source.code}
                            empty="No hay fuentes definidas para el legajo."
                            columns={[
                              {
                                key: "source",
                                header: "Fuente",
                                render: (source) => (
                                  <>
                                    <strong>{source.label}</strong>
                                    <br />
                                    <small>{source.code}</small>
                                  </>
                                ),
                              },
                              {
                                key: "records",
                                header: "Registros",
                                align: "right",
                                render: (source) => source.count,
                              },
                              {
                                key: "required",
                                header: "Tipo",
                                render: (source) => (source.required ? "Obligatoria" : "Opcional"),
                              },
                              {
                                key: "batches",
                                header: "Lotes",
                                render: (source) =>
                                  source.batches.length === 0 ? (
                                    "Sin lotes"
                                  ) : (
                                    <div className="workpaper-source-batches">
                                      {source.batches.map((batch) => (
                                        <div key={batch.id}>
                                          <span>
                                            {batch.fileName ?? "Lote sin nombre"} · {batch.validRows}/
                                            {batch.totalRows} filas
                                          </span>
                                          <StatusBadge
                                            status={
                                              batch.reviewStatus === "REVIEWED"
                                                ? "READY"
                                                : batch.batchStatus
                                            }
                                          />
                                          <WorkpaperSourceReviewAction
                                            batch={batch}
                                            currentUserId={currentUserId}
                                            allowSelfReview={coverageQuery.data?.allowSelfReview === true}
                                            canEditSources={canEditSources}
                                            canReview={capabilities.has("tax.vouchers.review")}
                                            pending={reviewSourceMutation.isPending}
                                            error={
                                              reviewSourceMutation.variables === batch.id
                                                ? reviewSourceMutation.error
                                                : null
                                            }
                                            onReview={(sourceLinkId) =>
                                              reviewSourceMutation.mutate(sourceLinkId)
                                            }
                                          />
                                        </div>
                                      ))}
                                    </div>
                                  ),
                              },
                              {
                                key: "state",
                                header: "Estado",
                                render: (source) => (
                                  <StatusBadge
                                    status={
                                      source.present
                                        ? "READY"
                                        : source.required
                                          ? "WAITING_INPUTS"
                                          : "PENDING"
                                    }
                                  />
                                ),
                              },
                            ]}
                          />
                          {coverageQuery.data?.sources.some(
                            (source) => source.required && !source.present && source.count === 0,
                          ) ? (
                            <p className="workpaper-stage__note" role="status">
                              La cobertura cuenta solo lotes revisados. Los lotes pendientes de
                              revisión mantienen el conteo en 0 registros.
                            </p>
                          ) : null}
                          <WorkpaperActionError
                            error={
                              coverageQuery.data?.sources.some((source) =>
                                source.batches.some(
                                  (batch) => batch.id === reviewSourceMutation.variables,
                                ),
                              )
                                ? reviewSourceMutation.error
                                : null
                            }
                          />
                          <Table
                            rows={coverageQuery.data?.components ?? []}
                            rowKey={(component) => component.obligationId}
                            empty="No hay obligaciones vinculadas."
                            columns={[
                              {
                                key: "regime",
                                header: "Componente",
                                render: (component) =>
                                  `${component.taxTypeCode} · ${component.regimeCode}`,
                              },
                              {
                                key: "required",
                                header: "Requerido",
                                render: (component) => (component.required ? "Sí" : "No"),
                              },
                              {
                                key: "state",
                                header: "Liquidación",
                                render: (component) =>
                                  component.settlementStatus ? (
                                    <StatusBadge status={component.settlementStatus} />
                                  ) : (
                                    "Sin liquidación calculada"
                                  ),
                              },
                            ]}
                          />
                        </>
                      )}
                    </div>
                  ) : safeActiveStep === 2 ? (
                    <div className="workpaper-stage">
                      <div className="workpaper-stage__heading">
                        <div>
                          <strong>Clasificación</strong>
                          <small>
                            Las actividades adheridas determinan la alícuota aplicable. Completá las
                            que falten antes de calcular.
                          </small>
                        </div>
                        <span className="workpaper-stage__actions">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void classificationQuery.refetch()}
                          >
                            Actualizar clasificación
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => navigate("/configuracion-fiscal")}
                          >
                            Ver configuración fiscal
                          </Button>
                        </span>
                      </div>
                      {classificationQuery.isLoading ? (
                        <p className="muted-copy">Clasificando comprobantes respaldados…</p>
                      ) : (
                        <>
                          <div className="workpaper-classification-summary">
                            <span>
                              <strong>{classificationQuery.data?.classified ?? 0}</strong>
                              <small>Clasificados</small>
                            </span>
                            <span>
                              <strong>{classificationQuery.data?.pending ?? 0}</strong>
                              <small>Pendientes</small>
                            </span>
                            <span>
                              <StatusBadge
                                status={classificationQuery.data?.ready ? "READY" : "WAITING_INPUTS"}
                              />
                              <small>Listo para calcular</small>
                            </span>
                          </div>
                          <Table<WorkpaperClassification>
                            rows={classificationQuery.data?.items ?? []}
                            rowKey={(classification) => classification.id}
                            empty="No hay comprobantes de fuentes revisadas para clasificar."
                            columns={[
                              {
                                key: "voucher",
                                header: "Comprobante",
                                render: (classification) => (
                                  <>
                                    <strong>
                                      {classification.voucher.letter ?? classification.voucher.type} · {String(
                                        classification.voucher.pointOfSale,
                                      ).padStart(4, "0")}-{String(
                                        classification.voucher.number,
                                      ).padStart(8, "0")}
                                    </strong>
                                    <br />
                                    <small>
                                      {classification.direction === "PURCHASE" ? "Compra" : "Venta"} · {classification.counterpartyCuit}
                                    </small>
                                  </>
                                ),
                              },
                              {
                                key: "treatment",
                                header: "Tratamiento",
                                render: (classification) => (
                                  <>
                                    {classification.documentKind === "CREDIT_NOTE"
                                      ? "Nota de crédito (resta)"
                                      : classification.documentKind === "DEBIT_NOTE"
                                        ? "Nota de débito"
                                        : "Factura"}
                                    <br />
                                    <small>
                                      {classification.rateBuckets.length > 0
                                        ? classification.rateBuckets
                                            .map((bucket) => `${bucket.rate}%: ${formatMoney(bucket.amount)}`)
                                            .join(" · ")
                                        : "Sin componentes por alícuota"}
                                    </small>
                                  </>
                                ),
                              },
                              {
                                key: "classification",
                                header: "Rubro / actividad",
                                render: (classification) => {
                                  const draft = classificationDrafts[classification.id] ?? {
                                    categoryCode: classification.categoryCode ?? "",
                                    activityCode: classification.activityCode ?? "",
                                  };
                                  return !canEditSources ||
                                    !capabilities.has("tax.vouchers.prepare") ? (
                                    <>
                                      <strong>
                                        {classification.categoryCode ?? classification.activityCode}
                                      </strong>
                                      {classification.categoryCode && classification.activityCode ? (
                                        <small> · {classification.activityCode}</small>
                                      ) : null}
                                      <br />
                                      <small>{CLASSIFICATION_ORIGIN_LABELS[classification.origin ?? ""] ?? "Clasificación guardada"}</small>
                                    </>
                                  ) : (
                                    <div className="workpaper-classification-fields">
                                      {classification.direction === "PURCHASE" ? (
                                        <select
                                          aria-label="Rubro del proveedor"
                                          value={draft.categoryCode}
                                          onChange={(event) =>
                                            setClassificationDrafts((current) => ({
                                              ...current,
                                              [classification.id]: {
                                                ...draft,
                                                categoryCode: event.target.value,
                                              },
                                            }))
                                          }
                                        >
                                          <option value="">Rubro…</option>
                                          <option value="SUPER">SUPER · Minimercados</option>
                                          <option value="TRANSPORTE">TRANSPORTE</option>
                                        </select>
                                      ) : null}
                                      <select
                                        aria-label="Actividad"
                                        value={draft.activityCode}
                                        onChange={(event) =>
                                          setClassificationDrafts((current) => ({
                                            ...current,
                                            [classification.id]: {
                                              ...draft,
                                              activityCode: event.target.value,
                                            },
                                          }))
                                        }
                                      >
                                        <option value="">
                                          {classification.direction === "SALE"
                                            ? "Elegí la actividad…"
                                            : "Sin actividad (opcional)"}
                                        </option>
                                        {activityOptions(draft.activityCode).map((activity) => (
                                          <option key={activity.code} value={activity.code}>
                                            {activity.name ? `${activity.code} · ${activity.name}` : activity.code}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  );
                                },
                              },
                              {
                                key: "state",
                                header: "Estado",
                                render: (classification) =>
                                  classification.status === "CLASSIFIED" ? (
                                    canEditSources && capabilities.has("tax.vouchers.prepare") ? (
                                      <>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          disabled={classifyVoucherMutation.isPending}
                                          onClick={() => classifyVoucherMutation.mutate(classification)}
                                        >
                                          Actualizar
                                        </Button>
                                        <WorkpaperActionError
                                          error={
                                            classifyVoucherMutation.variables?.id === classification.id
                                              ? classifyVoucherMutation.error
                                              : null
                                          }
                                        />
                                      </>
                                    ) : (
                                      <StatusBadge status="READY" />
                                    )
                                  ) : canEditSources && capabilities.has("tax.vouchers.prepare") ? (
                                    <>
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        disabled={classifyVoucherMutation.isPending}
                                        onClick={() => classifyVoucherMutation.mutate(classification)}
                                      >
                                        Guardar
                                      </Button>
                                      <WorkpaperActionError
                                        error={
                                          classifyVoucherMutation.variables?.id === classification.id
                                            ? classifyVoucherMutation.error
                                            : null
                                        }
                                      />
                                    </>
                                  ) : (
                                    <StatusBadge status="WAITING_INPUTS" />
                                  ),
                              },
                            ]}
                          />
                          <p className="workpaper-stage__note">
                            El cálculo queda bloqueado mientras exista una compra sin rubro o una
                            venta sin actividad. El rubro manual se guarda en el maestro del
                            proveedor para los próximos períodos.
                          </p>
                          <div className="workpaper-stage__heading workpaper-stage__heading--subsection">
                            <div>
                              <strong>Imputación de retenciones y percepciones</strong>
                              <small>
                                Cada certificado queda asignado a una obligación, jurisdicción y
                                período concretos antes de entrar al motor.
                              </small>
                            </div>
                            <span className="workpaper-stage__actions">
                              <StatusBadge
                                status={allocationQuery.data?.ready ? "READY" : "WAITING_INPUTS"}
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void allocationQuery.refetch()}
                              >
                                Actualizar imputaciones
                              </Button>
                            </span>
                          </div>
                          {allocationQuery.isLoading ? (
                            <p className="muted-copy">Imputando certificados revisados…</p>
                          ) : (
                            <Table<WorkpaperAllocation>
                              rows={allocationQuery.data?.items ?? []}
                              rowKey={(allocation) => allocation.id}
                              empty="No hay retenciones o percepciones revisadas para imputar."
                              columns={[
                                {
                                  key: "certificate",
                                  header: "Certificado",
                                  render: (allocation) => (
                                    <>
                                      <strong>
                                        {allocation.sourceType === "WITHHOLDING"
                                          ? "Retención"
                                          : "Percepción"}
                                      </strong>
                                      <br />
                                      <small>
                                        {allocation.certificate?.certificateNumber ?? "Sin número"} · {allocation.certificate?.cuitAgent ?? "Sin agente"}
                                      </small>
                                    </>
                                  ),
                                },
                                {
                                  key: "obligation",
                                  header: "Obligación",
                                  render: (allocation) => (
                                    <>
                                      <strong>
                                        {allocation.obligation?.regime.taxType.name ?? "Impuesto"}{allocation.obligation && !allocation.obligation.regime.taxType.isActive ? " (oculto)" : ""}
                                      </strong>
                                      <br />
                                      <small>{allocation.obligation?.regime.name}{allocation.obligation && !allocation.obligation.regime.isActive ? " (oculto)" : ""}</small>
                                    </>
                                  ),
                                },
                                {
                                  key: "jurisdiction",
                                  header: "Jurisdicción imputada",
                                  render: (allocation) =>
                                    canEditSources && capabilities.has("tax.vouchers.prepare") ? (
                                      <select
                                        className="workpaper-allocation-select"
                                        aria-label="Jurisdicción de la imputación"
                                        value={
                                          allocationDrafts[allocation.id] ??
                                          allocation.allocatedJurisdiction?.code ??
                                          ""
                                        }
                                        onChange={(event) =>
                                          setAllocationDrafts((current) => ({
                                            ...current,
                                            [allocation.id]: event.target.value,
                                          }))
                                        }
                                      >
                                        <option value="">Jurisdicción…</option>
                                        {[
                                          ...(jurisdictionsQuery.data ?? []).filter((jurisdiction) => jurisdiction.isActive),
                                          ...(allocation.allocatedJurisdiction && !allocation.allocatedJurisdiction.isActive
                                            ? [allocation.allocatedJurisdiction]
                                            : []),
                                        ].map((jurisdiction) => (
                                          <option key={jurisdiction.id} value={jurisdiction.code} disabled={!jurisdiction.isActive}>
                                            {jurisdiction.code} · {jurisdiction.name}{!jurisdiction.isActive ? " (oculto)" : ""}
                                          </option>
                                        ))}
                                      </select>
                                    ) : (
                                      allocation.allocatedJurisdiction
                                        ? `${allocation.allocatedJurisdiction.name}${!allocation.allocatedJurisdiction.isActive ? " (oculto)" : ""}`
                                        : "Sin jurisdicción"
                                    ),
                                },
                                {
                                  key: "amount",
                                  header: "Importe",
                                  align: "right",
                                  render: (allocation) => (
                                    <strong>{formatMoney(allocation.amount)}</strong>
                                  ),
                                },
                                {
                                  key: "state",
                                  header: "Estado",
                                  render: (allocation) =>
                                    canEditSources && capabilities.has("tax.vouchers.prepare") ? (
                                      <>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          disabled={reallocateInputMutation.isPending}
                                          onClick={() => reallocateInputMutation.mutate(allocation)}
                                        >
                                          Reimputar
                                        </Button>
                                        <WorkpaperActionError
                                          error={
                                            reallocateInputMutation.variables?.id === allocation.id
                                              ? reallocateInputMutation.error
                                              : null
                                          }
                                        />
                                      </>
                                    ) : (
                                      <StatusBadge status="READY" />
                                    ),
                                },
                              ]}
                            />
                          )}
                        </>
                      )}
                    </div>
                  ) : safeActiveStep === 3 ? (
                    <div className="workpaper-stage">
                      <div className="workpaper-stage__heading">
                        <div>
                          <strong>Posición fiscal del período</strong>
                          <small>
                            Devengado fiscal, pagos e intereses sin mezclarlo con el resultado
                            gerencial.
                          </small>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void positionQuery.refetch()}
                        >
                          Actualizar posición
                        </Button>
                      </div>
                      <div className="workpaper-calculation-breakdown">
                        <div className="workpaper-stage__heading workpaper-stage__heading--subsection">
                          <div>
                            <strong>Determinación y trazabilidad del cálculo</strong>
                            <small>
                              Totales, fórmulas, alícuotas y versión de reglas congeladas por
                              obligación.
                            </small>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void calculationQuery.refetch()}
                          >
                            Actualizar cálculo
                          </Button>
                        </div>
                        {calculationQuery.isLoading ? (
                          <p className="muted-copy">Cargando determinación…</p>
                        ) : (
                          (calculationQuery.data ?? []).map((component) => (
                            <article className="workpaper-calculation" key={component.obligationId}>
                              <div className="workpaper-calculation__header">
                                <span>
                                  <strong>
                                    {component.obligation.taxTypeName} · {component.obligation.regimeName}
                                  </strong>
                                  <small>{component.obligation.jurisdictionName}</small>
                                </span>
                                {component.settlement ? (
                                  <span>
                                    <StatusBadge status={component.settlement.status} />
                                  </span>
                                ) : (
                                  <StatusBadge status="PENDING" />
                                )}
                              </div>
                              {component.settlement ? (
                                <>
                                  <dl className="workpaper-calculation__totals">
                                    {Object.entries(component.settlement.totals ?? {})
                                      .filter(([concept]) => calculationLabel(concept) !== null)
                                      .map(([concept, amount]) => (
                                        <div
                                          className={
                                            concept === "TOTAL_A_INGRESAR" ? "is-total" : ""
                                          }
                                          key={concept}
                                        >
                                          <dt>{calculationLabel(concept)}</dt>
                                          <dd>{formatMoney(amount)}</dd>
                                        </div>
                                      ))}
                                  </dl>
                                  {component.settlement.f931Inputs.length > 0 ? (
                                    <p className="workpaper-calculation__source-note">
                                      F.931 revisado · remuneración neta {formatMoney(
                                        String(
                                          component.settlement.f931Inputs[0]?.snapshot[
                                            "netRemuneration"
                                          ] ?? 0,
                                        ),
                                      )}
                                    </p>
                                  ) : null}
                                  <details className="workpaper-calculation__trace">
                                    <summary>
                                      Ver {component.settlement.lines.length} línea(s) de cálculo
                                    </summary>
                                    <Table<(typeof component.settlement.lines)[number]>
                                      rows={component.settlement.lines}
                                      rowKey={(line) => line.id}
                                      empty="La liquidación no generó líneas."
                                      columns={[
                                        {
                                          key: "concept",
                                          header: "Concepto",
                                          render: (line) => line.concept.replaceAll("_", " "),
                                        },
                                        {
                                          key: "formula",
                                          header: "Fórmula / fuente",
                                          render: (line) => line.formula ?? "—",
                                        },
                                        {
                                          key: "amount",
                                          header: "Importe",
                                          align: "right",
                                          render: (line) => <strong>{formatMoney(line.amount)}</strong>,
                                        },
                                      ]}
                                    />
                                  </details>
                                  {component.settlement.differences.length > 0 ? (
                                    <div className="workpaper-calculation__differences">
                                      {component.settlement.differences.map((difference) => (
                                        <p key={difference.id}>
                                          <StatusBadge status={difference.severity} />
                                          <span>
                                            <strong>{difference.code}</strong> · {difference.message}
                                          </span>
                                        </p>
                                      ))}
                                    </div>
                                  ) : null}
                                </>
                              ) : (
                                <p className="muted-copy">
                                  El detalle se genera cuando el legajo se calcula.
                                </p>
                              )}
                            </article>
                          ))
                        )}
                      </div>
                      {positionQuery.isLoading ? (
                        <p className="muted-copy">Calculando posición…</p>
                      ) : (
                        <>
                          <Table<TaxPosition>
                            rows={positionQuery.data ?? []}
                            rowKey={(position) => position.obligationId}
                            empty="No hay obligaciones fiscales para el período seleccionado."
                            columns={[
                              {
                                key: "tax",
                                header: "Impuesto",
                                render: (position) => (
                                  <>
                                    <strong>{position.regime.taxType.name}{!position.regime.taxType.isActive ? " (oculto)" : ""}</strong>
                                    <br />
                                    <small>
                                      {position.regime.name}{!position.regime.isActive ? " (oculto)" : ""} · {position.regime.jurisdiction.name}{!position.regime.jurisdiction.isActive ? " (oculto)" : ""}
                                    </small>
                                  </>
                                ),
                              },
                              {
                                key: "dueDate",
                                header: "Vencimiento",
                                render: (position) => formatDate(position.dueDate),
                              },
                              {
                                key: "accrued",
                                header: "Devengado",
                                align: "right",
                                render: (position) => formatMoney(position.accrued),
                              },
                              {
                                key: "interest",
                                header: "Interés",
                                align: "right",
                                render: (position) => formatMoney(position.interest),
                              },
                              {
                                key: "paid",
                                header: "Pagado",
                                align: "right",
                                render: (position) => formatMoney(position.paid),
                              },
                              {
                                key: "pending",
                                header: "Pendiente",
                                align: "right",
                                render: (position) => (
                                  <strong>{formatMoney(position.pending)}</strong>
                                ),
                              },
                              {
                                key: "totalPayable",
                                header: "Total a pagar",
                                align: "right",
                                render: (position) => (
                                  <strong>{formatMoney(position.totalPayable)}</strong>
                                ),
                              },
                              {
                                key: "credit",
                                header: "A favor",
                                align: "right",
                                render: (position) => formatMoney(position.availableCredit),
                              },
                              {
                                key: "status",
                                header: "Estado",
                                render: (position) => <StatusBadge status={position.status} />,
                              },
                              {
                                key: "actions",
                                header: "Acciones",
                                render: (position) => (
                                  <span className="study-table__actions">
                                    {position.filedAt ? (
                                      <span className="muted-copy">
                                        Presentada el {formatDate(position.filedAt)}
                                      </span>
                                    ) : position.settlement?.status === "FINALIZED" &&
                                      capabilities.has("tax.filings.record") ? (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => {
                                          setPositionAction({ kind: "FILING", position });
                                          setFilingForm({
                                            amountFiled: position.accrued,
                                            filedAt: new Date().toISOString().slice(0, 10),
                                            externalId: "",
                                            evidenceDocumentId: "",
                                          });
                                        }}
                                      >
                                        Registrar presentación
                                      </Button>
                                    ) : null}
                                    {Number(position.pending) > 0 &&
                                    position.dueDate &&
                                    new Date(position.dueDate) < new Date() &&
                                    position.settlement?.status === "FINALIZED" &&
                                    capabilities.has("tax.payments.record") ? (
                                      <>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          loading={calculateInterestMutation.isPending}
                                          onClick={() =>
                                            calculateInterestMutation.mutate({
                                              workpaperId: wp.id,
                                              obligationId: position.obligationId,
                                            })
                                          }
                                        >
                                          Calcular mora
                                        </Button>
                                        <WorkpaperActionError
                                          error={
                                            calculateInterestMutation.variables?.obligationId ===
                                            position.obligationId
                                              ? calculateInterestMutation.error
                                              : null
                                          }
                                        />
                                      </>
                                    ) : null}
                                    {Number(position.totalPayable) > 0 &&
                                    capabilities.has("tax.payments.record") ? (
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        onClick={() => {
                                          setPositionAction({ kind: "PAYMENT", position });
                                          setPaymentForm({
                                            amount: position.totalPayable,
                                            paidAt: new Date().toISOString().slice(0, 10),
                                            method: "TRANSFERENCIA",
                                            reference: "",
                                          });
                                        }}
                                      >
                                        Registrar pago
                                      </Button>
                                    ) : null}
                                  </span>
                                ),
                              },
                            ]}
                          />
                        </>
                      )}
                    </div>
                  ) : safeActiveStep === 4 ? (
                    <div className="workpaper-controls">
                      {wp.controls.length === 0 ? (
                        <p>No hay controles registrados para este legajo.</p>
                      ) : (
                        wp.controls.map((control) => (
                          <div className="workpaper-control" key={control.id}>
                            <span>
                              <strong>{CONTROL_LABELS[control.code] ?? control.code}</strong>
                              {control.message ? <small>{control.message}</small> : null}
                              {control.expected !== null ? (
                                <small>
                                  Esperado: {formatMoney(control.expected)}
                                  {control.actual !== null
                                    ? ` · Actual: ${formatMoney(control.actual)}`
                                    : control.status === "OPEN"
                                      ? " · Pendiente de respaldo"
                                      : ""}
                                  {control.tolerance !== null
                                    ? ` · Tolerancia: ${formatMoney(control.tolerance)}`
                                    : ""}
                                </small>
                              ) : null}
                              {control.resolution ? <small>{control.resolution}</small> : null}
                            </span>
                            <StatusBadge status={control.status} />
                            <span className="muted-copy">
                              {control.severity === "BLOCKING" && control.status !== "OPEN"
                                ? "Bloqueaba el cierre"
                                : CONTROL_SEVERITY_LABELS[control.severity] ?? control.severity}
                            </span>
                            {control.status === "OPEN" &&
                            capabilities.has("tax.settlements.review") ? (
                              <span className="workpaper-control__resolution">
                                <input
                                  aria-label={`Resolución ${control.code}`}
                                  value={controlResolutions[control.id] ?? ""}
                                  placeholder="Explicá cómo se resolvió…"
                                  onChange={(event) =>
                                    setControlResolutions((values) => ({
                                      ...values,
                                      [control.id]: event.target.value,
                                    }))
                                  }
                                />
                                {control.severity === "BLOCKING" ? (
                                  <>
                                    <select
                                      aria-label={`Evidencia ${control.code}`}
                                      value={controlEvidence[control.id] ?? ""}
                                      onChange={(event) =>
                                        setControlEvidence((values) => ({
                                          ...values,
                                          [control.id]: event.target.value,
                                        }))
                                      }
                                    >
                                      <option value="">Sin documento de respaldo</option>
                                      {eligibleEvidenceDocuments.map((document) => (
                                        <option key={document.id} value={document.id}>
                                          {document.fileVersions?.[0]?.originalName ??
                                            document.category ??
                                            "Documento"}{" "}
                                          · {getStatusBadgeMeta(document.status).label}
                                        </option>
                                      ))}
                                    </select>
                                    {documentsQuery.isSuccess &&
                                    eligibleEvidenceDocuments.length === 0 ? (
                                      <small className="muted-copy">
                                        El respaldo es opcional. Para adjuntar uno, aprobá la extracción del
                                        documento en Bandeja.
                                      </small>
                                    ) : null}
                                  </>
                                ) : null}
                                <Button
                                  size="sm"
                                  disabled={!controlResolutions[control.id]?.trim()}
                                  loading={resolveControlMutation.isPending}
                                  onClick={() =>
                                    resolveControlMutation.mutate({
                                      workpaperId: wp.id,
                                      findingId: control.id,
                                      status: "RESOLVED",
                                      ...(controlEvidence[control.id]
                                        ? { evidenceDocumentId: controlEvidence[control.id] }
                                        : {}),
                                    })
                                  }
                                >
                                  Resolver
                                </Button>
                                {control.severity !== "BLOCKING" ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={!controlResolutions[control.id]?.trim()}
                                    onClick={() =>
                                      resolveControlMutation.mutate({
                                        workpaperId: wp.id,
                                        findingId: control.id,
                                        status: "WAIVED",
                                      })
                                    }
                                  >
                                    Eximir
                                  </Button>
                                ) : null}
                                <WorkpaperActionError
                                  error={
                                    resolveControlMutation.variables?.findingId === control.id
                                      ? resolveControlMutation.error
                                      : null
                                  }
                                />
                              </span>
                            ) : null}
                          </div>
                        ))
                      )}
                    </div>
                  ) : (
                    <div className="workpaper-stage">
                      <div className="workpaper-stage__heading">
                        <div>
                          <strong>Cierre y arrastre</strong>
                          <small>
                            Finalizar congela los hashes y genera los saldos de cierre para el
                            siguiente período.
                          </small>
                        </div>
                      </div>
                      <dl className="workpaper-close-details">
                        <div>
                          <dt>Hash de entrada</dt>
                          <dd>
                            {wp.inputHash
                              ? `${wp.inputHash.slice(0, 16)}…`
                              : "Se genera al calcular"}
                          </dd>
                        </div>
                        <div>
                          <dt>Hash de salida</dt>
                          <dd>
                            {wp.outputHash
                              ? `${wp.outputHash.slice(0, 16)}…`
                              : "Se genera al finalizar"}
                          </dd>
                        </div>
                        <div>
                          <dt>Controles bloqueantes</dt>
                          <dd>{blocking.length}</dd>
                        </div>
                      </dl>
                    </div>
                  )}
                </div>

                <div className="workpaper-step-footer" aria-label="Cambio de etapa">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!previousStep}
                    onClick={goToPreviousStep}
                  >
                    {previousStep ? `Volver a ${previousStep.title}` : "Inicio del proceso"}
                  </Button>
                  <span>
                    {activeStepMeta.title} · {safeActiveStep + 1}/{WORKPAPER_STEPS.length}
                  </span>
                  <Button size="sm" variant="secondary" disabled={!nextStep} onClick={goToNextStep}>
                    {nextStep ? `Ir a ${nextStep.title}` : "Última etapa"}
                    {nextStep ? <Icon name="arrow-right" size={14} /> : null}
                  </Button>
                </div>

                <div className="workpaper-card__actions">
                  {["DRAFT", "COLLECTING_INPUTS", "READY_TO_CALCULATE"].includes(wp.status) ? (
                    <>
                      <Button
                        variant="primary"
                        disabled={calculateDisabled}
                        title={calculateDisabledReason ?? "Calcular el legajo"}
                        onClick={() => void calculateMutation.mutate(wp.id)}
                      >
                        Calcular
                      </Button>
                      <WorkpaperActionError
                        error={calculateMutation.variables === wp.id ? calculateMutation.error : null}
                      />
                      {calculateDisabledReason ? (
                        <small className="muted-copy" role="status">
                          {calculateDisabledReason}
                        </small>
                      ) : null}
                    </>
                  ) : null}
                  {wp.status === "CHANGES_REQUESTED" ? (
                    <>
                      <Button
                        variant="primary"
                        disabled={
                          calculateMutation.isPending ||
                          !capabilities.has("tax.settlements.calculate")
                        }
                        onClick={() => calculateMutation.mutate(wp.id)}
                      >
                        Recalcular
                      </Button>
                      <WorkpaperActionError
                        error={calculateMutation.variables === wp.id ? calculateMutation.error : null}
                      />
                    </>
                  ) : null}
                  {wp.status === "CALCULATED" ? (
                    <>
                      <Button
                        variant="primary"
                        disabled={
                          submitMutation.isPending ||
                          !capabilities.has("tax.settlements.submit_review")
                        }
                        onClick={() => void submitMutation.mutate(wp.id)}
                      >
                        Enviar a revisión
                      </Button>
                      <WorkpaperActionError
                        error={submitMutation.variables === wp.id ? submitMutation.error : null}
                      />
                    </>
                  ) : null}
                  {wp.status === "IN_REVIEW" ? (
                    <span className="study-table__actions">
                      {capabilities.has("tax.settlements.review") ? (
                        <>
                          <Button
                            variant="primary"
                            disabled={reviewMutation.isPending || selfReviewBlocked}
                            onClick={() => reviewMutation.mutate({ id: wp.id, approved: true })}
                          >
                            Aprobar revisión
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={reviewMutation.isPending || selfReviewBlocked}
                            onClick={() => reviewMutation.mutate({ id: wp.id, approved: false })}
                          >
                            Solicitar cambios
                          </Button>
                        </>
                      ) : null}
                    </span>
                  ) : null}
                  {wp.status === "IN_REVIEW" ? (
                    <WorkpaperActionError
                      error={reviewMutation.variables?.id === wp.id ? reviewMutation.error : null}
                    />
                  ) : null}
                  {selfReviewBlocked && ["IN_REVIEW", "REVIEWED"].includes(wp.status) ? (
                    <small className="muted-copy">
                      Para revisar o finalizar este legajo, el Titular puede habilitar la
                      autorrevisión en Configuración del estudio.
                    </small>
                  ) : null}
                  {wp.status === "REVIEWED" ? (
                    <Button
                      variant="primary"
                      disabled={
                        finalizeMutation.isPending ||
                        !capabilities.has("tax.settlements.finalize") ||
                        selfReviewBlocked
                      }
                      onClick={() => void finalizeMutation.mutate(wp.id)}
                    >
                      Finalizar
                    </Button>
                  ) : null}
                  {wp.status === "REVIEWED" ? (
                    <WorkpaperActionError
                      error={finalizeMutation.variables === wp.id ? finalizeMutation.error : null}
                    />
                  ) : null}
                  {wp.status === "FINALIZED" && capabilities.has("tax.settlements.rectify") ? (
                    <Button
                      variant="secondary"
                      disabled={rectifyMutation.isPending}
                      onClick={() => rectifyMutation.mutate(wp.id)}
                    >
                      Crear rectificativa
                    </Button>
                  ) : null}
                  {wp.status === "FINALIZED" ? (
                    <WorkpaperActionError
                      error={rectifyMutation.variables === wp.id ? rectifyMutation.error : null}
                    />
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    
    </DensePage>
  );
}
