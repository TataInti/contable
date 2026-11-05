/**
 * Contrato común de las operaciones de borrado definitivo (sólo Titular).
 * El servidor siempre devuelve un preview con conteos y bloqueos antes de
 * ejecutar; la UI exige escribir el nombre/código como confirmación.
 */

export type DeletionGroupKey =
  | "documentos"
  | "fiscal"
  | "contabilidad"
  | "gestion"
  | "analisis"
  | "otros";

export interface DeletionCountItem {
  key: string;
  label: string;
  count: number;
}

export interface DeletionGroup {
  key: DeletionGroupKey;
  label: string;
  count: number;
}

export interface DeletionPreview {
  entity: {
    id: string;
    kind: string;
    label: string;
    secondary?: string;
  };
  confirmation: {
    expected: string;
    label: string;
  };
  totals: {
    rows: number;
    affectedClients?: number;
  };
  groups: DeletionGroup[];
  items: DeletionCountItem[];
  blockers: DeletionCountItem[];
  canDelete: boolean;
  notes: string[];
}

export class DeletionError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, statusCode = 409, details?: Record<string, unknown>) {
    super(message);
    this.name = "DeletionError";
    this.code = code;
    this.statusCode = statusCode;
    if (details !== undefined) this.details = details;
  }
}

export const GROUP_LABELS: Record<DeletionGroupKey, string> = {
  documentos: "Documentos y archivos",
  fiscal: "Datos fiscales",
  contabilidad: "Contabilidad",
  gestion: "Gestión y accesos",
  analisis: "Análisis y reportes",
  otros: "Otros datos",
};

