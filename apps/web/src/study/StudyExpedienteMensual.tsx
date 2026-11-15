import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button, EmptyState, getStatusBadgeMeta, Table } from "@contable/design-system";
import { api, type Client } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { useSession } from "../session/SessionContext";
import { StatusBadge } from "../ui/StatusBadge";
import {
  DensePage,
  useDensity,
} from "../ui/Dense";
import type {
  AllocationCoverage,
  ClassificationCoverage,
  CoberturaLegajo,
  CreditLot,
  EvidenceDocument,
  FiscalTaxPeriod,
  PositionAction,
  TaxJurisdiction,
  TaxPosition,
  TaxRegime,
  TaxType,
  Workpaper,
  WorkpaperAllocation,
  WorkpaperCalculationComponent,
  WorkpaperClassification,
} from "./legajo/tipos";
import {
  fiscalTaxPeriodSelectionKey,
  readFiscalTaxPeriodSelection,
  writeFiscalTaxPeriodSelection,
} from "./legajo/periodoFiscal";
import {
  CLASSIFICATION_ORIGIN_LABELS,
  CONTROL_LABELS,
  CONTROL_SEVERITY_LABELS,
  WORKPAPER_STEPS,
  calculationDisabledMessage,
  calculationLabel,
} from "./legajo/etiquetas";
import { formatDate, formatMoney } from "./legajo/formato";
import { hashSourceFile, parseSourceFile } from "./legajo/archivoFuente";
import { WorkpaperActionError } from "./legajo/WorkpaperActionError";
import { CabeceraLegajo } from "./legajo/paneles/CabeceraLegajo";
import { PanelEditarSaldo } from "./legajo/paneles/PanelEditarSaldo";
import { PanelLibrosIva } from "./legajo/paneles/PanelLibrosIva";
import { PanelSaldoInicial } from "./legajo/paneles/PanelSaldoInicial";
import { PanelPago } from "./legajo/paneles/PanelPago";
import { PanelPresentacion } from "./legajo/paneles/PanelPresentacion";
import { BandaEstado } from "./legajo/BandaEstado";
import { ListaLegajos } from "./legajo/ListaLegajos";
import { SelectorPeriodo } from "./legajo/SelectorPeriodo";
import { LegajoTarjeta } from "./legajo/Tarjeta/LegajoTarjeta";
import { ResumenRevision } from "./legajo/Tarjeta/ResumenRevision";
import { EtapaFuentes } from "./legajo/etapas/EtapaFuentes";
import { EtapaSaldos } from "./legajo/etapas/EtapaSaldos";
import { ConfirmDialog, useConfirmAction } from "../ui/ConfirmAction";
import "./study.css";


