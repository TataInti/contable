import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AsyncState,
  BarSelect,
  Button,
  EmptyState,
  Menu,
  Notice,
  WorkBar,
  WorkPage,
  getStatusBadgeMeta,
  type MenuActionItem,
} from "@contable/design-system";
import { FiscalBooksExportAction } from "./FiscalBooksExportAction";
import { CommentThread } from "./CommentThread";
import { Icon } from "../ui/Icon";
import { api, type Client } from "../lib/api";
import { formatearFecha } from "../lib/formatoFechas";
import { useClientContext } from "../context/ClientContext";
import { useSession } from "../session/SessionContext";
import {
  DensePage,
  DenseTabs,
  useDensity,
} from "../ui/Dense";
import { StatusBadge } from "../ui/StatusBadge";
import type {
  AllocationCoverage,
  ClassificationCoverage,
  ClassificationRule,
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
  fiscalTaxPeriodLabel,
  fiscalTaxPeriodSelectionKey,
  readFiscalTaxPeriodSelection,
  writeFiscalTaxPeriodSelection,
  rotuloPeriodoFiscal,
} from "./legajo/periodoFiscal";
import {
  WORKPAPER_STEPS,
  calculationDisabledMessage,
} from "./legajo/etiquetas";
import { importarLoteFuente, LoteConFilasObservadas } from "./legajo/loteFuente";
import { pluralizar } from "./legajo/textos";
import { mensajesDePedidoDeCambios, selfReviewNote } from "./legajo/formato";
import { calcularEstadosEtapas } from "./legajo/estadoEtapas";
import { WorkpaperActionError } from "./legajo/WorkpaperActionError";
import { PeriodoSinLegajo } from "./legajo/PeriodoSinLegajo";
import { TarjetaMonotributo } from "./legajo/TarjetaMonotributo";
import { mesActualMonotributo } from "./fiscal/monotributo";
import { PanelEditarSaldo } from "./legajo/paneles/PanelEditarSaldo";
import { PanelLibrosIva } from "./legajo/paneles/PanelLibrosIva";
import { PanelSaldoInicial } from "./legajo/paneles/PanelSaldoInicial";
import { PanelPago } from "./legajo/paneles/PanelPago";
import { PanelPresentacion } from "./legajo/paneles/PanelPresentacion";
import { PanelDeclaracion } from "./legajo/paneles/PanelDeclaracion";
import { EtapaFuentes } from "./legajo/etapas/EtapaFuentes";
import { EtapaSaldos } from "./legajo/etapas/EtapaSaldos";
import { rangoMesAnterior } from "./legajo/saldosArrastre";
import { EtapaCalculo } from "./legajo/etapas/EtapaCalculo";
import {
  cuerpoCalculo,
  motivoSeleccionCalculo,
  cambiosDesdeCalculo,
  seleccionHabitual,
  type SeleccionCalculo,
} from "./legajo/etapas/seleccionCalculo";

type CuerpoCalculo = { obligationIds?: string[]; minimums?: Record<string, string> };
import { EtapaClasificacion } from "./legajo/etapas/EtapaClasificacion";
import { cambiosDeActividadDelMes } from "./fiscal/historialActividades";
import type { ClientActivityLink } from "./fiscal/utilidades";
import { EtapaControles } from "./legajo/etapas/EtapaControles";
import { EtapaCierre } from "./legajo/etapas/EtapaCierre";
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

// Estados en los que el legajo admite cambios de fuentes (importar lotes o libros, revisar).
const ESTADOS_EDITABLES_FUENTES = [
  "DRAFT",
  "COLLECTING_INPUTS",
  "READY_TO_CALCULATE",
  "CHANGES_REQUESTED",
];

// Clasificar y excluir: además de preparar, se admite con el mes calculado (vuelve a preparación).
const ESTADOS_EDITABLES_CLASIFICACION = [...ESTADOS_EDITABLES_FUENTES, "CALCULATED"];
// Reemplazar, retirar o revisar un archivo: también con el mes calculado. El cálculo queda desactualizado y hay que recalcular.
const ESTADOS_CON_FUENTES_VIGENTES = [...ESTADOS_EDITABLES_FUENTES, "CALCULATED"];

/** Error de una acción: solo ocupa lugar en la barra si hay un error que mostrar (P4). */
function errorDe(error: Error | null | undefined, clave: string) {
  return error ? <WorkpaperActionError key={clave} error={error} /> : null;
}

// Permisos que escriben en el legajo: una revisión anterior en solo lectura no los conserva (A29).
const PERMISOS_DE_ESCRITURA_LEGAJO = [
  "tax.settlements.calculate",
  "tax.settlements.submit_review",
  "tax.settlements.review",
  "tax.settlements.finalize",
  "tax.settlements.rectify",
  "tax.vouchers.prepare",
  "tax.vouchers.review",
  "tax.filings.record",
  "tax.payments.record",
];

function sinPermisosDeEscritura(permisos: ReadonlySet<string>) {
  return new Set(
    [...permisos].filter((permiso) => !PERMISOS_DE_ESCRITURA_LEGAJO.includes(permiso)),
  );
}