const TABLE_GROUPS: Record<string, { group: DeletionGroupKey; label: string }> = {
  // Documentos y archivos
  documents: { group: "documentos", label: "Documentos" },
  document_file_versions: { group: "documentos", label: "Versiones de archivo" },
  document_extractions: { group: "documentos", label: "Extracciones" },
  extracted_fields: { group: "documentos", label: "Campos extraídos" },
  extracted_line_items: { group: "documentos", label: "Ítems extraídos" },
  document_processing_jobs: { group: "documentos", label: "Procesamientos de documentos" },
  upload_sessions: { group: "documentos", label: "Sesiones de carga" },
  document_requests: { group: "documentos", label: "Pedidos de documentación" },
  document_request_items: { group: "documentos", label: "Ítems de pedidos" },
  request_threads: { group: "documentos", label: "Hilos de pedidos" },
  request_messages: { group: "documentos", label: "Mensajes de pedidos" },
  evidence_links: { group: "documentos", label: "Vínculos de evidencia" },
  expense_evidence: { group: "documentos", label: "Evidencia de gastos" },
  perception_certificates: { group: "documentos", label: "Certificados de percepción" },
  withholding_certificates: { group: "documentos", label: "Certificados de retención" },

  // Datos fiscales
  taxpayer_profile_versions: { group: "fiscal", label: "Versiones del perfil fiscal" },
  tax_registrations: { group: "fiscal", label: "Inscripciones a regímenes" },
  client_activities: { group: "fiscal", label: "Actividades del cliente" },
  tax_periods: { group: "fiscal", label: "Períodos fiscales" },
  tax_obligations: { group: "fiscal", label: "Obligaciones fiscales" },
  obligation_instances: { group: "fiscal", label: "Instancias de obligaciones" },
  obligation_reminders: { group: "fiscal", label: "Recordatorios de obligaciones" },
  reminder_dispatches: { group: "fiscal", label: "Envíos de recordatorios" },
  tax_settlements: { group: "fiscal", label: "Liquidaciones" },
  tax_settlement_lines: { group: "fiscal", label: "Líneas de liquidaciones" },
  settlement_inputs: { group: "fiscal", label: "Insumos de liquidaciones" },
  tax_differences: { group: "fiscal", label: "Diferencias de liquidaciones" },
  tax_adjustments: { group: "fiscal", label: "Ajustes fiscales" },
  tax_payments: { group: "fiscal", label: "Pagos fiscales" },
  payment_allocations: { group: "fiscal", label: "Imputaciones de pagos" },
  tax_credit_allocations: { group: "fiscal", label: "Asignaciones de créditos" },
  tax_credit_ledger_entries: { group: "fiscal", label: "Movimientos del libro de créditos" },
  tax_credit_lot_history: { group: "fiscal", label: "Historial de lotes de crédito" },
  tax_credit_lots: { group: "fiscal", label: "Lotes de crédito" },
  tax_credit_movements: { group: "fiscal", label: "Movimientos de lotes de crédito" },
  tax_control_findings: { group: "fiscal", label: "Controles fiscales" },
  tax_input_allocations: { group: "fiscal", label: "Asignaciones de insumos" },
  tax_interest_snapshots: { group: "fiscal", label: "Snapshots de intereses" },
  tax_treatment_decisions: { group: "fiscal", label: "Decisiones de tratamiento" },
  monthly_tax_workpapers: { group: "fiscal", label: "Workpapers mensuales" },
  workpaper_import_batches: { group: "fiscal", label: "Lotes importados al workpaper" },
  workpaper_settlements: { group: "fiscal", label: "Vínculos workpaper-liquidación" },
  workpaper_voucher_classifications: { group: "fiscal", label: "Clasificaciones de comprobantes" },
  fiscal_components: { group: "fiscal", label: "Componentes fiscales" },
  fiscal_vouchers: { group: "fiscal", label: "Comprobantes fiscales" },
  fiscal_voucher_lines: { group: "fiscal", label: "Líneas de comprobantes" },
  import_batches: { group: "fiscal", label: "Lotes de importación" },
  import_rows: { group: "fiscal", label: "Filas importadas" },
  profitability_snapshots: { group: "fiscal", label: "Snapshots de rentabilidad" },
  f931_lines: { group: "fiscal", label: "Líneas F931" },
  f931_runs: { group: "fiscal", label: "Corridas F931" },
  tax_filings: { group: "fiscal", label: "Presentaciones fiscales" },
  tax_export_artifacts: { group: "fiscal", label: "Exportaciones fiscales" },
  supplier_tax_profiles: { group: "fiscal", label: "Perfiles fiscales de proveedores" },
  vat_rules: { group: "fiscal", label: "Reglas de IVA" },
  vat_liquidations: { group: "fiscal", label: "Liquidaciones de IVA" },
  management_expenses: { group: "fiscal", label: "Gastos gerenciales" },
  management_incomes: { group: "fiscal", label: "Ingresos gerenciales" },

  // Contabilidad
  fiscal_years: { group: "contabilidad", label: "Ejercicios fiscales" },
  accounting_periods: { group: "contabilidad", label: "Períodos contables" },
  accounts: { group: "contabilidad", label: "Cuentas contables" },
  journal_entries: { group: "contabilidad", label: "Asientos contables" },
  journal_lines: { group: "contabilidad", label: "Líneas de asientos" },
  close_cycles: { group: "contabilidad", label: "Cierres" },
  close_work_items: { group: "contabilidad", label: "Tareas de cierre" },
  bank_accounts: { group: "contabilidad", label: "Cuentas bancarias" },
  bank_statements: { group: "contabilidad", label: "Resúmenes bancarios" },
  bank_movements: { group: "contabilidad", label: "Movimientos bancarios" },
  bank_matches: { group: "contabilidad", label: "Conciliaciones bancarias" },
  bank_reconciliations: { group: "contabilidad", label: "Cierres de conciliación" },
  exchange_rate_sources: { group: "contabilidad", label: "Fuentes de tipo de cambio" },
  exchange_rates: { group: "contabilidad", label: "Tipos de cambio" },
  exchange_difference_runs: { group: "contabilidad", label: "Corridas de diferencia de cambio" },
  inflation_indexes: { group: "contabilidad", label: "Índices de inflación" },
  inflation_observations: { group: "contabilidad", label: "Observaciones de inflación" },
  inflation_runs: { group: "contabilidad", label: "Corridas de inflación" },
  counterparties: { group: "contabilidad", label: "Contrapartes" },
  cost_centers: { group: "contabilidad", label: "Centros de costo" },

  // Gestión y accesos
  client_profiles: { group: "gestion", label: "Fichas de cliente" },
  onboarding_checklists: { group: "gestion", label: "Onboarding" },
  client_assignments: { group: "gestion", label: "Asignaciones de usuarios" },
  portal_invitations: { group: "gestion", label: "Invitaciones al portal" },
  portal_memberships: { group: "gestion", label: "Membresías del portal" },
  feature_flags: { group: "gestion", label: "Feature flags" },
  outbox_events: { group: "gestion", label: "Eventos de outbox" },
  idempotency_records: { group: "gestion", label: "Registros de idempotencia" },
  user_notifications: { group: "gestion", label: "Notificaciones" },

  // Análisis y reportes
  assistant_conversations: { group: "analisis", label: "Conversaciones del asistente" },
  assistant_turns: { group: "analisis", label: "Turnos del asistente" },
  assistant_evidence: { group: "analisis", label: "Evidencia del asistente" },
  assistant_feedback: { group: "analisis", label: "Feedback del asistente" },
  assistant_usage: { group: "analisis", label: "Uso del asistente" },
  bi_dashboards: { group: "analisis", label: "Tableros BI" },
  bi_dimensions: { group: "analisis", label: "Dimensiones BI" },
  bi_metrics: { group: "analisis", label: "Métricas BI" },
  bi_snapshots: { group: "analisis", label: "Snapshots BI" },
  bi_widgets: { group: "analisis", label: "Widgets BI" },
  report_templates: { group: "analisis", label: "Plantillas de reportes" },
  report_template_lines: { group: "analisis", label: "Líneas de plantillas" },
  report_runs: { group: "analisis", label: "Corridas de reportes" },
  report_publications: { group: "analisis", label: "Publicaciones de reportes" },
};

export function groupDeletionCounts(
  counts: Array<{ table: string; count: number }>,
): { groups: DeletionGroup[]; items: DeletionCountItem[] } {
  const items = counts
    .filter((row) => row.count > 0)
    .map((row) => {
      const meta = TABLE_GROUPS[row.table];
      return {
        key: row.table,
        label: meta?.label ?? row.table,
        count: row.count,
        group: meta?.group ?? ("otros" as DeletionGroupKey),
      };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es-AR"));

  const totals = new Map<DeletionGroupKey, number>();
  for (const item of items) {
    totals.set(item.group, (totals.get(item.group) ?? 0) + item.count);
  }
  const groups = (Object.keys(GROUP_LABELS) as DeletionGroupKey[])
    .map((key) => ({ key, label: GROUP_LABELS[key], count: totals.get(key) ?? 0 }))
    .filter((group) => group.count > 0);

  return {
    groups,
    items: items.map(({ key, label, count }) => ({ key, label, count })),
  };
}