/**
 * Legajo de liquidación (F1.6, PLAN §4.6).
 *
 * Vista de trabajo mensual para preparador y revisor: densa, legible y
 * trazable. Usa un stepper persistente (no un wizard que oculte información):
 *   saldos → fuentes → clasificación → cálculo → controles → cierre.
 * Cada total permite drill-down hasta la evidencia fuente.
 */

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
  const [etapaPorLegajo, setEtapaPorLegajo] = useState<Record<string, number>>({});
  const [showOpening, setShowOpening] = useState(false);
  const [editingLot, setEditingLot] = useState<CreditLot | null>(null);
  const [editForm, setEditForm] = useState({
    reference: "",
    evidenceDocumentId: "",
    originalAmount: "",
  });
  const [controlResolutions, setControlResolutions] = useState<Record<string, string>>({});
  const [controlEvidence, setControlEvidence] = useState<Record<string, string>>({});
  const [positionAction, setPositionAction] = useState<PositionAction>(null);
  const [sourceCode, setSourceCode] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [classificationDrafts, setClassificationDrafts] = useState<
    Record<string, { categoryCode: string; activityCode: string }>
  >({});
  const [allocationDrafts, setAllocationDrafts] = useState<Record<string, string>>({});
  const [showSifereModal, setShowSifereModal] = useState(false);
  const confirmacion = useConfirmAction();
  const { ask: pedirConfirmacion, request: solicitudConfirmacion } = confirmacion;
  const cerrarConfirmacion = useCallback(() => pedirConfirmacion(null), [pedirConfirmacion]);
  // Cierre estable: si cambia en cada render, ConfirmAction devuelve el foco y suelta Escape.
  const confirmacionEstable = useMemo(
    () => ({ request: solicitudConfirmacion, ask: pedirConfirmacion, close: cerrarConfirmacion }),
    [solicitudConfirmacion, pedirConfirmacion, cerrarConfirmacion],
  );
  const confirmar = (solicitud: { title: string; description: string; confirmLabel: string; onConfirm: () => void }) =>
    pedirConfirmacion({ ...solicitud, tone: "default" });

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
      api.get<CoberturaLegajo>(
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
  // Las etapas son de la revisión vigente (la primera de la lista) y cada legajo guarda su etapa.
  const vigente = workpapers[0];
  const safeActiveStep = Math.min(
    Math.max(vigente ? (etapaPorLegajo[vigente.id] ?? 0) : 0, 0),
    WORKPAPER_STEPS.length - 1,
  );
  const eligibleEvidenceDocuments = (documentsQuery.data ?? []).filter((document) =>
    ["READY", "APPLIED", "REVIEWED"].includes(document.status),
  );
  const goToStep = (index: number) => {
    if (!vigente) return;
    setEtapaPorLegajo((values) => ({
      ...values,
      [vigente.id]: Math.min(Math.max(index, 0), WORKPAPER_STEPS.length - 1),
    }));
  };

  const renderEtapa = (wp: Workpaper, safeActiveStep: number) => {
    const canEditSources = [
      "DRAFT",
      "COLLECTING_INPUTS",
      "READY_TO_CALCULATE",
      "CHANGES_REQUESTED",
    ].includes(wp.status);
    const blocking = wp.controls.filter((c) => c.severity === "BLOCKING" && c.status === "OPEN");
    return (
      <>
                  {safeActiveStep === 0 ? (
                    <EtapaSaldos
                      capabilities={capabilities}
                      ledgerQuery={ledgerQuery}
                      setShowOpening={setShowOpening}
                      setEditingLot={setEditingLot}
                      setEditForm={setEditForm}
                    />
                  ) : safeActiveStep === 1 ? (
                    <EtapaFuentes
                      coverageQuery={coverageQuery}
                      capabilities={capabilities}
                      canEditSources={canEditSources}
                      currentUserId={currentUserId}
                      sourceCode={sourceCode}
                      setSourceCode={setSourceCode}
                      sourceFile={sourceFile}
                      setSourceFile={setSourceFile}
                      sourceUploadMutation={sourceUploadMutation}
                      reviewSourceMutation={reviewSourceMutation}
                    />
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
      </>
    );
  };

  return (
    <DensePage density={density} flow>
      <CabeceraLegajo
        capabilities={capabilities}
        selectedTaxPeriod={selectedTaxPeriod}
        creandoLegajo={createMutation.isPending}
        cargandoPeriodos={taxPeriodsQuery.isLoading}
        errorCreacion={createMutation.error}
        onSubirLibros={() => setShowSifereModal(true)}
        onNuevoLegajo={() => void createMutation.mutate()}
      />

      <SelectorPeriodo
        cargando={taxPeriodsQuery.isLoading}
        error={taxPeriodsQuery.isError}
        onReintentar={() => void taxPeriodsQuery.refetch()}
        periodos={selectableTaxPeriods}
        valor={selectedTaxPeriodId}
        onCambiar={(id) => {
          setTaxPeriodSelection({ key: taxPeriodStorageKey, id });
          if (taxPeriodStorageKey) {
            writeFiscalTaxPeriodSelection(taxPeriodStorageKey, id);
          }
        }}
        onConfigurar={() => navigate("/configuracion-fiscal")}
      />

      <BandaEstado
        legajos={listQuery.isError ? "no disponible" : listQuery.data ? workpapers.length : listQuery.isLoading || taxPeriodsQuery.isLoading ? "pendiente" : "—"}
        componentes={coverageQuery.isError ? "no disponible" : coverageQuery.data ? coverageQuery.data.components.length : coverageQuery.isLoading ? "pendiente" : "—"}
      />



      <PanelLibrosIva
        abierto={showSifereModal}
        onCerrar={() => setShowSifereModal(false)}
        firmId={firmId}
        clientId={clientId}
        activeWorkpaperId={activeWorkpaperId}
        fuentes={coverageQuery.data?.sources}
        cuitCliente={clientQuery.data?.cuit}
      />

      <PanelSaldoInicial
        abierto={showOpening}
        onCerrar={() => setShowOpening(false)}
        firmId={firmId}
        clientId={clientId}
        tiposImpuesto={taxTypesQuery.data}
        regimenes={regimesQuery.data}
        periodosFiscales={taxPeriodsQuery.data}
        documentos={documentsQuery.data}
      />

      <PanelEditarSaldo
        editingLot={editingLot}
        onCerrar={() => setEditingLot(null)}
        editForm={editForm}
        setEditForm={setEditForm}
        firmId={firmId}
        clientId={clientId}
        documentos={documentsQuery.data}
      />

      {positionAction?.kind === "PAYMENT" ? (
        <PanelPago
          posicion={positionAction.position}
          onCerrar={() => setPositionAction(null)}
          firmId={firmId}
          clientId={clientId}
        />
      ) : null}

      {positionAction?.kind === "FILING" ? (
        <PanelPresentacion
          posicion={positionAction.position}
          onCerrar={() => setPositionAction(null)}
          firmId={firmId}
          clientId={clientId}
          documentos={documentsQuery.data}
        />
      ) : null}

      <ConfirmDialog confirm={confirmacionEstable} />
      <ListaLegajos
        cargando={listQuery.isLoading}
        error={listQuery.isError}
        onReintentar={() => void listQuery.refetch()}
        exito={listQuery.isSuccess}
        sinPeriodo={!selectedTaxPeriod}
        legajos={workpapers}
        puedeCrear={capabilities.has("tax.settlements.calculate")}
        creando={createMutation.isPending}
        onCrear={() => createMutation.mutate()}
        renderLegajo={(wp, indice) => {
          if (indice > 0 && vigente) {
            return <ResumenRevision key={wp.id} wp={wp} vigente={vigente} />;
          }
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
          const acciones = (
            <>
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
                      {!capabilities.has("tax.settlements.calculate") ? (
                        <small className="muted-copy" role="status">Tu perfil no tiene permiso para recalcular este legajo.</small>
                      ) : null}
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
                      {!capabilities.has("tax.settlements.submit_review") ? (
                        <small className="muted-copy" role="status">Tu perfil no tiene permiso para enviar este legajo a revisión.</small>
                      ) : null}
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
                      onClick={() =>
                        confirmar({
                          title: "Finalizar el legajo",
                          description: "Finalizar congela los datos del período y genera los saldos de cierre para el siguiente. Después, el legajo no se modifica: para corregirlo hay que crear una rectificativa.",
                          confirmLabel: "Sí, finalizar",
                          onConfirm: () => finalizeMutation.mutate(wp.id),
                        })
                      }
                    >
                      Finalizar
                    </Button>
                  ) : null}
                  {wp.status === "REVIEWED" && !capabilities.has("tax.settlements.finalize") ? (
                    <small className="muted-copy" role="status">Tu perfil no tiene permiso para finalizar este legajo.</small>
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
                      onClick={() =>
                        confirmar({
                          title: "Crear rectificativa",
                          description: "Abre una revisión nueva del período. La revisión actual queda finalizada y sin cambios.",
                          confirmLabel: "Sí, crear rectificativa",
                          onConfirm: () => rectifyMutation.mutate(wp.id),
                        })
                      }
                    >
                      Crear rectificativa
                    </Button>
                  ) : null}
                  {wp.status === "FINALIZED" ? (
                    <WorkpaperActionError
                      error={rectifyMutation.variables === wp.id ? rectifyMutation.error : null}
                    />
                  ) : null}
            </>
          );
          return (
            <LegajoTarjeta
              key={wp.id}
              wp={wp}
              etapaActiva={safeActiveStep}
              onCambiarEtapa={goToStep}
              acciones={acciones}
            >
              {renderEtapa(wp, safeActiveStep)}
            </LegajoTarjeta>
          );
        }}
      />
    </DensePage>
  );
}