export function StudyExpedienteMensual() {
  const [density] = useDensity();
  const { firmId, clientId, capabilities } = useClientContext();
  const { me } = useSession();
  const currentUserId = me?.userId ?? null;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
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
    motivo: "",
  });
  const [controlResolutions, setControlResolutions] = useState<Record<string, string>>({});
  const [controlEvidence, setControlEvidence] = useState<Record<string, string>>({});
  const [positionAction, setPositionAction] = useState<PositionAction>(null);
  const [seleccionCalculo, setSeleccionCalculo] = useState<{
    workpaperId: string;
    seleccion: SeleccionCalculo;
  } | null>(null);
  // 4K: el pedido con el que se calculó por última vez (en esta pantalla). Si la selección cambia, el resultado queda desactualizado.
  const [calculoAplicado, setCalculoAplicado] = useState<{
    workpaperId: string;
    cuerpo: CuerpoCalculo;
  } | null>(null);
  const [sourceCode, setSourceCode] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [classificationDrafts, setClassificationDrafts] = useState<
    Record<string, { categoryCode: string; activityCode: string }>
  >({});
  const [allocationDrafts, setAllocationDrafts] = useState<Record<string, string>>({});
  // «Recordar para este proveedor/cliente»: vale para el próximo guardado de la etapa Clasificación.
  const [rememberRule, setRememberRule] = useState(false);
  // Panel de libros IVA: lado de la fila desde la que se abrió (null = cerrado).
  const [libroIvaAbierto, setLibroIvaAbierto] = useState<{ lado: "SALE" | "PURCHASE"; replacesBatchId?: string } | null>(null);
  // Revisión elegida en el menú «Revisión» (null = la más reciente) y cajón «Exportar libros».
  const [revisionElegidaId, setRevisionElegidaId] = useState<string | null>(null);
  const [exportarAbierto, setExportarAbierto] = useState(false);
  // Contenido de la etapa: recibe el foco al elegir «Ir a la revisión» en una revisión anterior (Barra 2e).
  const cuerpoRef = useRef<HTMLDivElement>(null);
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

  // La revisión que se muestra: la más reciente, salvo que se elija una anterior (solo lectura).
  const legajoSeleccionado =
    (listQuery.data ?? []).find((wp) => wp.id === revisionElegidaId) ?? listQuery.data?.[0];
  const activeWorkpaperId = legajoSeleccionado?.id;
  // Mes anterior del legajo: si está finalizado, sus saldos son el arrastre de este mes (etapa Saldos, corte 3E).
  const rangoAnterior = legajoSeleccionado ? rangoMesAnterior(legajoSeleccionado.periodStart) : null;
  const mesAnteriorQuery = useQuery({
    queryKey: ["monthly-workpapers", firmId, clientId, "mes-anterior", rangoAnterior?.desde],
    queryFn: () =>
      api.get<Workpaper[]>(
        `/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers?from=${rangoAnterior?.desde ?? ""}&to=${rangoAnterior?.hasta ?? ""}`,
      ),
    enabled: Boolean(firmId && clientId && rangoAnterior),
  });
  const mesAnteriorCerrado = mesAnteriorQuery.isSuccess
    ? mesAnteriorQuery.data.some((wp) => wp.status === "FINALIZED")
    : undefined;
  // Importar un libro IVA exige el permiso y un legajo editable; el motivo se muestra junto a la acción.
  // En un mes calculado sí se puede marcar o deshacer «Sin movimientos» (vuelve a preparación): la leyenda lo dice.
  const legajoDelPeriodo = legajoSeleccionado;
  const motivoImportarLibro = !capabilities.has("tax.vouchers.prepare")
    ? "Tu rol no puede importar libros IVA."
    : !legajoDelPeriodo || !ESTADOS_CON_FUENTES_VIGENTES.includes(legajoDelPeriodo.status)
      ? legajoDelPeriodo?.status === "IN_REVIEW" || legajoDelPeriodo?.status === "REVIEWED"
        ? "El mes está en revisión. Pedí cambios para modificar sus fuentes."
        : legajoDelPeriodo?.status === "FINALIZED" || legajoDelPeriodo?.status === "SUPERSEDED"
          ? "Para cambiar un mes cerrado, rectificá la liquidación."
          : "El legajo no admite cambios de fuentes en su estado actual."
      : null;
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
  const rulesQuery = useQuery({
    queryKey: ["monthly-workpaper-classification-rules", firmId, clientId, activeWorkpaperId],
    queryFn: () =>
      api.get<ClassificationRule[]>(
        `/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${activeWorkpaperId}/classification-rules`,
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
  const dueDateForSelectedTax = selectedTaxPeriod
    ? (positionQuery.data ?? [])
        .filter((position) => position.regime.taxType.id === selectedTaxPeriod.taxTypeId)
        .map((position) => position.dueDate)
        .filter((dueDate): dueDate is string => dueDate !== null)
        .sort()[0] ?? null
    : null;
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
      api.get<ClientActivityLink[]>(
        `/firms/${firmId}/clients/${clientId}/activities`,
      ),
    enabled: Boolean(firmId && clientId),
  });
  // Brief 4L: un cambio de actividad que empieza en el mes del legajo se avisa (informativo, no bloquea).
  const cambiosDelMes = legajoSeleccionado
    ? cambiosDeActividadDelMes(clientActivitiesQuery.data ?? [], legajoSeleccionado.periodStart)
    : [];
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


  // Impuestos marcados para liquidar este mes: por defecto el perfil habitual (Brief 3C).
  const seleccionDe = (workpaperId: string): SeleccionCalculo =>
    seleccionCalculo?.workpaperId === workpaperId
      ? seleccionCalculo.seleccion
      : seleccionHabitual(calculationQuery.data ?? []);
  const actualizarSeleccion = (workpaperId: string, seleccion: SeleccionCalculo) =>
    setSeleccionCalculo({ workpaperId, seleccion });
  // Sin impuestos cargados todavía, el pedido va sin selección: calcula todos (comportamiento anterior).
  const cuerpoDe = (workpaperId: string): CuerpoCalculo =>
    calculationQuery.isSuccess
      ? cuerpoCalculo(calculationQuery.data ?? [], seleccionDe(workpaperId))
      : {};

  const calculateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: CuerpoCalculo }) =>
      api.post(`/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${id}/calculate`, body),
    onSuccess: (_data, variables) => {
      setCalculoAplicado({ workpaperId: variables.id, cuerpo: variables.body });
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
    mutationFn: async ({ replacesBatchId }: { replacesBatchId?: string }) => {
      const source = coverageQuery.data?.sources.find((item) => item.code === sourceCode);
      if (!source || !sourceFile || !activeWorkpaperId || !clientQuery.data) {
        throw new Error("Seleccioná una fuente y un archivo antes de importar");
      }
      // Las fechas del archivo se comparan con el período de la fuente (no con el de otro impuesto).
      const periodoDeLaFuente =
        taxPeriodsQuery.data?.find((taxPeriod) => taxPeriod.id === source.periodId) ?? selectedTaxPeriod;
      return importarLoteFuente({
        firmId,
        clientId,
        source,
        file: sourceFile,
        workpaperId: activeWorkpaperId,
        clientCuit: clientQuery.data.cuit,
        fuentes: coverageQuery.data?.sources ?? [],
        ...(replacesBatchId ? { replacesBatchId } : {}),
        ...(periodoDeLaFuente
          ? {
              periodo: {
                startDate: periodoDeLaFuente.startDate,
                endDate: periodoDeLaFuente.endDate,
              },
            }
          : {}),
      });
    },
    onSuccess: () => {
      setSourceFile(null);
      void queryClient.invalidateQueries({
        queryKey: ["monthly-workpaper-coverage", firmId, clientId],
      });
    },
    onError: (error) => {
      if (error instanceof LoteConFilasObservadas) {
        void queryClient.invalidateQueries({
          queryKey: ["monthly-workpaper-coverage", firmId, clientId],
        });
      }
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

  const noMovementsMutation = useMutation({
    mutationFn: ({ sourceCode, marcar }: { sourceCode: string; marcar: boolean }) => {
      const ruta = `/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${activeWorkpaperId}/sources/${sourceCode}/no-movements`;
      return marcar ? api.put(ruta) : api.del(ruta);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpaper-coverage", firmId, clientId] });
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpaper-calculation", firmId, clientId] });
    },
  });

  // Cambiar clasificaciones o exclusiones puede devolver el mes calculado a preparación: se releen
  // legajo, cobertura, cálculo y reglas.
  const invalidarClasificacion = () => {
    for (const clave of [
      "monthly-workpaper-classifications",
      "monthly-workpaper-classification-rules",
      "monthly-workpaper-coverage",
      "monthly-workpapers",
      "monthly-workpaper-calculation",
    ]) {
      void queryClient.invalidateQueries({ queryKey: [clave, firmId, clientId] });
    }
  };
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
          ...(rememberRule ? { rememberRule: true } : {}),
        },
      );
    },
    onSuccess: () => invalidarClasificacion(),
  });

  const rutaClasificaciones = `/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${activeWorkpaperId}/classifications`;

  const bulkClassifyMutation = useMutation({
    mutationFn: (bloque: { ids: string[]; categoryCode: string; activityCode: string }) =>
      api.post(`${rutaClasificaciones}/bulk`, {
        classificationIds: bloque.ids,
        ...(bloque.categoryCode ? { categoryCode: bloque.categoryCode } : {}),
        ...(bloque.activityCode ? { activityCode: bloque.activityCode } : {}),
        ...(rememberRule ? { rememberRule: true } : {}),
      }),
    onSuccess: () => invalidarClasificacion(),
  });

  const excludeMutation = useMutation({
    mutationFn: ({ ids, reason }: { ids: string[]; reason: string }) =>
      api.post(`${rutaClasificaciones}/exclude`, { classificationIds: ids, reason }),
    onSuccess: () => invalidarClasificacion(),
  });

  const includeMutation = useMutation({
    mutationFn: ({ ids }: { ids: string[] }) =>
      api.post(`${rutaClasificaciones}/include`, { classificationIds: ids }),
    onSuccess: () => invalidarClasificacion(),
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (rule: ClassificationRule) =>
      api.del(
        `/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${activeWorkpaperId}/classification-rules/${rule.id}`,
      ),
    onSuccess: () => invalidarClasificacion(),
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
      void queryClient.invalidateQueries({ queryKey: ["tax-position", firmId, clientId] });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) =>
      api.post(`/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${id}/review`, {
        approved,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
      void queryClient.invalidateQueries({ queryKey: ["tax-position", firmId, clientId] });
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${id}/finalize`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
      void queryClient.invalidateQueries({ queryKey: ["tax-position", firmId, clientId] });
    },
  });
  const rectifyMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${id}/rectify`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
      void queryClient.invalidateQueries({ queryKey: ["tax-position", firmId, clientId] });
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
  // Grupos «no corresponde al perfil» (corte 4B): excluir o aceptar con motivo, por grupo.
  const grupoPerfilMutation = useMutation({
    mutationFn: ({
      workpaperId,
      grupo,
      accion,
      reason,
    }: {
      workpaperId: string;
      grupo: string;
      accion: "exclude" | "accept";
      reason: string;
    }) =>
      api.post(
        `/firms/${firmId}/clients/${clientId}/monthly-tax-workpapers/${workpaperId}/classifications/profile-groups/${grupo}/${accion}`,
        { reason },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpaper-coverage", firmId, clientId] });
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpaper-classifications", firmId, clientId] });
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
  // Revisión que se muestra: la más reciente salvo que se elija una anterior (solo lectura).
  const seleccionada = legajoSeleccionado;
  const soloLectura = Boolean(vigente && seleccionada && seleccionada.id !== vigente.id);
  const reemplazadaPor = (wp: Workpaper): Workpaper | undefined => {
    const indice = workpapers.findIndex((item) => item.id === wp.id);
    return indice > 0 ? workpapers[indice - 1] : undefined;
  };
  const etapaDesdeUrl = (() => {
    const valor = new URLSearchParams(location.search)
      .get("etapa")
      ?.normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("es-AR");
    const indice = WORKPAPER_STEPS.findIndex((step) =>
      step.title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-AR") === valor,
    );
    return indice >= 0 ? indice : null;
  })();
  const safeActiveStep = Math.min(
    Math.max(vigente ? (etapaDesdeUrl ?? etapaPorLegajo[vigente.id] ?? 0) : 0, 0),
    WORKPAPER_STEPS.length - 1,
  );
  const goToStep = (index: number) => {
    if (!vigente) return;
    setEtapaPorLegajo((values) => ({
      ...values,
      [vigente.id]: Math.min(Math.max(index, 0), WORKPAPER_STEPS.length - 1),
    }));
    const search = new URLSearchParams(location.search);
    search.set("etapa", WORKPAPER_STEPS[index]?.title.toLocaleLowerCase("es-AR") ?? "saldos");
    navigate({ search: `?${search.toString()}` }, { replace: true });
  };

  const renderEtapa = (wp: Workpaper, step: number) => {
    const canEditSources = !soloLectura && ESTADOS_EDITABLES_FUENTES.includes(wp.status);
    const canEditFuentes = !soloLectura && ESTADOS_CON_FUENTES_VIGENTES.includes(wp.status);
    // En solo lectura, ninguna etapa conserva un permiso que escriba: la revisión anterior no ofrece acciones que escriban (A29).
    const capacidades = soloLectura ? sinPermisosDeEscritura(capabilities) : capabilities;
    // Sin movimientos (corte 2A): además de los estados de cargar archivos, se marca con el mes ya calculado (vuelve a preparación).
    const motivoSinMovimientos = soloLectura
      ? "Esta revisión se consulta en solo lectura."
      : !capacidades.has("tax.vouchers.prepare")
        ? "Tu rol no puede cargar archivos ni marcar fuentes."
        : ![...ESTADOS_EDITABLES_FUENTES, "CALCULATED"].includes(wp.status)
          ? "El legajo no admite cambios de fuentes en su estado actual."
          : null;
    // Saldos consulta por cliente y por período (tax-credit-ledger, tax-position): la revisión anterior muestra la misma tabla, en solo lectura.
    if (soloLectura && step === 0) {
      return (
        <EtapaSaldos
          capabilities={capacidades}
          ledgerQuery={ledgerQuery}
          setEditingLot={setEditingLot}
          setEditForm={setEditForm}
          fraseRevision="Saldos vigentes del cliente y del período; no se guardan por revisión."
          periodoInicio={wp.periodStart}
          mesAnteriorCerrado={mesAnteriorCerrado}
          legajoFinalizado={wp.status === "FINALIZED"}
        />
      );
    }
    // Fuentes, Clasificación, Cálculo y Controles consultan por el id del legajo y muestran la revisión elegida en solo lectura.
    return (
      <>
        {step === 0 ? (
          <EtapaSaldos
            capabilities={capabilities}
            ledgerQuery={ledgerQuery}
            setEditingLot={setEditingLot}
            setEditForm={setEditForm}
            periodoInicio={wp.periodStart}
            mesAnteriorCerrado={mesAnteriorCerrado}
            legajoFinalizado={wp.status === "FINALIZED"}
          />
        ) : step === 1 ? (
          <EtapaFuentes
            coverageQuery={coverageQuery}
            workpaperId={activeWorkpaperId ?? null}
            capabilities={capacidades}
            canEditSources={canEditFuentes}
            calculado={wp.status === "CALCULATED"}
            currentUserId={currentUserId}
            soloLectura={soloLectura}
            motivoImportarLibro={motivoImportarLibro}
            onAbrirLibroIva={(lado, replacesBatchId) => setLibroIvaAbierto({ lado, ...(replacesBatchId ? { replacesBatchId } : {}) })}
            sourceCode={sourceCode}
            setSourceCode={setSourceCode}
            sourceFile={sourceFile}
            setSourceFile={setSourceFile}
            sourceUploadMutation={sourceUploadMutation}
            reviewSourceMutation={reviewSourceMutation}
            noMovementsMutation={noMovementsMutation}
            motivoSinMovimientos={motivoSinMovimientos}
          />
        ) : step === 2 ? (
          <div>
          {cambiosDelMes.map((cambio) => (
            <Notice key={`${cambio.de}-${cambio.a}`} tone="info" title={`Desde ${cambio.desde} cambió la actividad de ${cambio.de} a ${cambio.a}: cambia la alícuota`}>
              <p className="muted-copy">Es informativo y no bloquea el cálculo. Revisá la clasificación de las ventas de ese mes.</p>
            </Notice>
          ))}
          <EtapaClasificacion
            capabilities={capabilities}
            canEditSources={canEditSources}
            classificationQuery={classificationQuery}
            allocationQuery={allocationQuery}
            jurisdictionsQuery={jurisdictionsQuery}
            activityOptions={activityOptions}
            classificationDrafts={classificationDrafts}
            setClassificationDrafts={setClassificationDrafts}
            allocationDrafts={allocationDrafts}
            setAllocationDrafts={setAllocationDrafts}
            classifyVoucherMutation={classifyVoucherMutation}
            reallocateInputMutation={reallocateInputMutation}
            canEditClassifications={!soloLectura && ESTADOS_EDITABLES_CLASIFICACION.includes(wp.status)}
            motivoClasificacionBloqueada={
              soloLectura
                ? null
                : wp.status === "FINALIZED" || wp.status === "SUPERSEDED"
                  ? "Para cambiar un mes cerrado, rectificá la liquidación."
                  : wp.status === "IN_REVIEW" || wp.status === "REVIEWED"
                    ? "El mes está en revisión. Pedí cambios para modificar sus clasificaciones."
                    : null
            }
            rememberRule={rememberRule}
            setRememberRule={setRememberRule}
            rulesQuery={rulesQuery}
            bulkClassifyMutation={bulkClassifyMutation}
            excludeMutation={excludeMutation}
            includeMutation={includeMutation}
            deleteRuleMutation={deleteRuleMutation}
          />
          </div>
        ) : step === 3 ? (
          <EtapaCalculo
            capabilities={capacidades}
            workpaperId={wp.id}
            calculationQuery={calculationQuery}
            positionQuery={positionQuery}
            calculateInterestMutation={calculateInterestMutation}
            setPositionAction={setPositionAction}
            seleccion={seleccionDe(wp.id)}
            onSeleccionChange={(seleccion) => actualizarSeleccion(wp.id, seleccion)}
            bloqueoSeleccion={
              wp.status === "IN_REVIEW"
                ? "Está en revisión: solicitá cambios para modificar los impuestos o el mínimo."
                : null
            }
          />
        ) : step === 4 ? (
          <EtapaControles
            capabilities={capacidades}
            wp={wp}
            controlResolutions={controlResolutions}
            setControlResolutions={setControlResolutions}
            controlEvidence={controlEvidence}
            setControlEvidence={setControlEvidence}
            documentsQuery={documentsQuery}
            resolveControlMutation={resolveControlMutation}
            grupoPerfilMutation={grupoPerfilMutation}
            confirmar={confirmar}
          />
        ) : (
          <EtapaCierre
            wp={wp}
            canFinalize={capacidades.has("tax.settlements.finalize") && !(currentUserId && wp.preparedByUserId === currentUserId && coverageQuery.data?.allowSelfReview === false)}
            canRectify={capacidades.has("tax.settlements.rectify")}
            canFile={capacidades.has("tax.filings.record")}
            canDeclare={capacidades.has("tax.filings.record")}
            canPay={capacidades.has("tax.payments.record")}
            hasFiling={(positionQuery.data ?? []).some((position) => Boolean(position.filingId))}
            hasDeclaration={(positionQuery.data ?? []).some((position) => Boolean(position.hasDeclaration))}
            hasPayment={(positionQuery.data ?? []).some((position) => Number(position.paid) > 0)}
            paymentNotRequired={(positionQuery.data ?? []).some((position) => Number(position.totalPayable) <= 0)}
            nextPeriod={new Date(new Date(wp.periodEnd).getTime() + 86400000).toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: "UTC" })}
            nextBalance={positionQuery.data?.find((position) => position.saldoFavorTecnico || position.saldoLibreDisponibilidad)?.saldoFavorTecnico ?? null}
            readOnly={soloLectura}
            onGoToCalculation={() => goToStep(3)}
            onGoToControls={() => goToStep(4)}
            onFinalize={() => confirmar({
              title: "Finalizar el legajo",
              description: "Finalizar congela los datos del período y genera los saldos de cierre para el siguiente. Después, el legajo no se modifica: para corregirlo hay que crear una rectificativa.",
              confirmLabel: "Sí, finalizar",
              onConfirm: () => finalizeMutation.mutate(wp.id),
            })}
            onRectify={() => confirmar({
              title: "Crear rectificativa",
              description: "Abre una revisión nueva del período. La revisión actual queda finalizada y sin cambios.",
              confirmLabel: "Sí, crear rectificativa",
              onConfirm: () => rectifyMutation.mutate(wp.id),
            })}
            onPresentation={() => {
              const position = positionQuery.data?.find((item) => item.settlement?.status === "FINALIZED");
              if (position) setPositionAction({ kind: "FILING", position });
            }}
            onDeclaration={() => {
              const position = positionQuery.data?.find((item) => item.filingId);
              if (position) setPositionAction({ kind: "DECLARATION", position });
            }}
            onPayment={() => {
              const position = positionQuery.data?.find((item) => item.settlement?.status === "FINALIZED");
              if (position) setPositionAction({ kind: "PAYMENT", position });
            }}
          />
        )}
      </>
    );
  };

  const cambiarPeriodo = (id: string) => {
    setTaxPeriodSelection({ key: taxPeriodStorageKey, id });
    setRevisionElegidaId(null);
    if (taxPeriodStorageKey) writeFiscalTaxPeriodSelection(taxPeriodStorageKey, id);
  };
  const opcionesPeriodo = [
    { value: "", label: "Seleccioná un período fiscal…" },
    ...selectableTaxPeriods.map((taxPeriod) => ({
      value: taxPeriod.id,
      label: rotuloPeriodoFiscal(taxPeriod),
    })),
  ];
  const sinPeriodosFiscales = taxPeriodsQuery.isSuccess && selectableTaxPeriods.length === 0;
  const sinLegajo = Boolean(selectedTaxPeriod) && listQuery.isSuccess && workpapers.length === 0;
  const bloqueantesAbiertos =
    vigente?.controls.filter((control) => control.severity === "BLOCKING" && control.status === "OPEN")
      .length ?? 0;
  const estadosEtapas = calcularEstadosEtapas({
    sources: coverageQuery.data?.sources,
    classification: classificationQuery.data,
    calculationCount: calculationQuery.data?.length,
    blockingControls: bloqueantesAbiertos,
    status: vigente?.status,
  });
  const canCalculate = capabilities.has("tax.settlements.calculate");
  const textoSoloLectura =
    seleccionada && soloLectura && reemplazadaPor(seleccionada)
      ? `Revisión ${seleccionada.revision} en solo lectura: fue reemplazada por la revisión ${reemplazadaPor(seleccionada)!.revision}.`
      : null;

  // «Acciones del período»: exportar libros y crear el legajo, con su motivo si no se puede.
  const accionesDelPeriodo: MenuActionItem[] = [
    ...(capabilities.has("tax.vouchers.read")
      ? [
          {
            key: "exportar-libros",
            label: "Exportar libros",
            description: "Abre el panel para elegir libro, formato y columnas.",
            icon: "download" as const,
            disabled: !selectedTaxPeriod,
            disabledReason: selectedTaxPeriod ? undefined : "Elegí un período fiscal para exportar sus libros.",
            onSelect: () => setExportarAbierto(true),
          },
        ]
      : []),
    {
      key: "nuevo-legajo",
      label: "Nuevo legajo",
      description: "Crea el legajo del período elegido.",
      icon: "plus" as const,
      disabled: !selectedTaxPeriod || createMutation.isPending || !canCalculate || soloLectura,
      disabledReason: !selectedTaxPeriod
        ? "Configurá un período fiscal para crear el legajo."
        : !canCalculate
          ? "Tu rol no puede crear legajos."
          : (textoSoloLectura ?? undefined),
      onSelect: () => createMutation.mutate(),
    },
  ];

  // Acciones del legajo según su estado: la misma matriz de hoy, con sus permisos, confirmaciones y textos.
  const armarAccionesLegajo = (wp: Workpaper) => {
    const seleccionReason = calculationQuery.isSuccess
      ? motivoSeleccionCalculo(calculationQuery.data ?? [], seleccionDe(wp.id))
      : null;
    const calculateDisabled =
      calculateMutation.isPending ||
      wp.status !== "READY_TO_CALCULATE" ||
      !canCalculate ||
      seleccionReason !== null;
    const calculateDisabledReason = calculateDisabled
      ? calculationDisabledMessage({
          status: wp.status,
          sources: coverageQuery.data?.sources,
          classifications: classificationQuery.data,
          allocations: allocationQuery.data,
          canCalculate,
          isPending: calculateMutation.isPending,
        }) ?? seleccionReason
      : null;
    const selfReviewBlocked = Boolean(
      currentUserId &&
        wp.preparedByUserId === currentUserId &&
        coverageQuery.data &&
        !coverageQuery.data.allowSelfReview &&
        ((wp.status === "IN_REVIEW" && capabilities.has("tax.settlements.review")) ||
          (wp.status === "REVIEWED" && capabilities.has("tax.settlements.finalize"))),
    );
    const controlesBloqueantes = wp.controls.filter(
      (control) => control.severity === "BLOCKING" && control.status === "OPEN",
    ).length;
    const submitDisabledReason =
      controlesBloqueantes > 0
        ? `Resolvé o eximí los controles que bloquean: quedan ${controlesBloqueantes} ${controlesBloqueantes === 1 ? "abierto" : "abiertos"}.`
        : null;
    const motivos: ReactNode[] = [];
    let accion: ReactNode = null;
    // 4K: cambios del mínimo o de los impuestos respecto del último cálculo aplicado.
    const cambios = cambiosDesdeCalculo(
      cuerpoDe(wp.id),
      calculoAplicado?.workpaperId === wp.id ? calculoAplicado.cuerpo : null,
    );

    if (["DRAFT", "COLLECTING_INPUTS", "READY_TO_CALCULATE"].includes(wp.status)) {
      accion = (
        <Button
          size="sm"
          variant="primary"
          disabled={calculateDisabled}
          title={calculateDisabledReason ?? "Calcular liquidación"}
          onClick={() => void calculateMutation.mutate({ id: wp.id, body: cuerpoDe(wp.id) })}
        >
          Calcular liquidación
        </Button>
      );
      if (calculateDisabledReason) {
        motivos.push(
          <small className="muted-copy" role="status" key="motivo-calcular">
            {calculateDisabledReason}
          </small>,
        );
      }
      motivos.push(errorDe(calculateMutation.variables?.id === wp.id ? calculateMutation.error : null, "error-calcular"));
    }
    if (wp.status === "CHANGES_REQUESTED") {
      accion = (
        <Button
          size="sm"
          variant="primary"
          disabled={calculateMutation.isPending || !canCalculate}
          onClick={() => calculateMutation.mutate({ id: wp.id, body: cuerpoDe(wp.id) })}
        >
          Recalcular
        </Button>
      );
      if (!canCalculate) {
        motivos.push(
          <small className="muted-copy" role="status" key="motivo-recalcular">
            Tu perfil no tiene permiso para recalcular este legajo.
          </small>,
        );
      }
      motivos.push(errorDe(calculateMutation.variables?.id === wp.id ? calculateMutation.error : null, "error-recalcular"));
    }
    const fuentesCambiaron = wp.status === "CALCULATED" && wp.inputHash === null;
    if (wp.status === "CALCULATED" && (cambios.hayCambios || fuentesCambiaron)) {
      const cambio = !cambios.hayCambios
        ? "Cambió una fuente del mes"
        : cambios.minimo && cambios.impuestos
          ? "Cambiaste el mínimo y los impuestos a liquidar"
          : cambios.minimo
            ? "Cambiaste el mínimo"
            : "Cambiaste los impuestos a liquidar";
      accion = (
        <>
          <Button
            size="sm"
            variant="primary"
            disabled={calculateMutation.isPending || !canCalculate || seleccionReason !== null}
            title="Recalcular la liquidación"
            onClick={() => calculateMutation.mutate({ id: wp.id, body: cuerpoDe(wp.id) })}
          >
            Recalcular
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled
            title="Recalculá para habilitar el envío a revisión"
          >
            Enviar a revisión
          </Button>
        </>
      );
      motivos.push(
        <small className="muted-copy" role="status" key="motivo-desactualizado">
          {cambio}: recalculá para actualizar el resultado.
        </small>,
      );
      motivos.push(
        <small className="muted-copy" key="motivo-enviar-recalculo">
          Enviar a revisión se habilita al recalcular.
        </small>,
      );
      if (seleccionReason) {
        motivos.push(
          <small className="muted-copy" role="status" key="motivo-seleccion-recalculo">
            {seleccionReason}
          </small>,
        );
      }
      if (!canCalculate) {
        motivos.push(
          <small className="muted-copy" role="status" key="motivo-recalcular-permiso">
            Tu perfil no tiene permiso para recalcular este legajo.
          </small>,
        );
      }
      motivos.push(
        errorDe(
          calculateMutation.variables?.id === wp.id ? calculateMutation.error : null,
          "error-recalcular-desactualizado",
        ),
      );
    }
    if (wp.status === "CALCULATED" && !cambios.hayCambios && !fuentesCambiaron) {
      accion = (
        <Button
          size="sm"
          variant="primary"
          disabled={
            submitMutation.isPending ||
            !capabilities.has("tax.settlements.submit_review") ||
            submitDisabledReason !== null
          }
          title={submitDisabledReason ?? "Enviar a revisión"}
          onClick={() => void submitMutation.mutate(wp.id)}
        >
          Enviar a revisión
        </Button>
      );
      if (!capabilities.has("tax.settlements.submit_review")) {
        motivos.push(
          <small className="muted-copy" role="status" key="motivo-enviar">
            Tu perfil no tiene permiso para enviar este legajo a revisión.
          </small>,
        );
      }
      if (submitDisabledReason) {
        motivos.push(
          <small className="muted-copy" role="status" key="motivo-bloqueantes">
            {submitDisabledReason}
          </small>,
        );
      }
      motivos.push(errorDe(submitMutation.variables === wp.id ? submitMutation.error : null, "error-enviar"));
    }
    if (wp.status === "IN_REVIEW" && capabilities.has("tax.settlements.review")) {
      accion = (
        <>
          <Button
            size="sm"
            variant="secondary"
            disabled={reviewMutation.isPending || selfReviewBlocked}
            onClick={() => reviewMutation.mutate({ id: wp.id, approved: false })}
          >
            Solicitar cambios
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={reviewMutation.isPending || selfReviewBlocked}
            onClick={() => reviewMutation.mutate({ id: wp.id, approved: true })}
          >
            Aprobar revisión
          </Button>
        </>
      );
      motivos.push(errorDe(reviewMutation.variables?.id === wp.id ? reviewMutation.error : null, "error-revision"));
    }
    if (wp.status === "REVIEWED" && safeActiveStep !== 5) {
      accion = (
        <Button
          size="sm"
          variant="primary"
          disabled={
            finalizeMutation.isPending ||
            !capabilities.has("tax.settlements.finalize") ||
            selfReviewBlocked
          }
          onClick={() =>
            confirmar({
              title: "Finalizar el legajo",
              description:
                "Finalizar congela los datos del período y genera los saldos de cierre para el siguiente. Después, el legajo no se modifica: para corregirlo hay que crear una rectificativa.",
              confirmLabel: "Sí, finalizar",
              onConfirm: () => finalizeMutation.mutate(wp.id),
            })
          }
        >
          Finalizar
        </Button>
      );
      if (!capabilities.has("tax.settlements.finalize")) {
        motivos.push(
          <small className="muted-copy" role="status" key="motivo-finalizar">
            Tu perfil no tiene permiso para finalizar este legajo.
          </small>,
        );
      }
      motivos.push(errorDe(finalizeMutation.variables === wp.id ? finalizeMutation.error : null, "error-finalizar"));
    }
    if (wp.status === "FINALIZED" && safeActiveStep !== 5 && capabilities.has("tax.settlements.rectify")) {
      accion = (
        <Button
          size="sm"
          variant="secondary"
          disabled={rectifyMutation.isPending}
          onClick={() =>
            confirmar({
              title: "Crear rectificativa",
              description:
                "Abre una revisión nueva del período. La revisión actual queda finalizada y sin cambios.",
              confirmLabel: "Sí, crear rectificativa",
              onConfirm: () => rectifyMutation.mutate(wp.id),
            })
          }
        >
          Crear rectificativa
        </Button>
      );
    }
    if (wp.status === "FINALIZED") {
      motivos.push(errorDe(rectifyMutation.variables === wp.id ? rectifyMutation.error : null, "error-rectificar"));
    }
    if (selfReviewBlocked && ["IN_REVIEW", "REVIEWED"].includes(wp.status)) {
      motivos.push(
        <small className="muted-copy" key="autorrevision">
          Para revisar o finalizar este legajo, el Titular puede habilitar la autorrevisión en
          Configuración del estudio.
        </small>,
      );
    }
    return { accion, motivos, nota: selfReviewNote(wp) };
  };

  // Solo la revisión vigente tiene acciones del legajo; una revisión anterior no escribe nada.
  const acciones = vigente && !soloLectura ? armarAccionesLegajo(vigente) : null;
  const motivoEtapaSaldos =
    !soloLectura && vigente && safeActiveStep === 0 && !capabilities.has("tax.settlements.calculate")
      ? "Tu rol no puede cargar saldos iniciales."
      : null;
  const motivosBarra: ReactNode[] = [
    ...(acciones?.motivos ?? []),
    motivoEtapaSaldos ? (
      <small className="muted-copy" role="status" key="motivo-saldos">
        {motivoEtapaSaldos}
      </small>
    ) : null,
    errorDe(createMutation.error, "error-crear"),
  ];
  const motivosVisibles = motivosBarra.filter(Boolean);
  const pedidosDeCambios =
    vigente && !soloLectura ? mensajesDePedidoDeCambios(calculationQuery.data) : [];
  // En una revisión anterior, el aviso ofrece «Ir a la revisión» de la más reciente: misma acción que el desplegable «Revisión» (Barra 2e).
  const irAVigente = () => {
    setRevisionElegidaId(null);
    cuerpoRef.current?.focus();
  };
  const notaBarra = soloLectura ? (
    textoSoloLectura ? (
      <>
        <span>{textoSoloLectura}</span>{" "}
        <Button size="sm" variant="text" onClick={irAVigente}>
          Ir a la revisión {vigente?.revision}
        </Button>
      </>
    ) : null
  ) : (acciones?.nota ?? null);

  // Acciones de la etapa activa: a la derecha de sus pestañas, con sus condiciones de hoy.
  const actualizarBoton = (ocupado: boolean, onClick: () => void, texto: string) => (
    <Button size="sm" variant="ghost" disabled={ocupado} onClick={onClick}>
      {texto}
    </Button>
  );
  let accionesEtapa: ReactNode = null;
  if (vigente && safeActiveStep === 0) {
    accionesEtapa = (
      <>
        {actualizarBoton(
          ledgerQuery.isFetching,
          () => void ledgerQuery.refetch(),
          ledgerQuery.isFetching ? "Actualizando…" : "Actualizar",
        )}
        {soloLectura ? null : (
          <Button
            size="sm"
            variant="secondary"
            disabled={!capabilities.has("tax.settlements.calculate")}
            onClick={() => setShowOpening((visible) => !visible)}
          >
            <Icon name="plus" size={15} /> Cargar saldo inicial
          </Button>
        )}
      </>
    );
  } else if (vigente && safeActiveStep === 1) {
    accionesEtapa = (
      <>
        {actualizarBoton(
          coverageQuery.isFetching,
          () => void coverageQuery.refetch(),
          coverageQuery.isFetching && coverageQuery.isSuccess ? "Actualizando…" : "Actualizar",
        )}
        <Button size="sm" variant="secondary" onClick={() => navigate("/bandeja")}>
          Ir a bandeja
        </Button>
      </>
    );
  } else if (vigente && safeActiveStep === 2) {
    const actualizandoClasificacion = classificationQuery.isFetching || allocationQuery.isFetching;
    accionesEtapa = (
      <>
        {actualizarBoton(
          actualizandoClasificacion,
          () => void Promise.all([classificationQuery.refetch(), allocationQuery.refetch()]),
          actualizandoClasificacion ? "Actualizando…" : "Actualizar",
        )}
        <Button size="sm" variant="secondary" onClick={() => navigate("/configuracion-fiscal")}>
          Ver configuración fiscal
        </Button>
      </>
    );
  } else if (vigente && safeActiveStep === 3) {
    const actualizandoCalculo = positionQuery.isFetching || calculationQuery.isFetching;
    accionesEtapa = actualizarBoton(
      actualizandoCalculo,
      () => void Promise.all([positionQuery.refetch(), calculationQuery.refetch()]),
      actualizandoCalculo ? "Actualizando…" : "Actualizar",
    );
  }

  const contexto = (
    <>
      {selectableTaxPeriods.length > 0 ? (
        <BarSelect
          label="Período fiscal"
          options={opcionesPeriodo}
          value={selectedTaxPeriodId}
          onChange={(event) => cambiarPeriodo(event.target.value)}
        />
      ) : null}
      {selectedTaxPeriod ? (
        <span className="muted-copy" aria-live="polite">
          {positionQuery.isLoading ? (
            "Cargando vencimiento…"
          ) : dueDateForSelectedTax ? (
            `Vence el ${formatearFecha(dueDateForSelectedTax)}`
          ) : (
            <>
              Sin vencimiento cargado{" "}
              <Button size="sm" variant="text" onClick={() => navigate("/calendarios-fiscales")}>
                Calendarios
              </Button>
            </>
          )}
        </span>
      ) : null}
      <Menu kind="actions" label="Acciones del período" trigger="Acciones del período" items={accionesDelPeriodo} />
      {seleccionada ? (
        <>
          <span className="work-bar__separador" aria-hidden="true" />
          <Menu
            kind="select"
            label="Revisiones del período"
            trigger={`Revisión ${seleccionada.revision}`}
            value={seleccionada.id}
            options={workpapers.map((wp, indice) => ({
              key: wp.id,
              label: `Revisión ${wp.revision}`,
              status: <StatusBadge status={wp.status} variant="plain" />,
              secondary:
                indice === 0
                  ? "la más reciente"
                  : `reemplazada por la revisión ${workpapers[indice - 1]!.revision} · solo lectura`,
            }))}
            onChange={(key) => setRevisionElegidaId(key === vigente?.id ? null : key)}
          />
          <StatusBadge status={seleccionada.status} variant="plain" />
        </>
      ) : null}
      {sinLegajo ? <span className="muted-copy">Sin legajo en este período</span> : null}
      {sinPeriodosFiscales ? <span className="muted-copy">Sin períodos fiscales</span> : null}
    </>
  );

  const pestanas = WORKPAPER_STEPS.map((step, indice) => ({
    id: String(indice),
    description: `Estado: ${estadosEtapas[indice]?.estado ?? "No disponible todavía"}`,
    status: `${estadosEtapas[indice]?.estado === "Lista" ? "✓" : estadosEtapas[indice]?.estado === "Con pendientes" ? "!" : "·"} ${estadosEtapas[indice]?.estado ?? "No disponible todavía"}`,
    label: (
      <>
        {step.title}
        {indice === 4 && bloqueantesAbiertos > 0 ? (
          <span className="workpaper-bloqueos" title={pluralizar(bloqueantesAbiertos, "control bloqueante abierto", "controles bloqueantes abiertos")}>
            <span className="workpaper-bloqueos__punto" aria-hidden="true" />
            {bloqueantesAbiertos}{" "}
            <span className="sr-only">{bloqueantesAbiertos === 1 ? "bloqueante abierto" : "bloqueantes abiertos"}</span>
          </span>
        ) : null}
      </>
    ),
  }));

  const barra = (
    <WorkBar
      label="Legajo: período, revisión, etapas y acciones"
      context={contexto}
      action={acciones?.accion ?? null}
      note={notaBarra}
      reason={motivosVisibles.length > 0 ? motivosVisibles : null}
      sections={
        vigente ? (
          <DenseTabs
            label="Etapas del legajo"
            idPrefix="workpaper"
            tabs={pestanas}
            active={String(safeActiveStep)}
            onChange={(id) => goToStep(Number(id))}
          />
        ) : null
      }
      sectionActions={accionesEtapa}
    />
  );

  let cuerpo: ReactNode;
  if (taxPeriodsQuery.isLoading) {
    cuerpo = (
      <AsyncState
        loading
        error={false}
        loadingLabel="Cargando períodos fiscales…"
        errorTitle=""
        errorDescription=""
        onRetry={() => void taxPeriodsQuery.refetch()}
      />
    );
  } else if (taxPeriodsQuery.isError) {
    cuerpo = (
      <AsyncState
        loading={false}
        error
        loadingLabel="Cargando períodos fiscales…"
        errorTitle="No se pudieron cargar los períodos fiscales"
        errorDescription="Reintentá la consulta para volver a cargar los períodos del cliente."
        onRetry={() => void taxPeriodsQuery.refetch()}
      />
    );
  } else if (selectableTaxPeriods.length === 0) {
    cuerpo = (
      <EmptyState
        title="Configurá un período fiscal"
        description="El legajo organiza las obligaciones del mes seleccionado."
        action={
          <Button variant="secondary" onClick={() => navigate("/configuracion-fiscal")}>
            Abrir configuración fiscal
          </Button>
        }
      />
    );
  } else if (!selectedTaxPeriod) {
    cuerpo = (
      <EmptyState
        title="Elegí un período fiscal"
        description="Seleccioná un período fiscal para consultar o crear el legajo del mes."
      />
    );
  } else if (listQuery.isLoading) {
    cuerpo = (
      <AsyncState
        loading
        error={false}
        loadingLabel="Cargando legajos…"
        errorTitle=""
        errorDescription=""
        onRetry={() => void listQuery.refetch()}
      />
    );
  } else if (listQuery.isError) {
    cuerpo = (
      <AsyncState
        loading={false}
        error
        loadingLabel="Cargando legajos…"
        errorTitle="No se pudieron cargar los legajos"
        errorDescription="Reintentá en un momento."
        onRetry={() => void listQuery.refetch()}
      />
    );
  } else if (!seleccionada) {
    cuerpo = listQuery.isSuccess ? (
      <PeriodoSinLegajo
        puedeCrear={canCalculate}
        creando={createMutation.isPending}
        onCrear={() => createMutation.mutate()}
      />
    ) : null;
  } else {
    cuerpo = (
      <>
        {pedidosDeCambios.length > 0 ? (
          <Notice
            className="workpaper-pedido"
            tone="warning"
            title={getStatusBadgeMeta("CHANGES_REQUESTED").label}
          >
            {pedidosDeCambios.map((mensaje, indice) => (
              <p key={indice}>{mensaje}</p>
            ))}
          </Notice>
        ) : null}
        <div
          ref={cuerpoRef}
          className="workpaper-body"
          id="workpaper-panel"
          role="tabpanel"
          tabIndex={-1}
          aria-labelledby={`workpaper-${safeActiveStep}`}
          aria-live="polite"
        >
          {safeActiveStep < 5 && estadosEtapas[safeActiveStep]?.mensaje ? (
            <div className="workpaper-stage-guidance" role="status">
              <p>{estadosEtapas[safeActiveStep]?.mensaje}.</p>
              {estadosEtapas[safeActiveStep]?.accion ? (
                <Button size="sm" variant="secondary" onClick={() => goToStep(estadosEtapas[safeActiveStep]!.destino)}>
                  {estadosEtapas[safeActiveStep]!.accion}
                </Button>
              ) : null}
            </div>
          ) : null}
          {renderEtapa(seleccionada, safeActiveStep)}
        </div>
      </>
    );
  }

  return (
    <>
      <WorkPage bar={barra}>
        <DensePage density={density}>
          <h1 className="sr-only">Legajo</h1>
          {firmId && clientId ? (
            <TarjetaMonotributo
              firmId={firmId}
              clientId={clientId}
              month={selectedTaxPeriod?.startDate ? selectedTaxPeriod.startDate.slice(0, 7) : mesActualMonotributo()}
              puedePagar={capabilities.has("tax.payments.record") && !soloLectura}
            />
          ) : null}
          {cuerpo}
          <CommentThread
            firmId={firmId}
            clientId={clientId}
            periodLabel={selectedTaxPeriod ? fiscalTaxPeriodLabel(selectedTaxPeriod) : null}
          />
        </DensePage>
      </WorkPage>

      <FiscalBooksExportAction
        periodId={selectedTaxPeriod?.id ?? null}
        periodLabel={
          selectedTaxPeriod
            ? `${selectedTaxPeriod.taxType.name} · ${fiscalTaxPeriodLabel(selectedTaxPeriod)}`
            : null
        }
        abierto={exportarAbierto}
        onCerrar={() => setExportarAbierto(false)}
      />

      <PanelLibrosIva
        abierto={libroIvaAbierto !== null}
        ladoInicial={libroIvaAbierto?.lado ?? null}
        replacesBatchId={libroIvaAbierto?.replacesBatchId}
        onCerrar={() => setLibroIvaAbierto(null)}
        firmId={firmId}
        clientId={clientId}
        activeWorkpaperId={activeWorkpaperId}
        fuentes={coverageQuery.data?.sources}
        cuitCliente={clientQuery.data?.cuit}
        motivoBloqueo={motivoImportarLibro}
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

      {positionAction?.kind === "DECLARATION" ? (
        <PanelDeclaracion
          posicion={positionAction.position}
          onCerrar={() => setPositionAction(null)}
          firmId={firmId}
          clientId={clientId}
          documentsQuery={documentsQuery}
        />
      ) : null}

      <ConfirmDialog confirm={confirmacionEstable} />
    </>
  );
}
