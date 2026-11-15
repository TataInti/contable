import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AsyncState, Button, ConfirmDialog, EmptyState, useConfirmAction, useNotify } from "@contable/design-system";
import {
  type CatalogEconomicActivity,
  type TaxRuleKindOption,
} from "@contable/contracts";
import type { TaxEngineOption } from "@contable/contracts";
import { ApiError, api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { DeletionDrawer } from "../ui/DeletionDrawer";
import { RuleSimulator } from "./RuleSimulator";
import type {
  Credential,
  RuleJurisdictionOption,
  RulePack,
  RulePackDetail,
  RuleRegimeOption,
  RuleRow,
  RuleStatus,
  RuleVersion,
} from "./reglas/tipos";
import { sameRuleRows, today } from "./reglas/utilidades";
import { ListaPaquetes } from "./reglas/ListaPaquetes";
import { PanelNuevoPaquete } from "./reglas/paneles/PanelNuevoPaquete";
import { PanelVencimiento } from "./reglas/paneles/PanelVencimiento";
import { PanelFuente } from "./reglas/paneles/PanelFuente";
import { PanelPrimeraVersion } from "./reglas/paneles/PanelPrimeraVersion";
import { PanelModificarAlicuotas } from "./reglas/paneles/PanelModificarAlicuotas";
import { ConfirmarActivacion } from "./reglas/ConfirmarActivacion";
import { TabVencimientos } from "./reglas/TabVencimientos";
import { FRECUENCIA_POR_DEFECTO } from "./reglas/frecuencias";
import { TabFuentes } from "./reglas/TabFuentes";
import { TabControlProfesional } from "./reglas/TabControlProfesional";
import { ResumenVersion } from "./reglas/ResumenVersion";
import { AlicuotasEditor } from "./reglas/AlicuotasEditor";
import { Icon } from "../ui/Icon";
import {
  DenseHeader,
  DensePage,
  DenseTabs,
  StatStrip,
  useDenseShortcuts,
  useDensity,
} from "../ui/Dense";
import "./study.css";

export function StudyReglasFiscales() {
  const { firmId, capabilities } = useClientContext();
  const queryClient = useQueryClient();
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [ruleTab, setRuleTab] = useState<"rates" | "dueDates" | "sources" | "approval" | "simulate">("rates");
  const [packSearch, setPackSearch] = useState("");
  const [packFilter, setPackFilter] = useState<"" | "ACTIVE" | "DRAFT" | "IN_REVIEW">("");
  const [density] = useDensity();
  const searchRef = useRef<HTMLInputElement>(null);
  const [deletingTarget, setDeletingTarget] = useState<{
    path: string;
    kind: "pack" | "version";
  } | null>(null);
  const [validFrom, setValidFrom] = useState(today);
  const [versionDateError, setVersionDateError] = useState<string | null>(null);
  const [credentialId, setCredentialId] = useState("");
  const [draftRows, setDraftRows] = useState<RuleRow[]>([]);
  const [draftRowsVersionId, setDraftRowsVersionId] = useState<string | null>(null);
  const notify = useNotify();
  const confirm = useConfirmAction();
  const [activationError, setActivationError] = useState<Error | null>(null);
  const activationFeedbackRef = useRef<HTMLDivElement | null>(null);
  const [activationTarget, setActivationTarget] = useState<RuleVersion | null>(null);
  const [showPackForm, setShowPackForm] = useState(false);
  const [showSourceForm, setShowSourceForm] = useState(false);
  const [showDueDateForm, setShowDueDateForm] = useState(false);
  const [showInitialVersionForm, setShowInitialVersionForm] = useState(false);
  const [showCloneForm, setShowCloneForm] = useState(false);
  // Errores 409 del servidor por código de actividad (ACTIVITY_CODE_*): se
  // marcan las filas del borrador cuyo código coincide con el del mensaje.
  const [rowFieldErrors, setRowFieldErrors] = useState<Record<string, string>>({});
  const [newPack, setNewPack] = useState({ code: "", name: "", regimeId: "" });
  const [engineId, setEngineId] = useState("");
  const [newSource, setNewSource] = useState({
    title: "",
    reference: "",
    url: "",
    consultedAt: today,
  });
  const [newDueDate, setNewDueDate] = useState({
    frequency: FRECUENCIA_POR_DEFECTO,
    dueDay: "",
    cuitEnding: "",
    validFrom: today,
  });

  useEffect(() => {
    if (!activationError || !activationFeedbackRef.current) return;
    activationFeedbackRef.current.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    activationFeedbackRef.current.focus();
  }, [activationError]);

  const packsQuery = useQuery({
    queryKey: ["tax-rule-packs", firmId],
    queryFn: () => api.get<RulePack[]>("/tax/rule-packs"),
    enabled: Boolean(firmId && capabilities.has("tax.rules.read")),
  });

  useEffect(() => {
    if (!selectedPackId && packsQuery.data?.[0]) setSelectedPackId(packsQuery.data[0].id);
  }, [packsQuery.data, selectedPackId]);

  const detailQuery = useQuery({
    queryKey: ["tax-rule-pack", selectedPackId],
    queryFn: () => api.get<RulePackDetail>(`/tax/rule-packs/${selectedPackId}`),
    enabled: Boolean(selectedPackId),
  });
  const regimeEnginesQuery = useQuery({
    queryKey: ["tax-regime-engines", detailQuery.data?.regime.id],
    queryFn: () => {
      const regimeId = detailQuery.data?.regime.id;
      if (!regimeId) throw new Error("No se encontró el régimen del paquete.");
      return api.get<TaxEngineOption[]>(`/tax/regimes/${regimeId}/engines`);
    },
    enabled: Boolean(showInitialVersionForm && detailQuery.data?.regime.id && detailQuery.data.regime.calcFamilyId),
  });
  const credentialQuery = useQuery({
    queryKey: ["tax-credentials", firmId],
    queryFn: () => api.get<Credential[]>("/tax/credentials"),
    enabled: capabilities.has("tax.rules.approve"),
  });
  const regimesQuery = useQuery({
    queryKey: ["tax-regimes"],
    queryFn: () => api.get<RuleRegimeOption[]>("/tax/regimes"),
    enabled: capabilities.has("tax.rules.propose"),
  });
  // Se leen ambas vigencias para identificar el código asignado oculto; el
  // selector sólo ofrece actividades activas.
  const activitiesQuery = useQuery({
    queryKey: ["tax-activities", firmId],
    queryFn: () => api.get<CatalogEconomicActivity[]>("/tax/activities?includeInactive=true"),
    enabled: Boolean(firmId && capabilities.has("tax.rules.read")),
  });
  const jurisdictionsQuery = useQuery({
    queryKey: ["tax-rule-jurisdictions"],
    queryFn: () => api.get<RuleJurisdictionOption[]>("/tax/jurisdictions?includeInactive=true"),
    enabled: Boolean(firmId && capabilities.has("tax.rules.read")),
  });
  const ruleKindsQuery = useQuery({
    queryKey: ["tax-rule-kinds", detailQuery.data?.regime.id],
    queryFn: () => api.get<TaxRuleKindOption[]>(`/tax/regimes/${detailQuery.data?.regime.id}/rule-kinds`),
    enabled: Boolean(detailQuery.data?.regime.id && detailQuery.data.regime.calcFamilyId),
  });

  const selectedVersion = useMemo(
    () => {
      const versions = detailQuery.data?.versions ?? [];
      return versions.find((version) => version.id === selectedVersionId) ??
        versions.find((version) => version.status === "DRAFT") ??
        versions.find((version) => version.status === "IN_REVIEW") ??
        versions.find((version) => version.status === "APPROVED") ??
        versions[0];
    },
    [detailQuery.data, selectedVersionId],
  );

  useEffect(() => {
    setSelectedVersionId(null);
  }, [selectedPackId]);
  useEffect(() => {
    setEngineId(regimeEnginesQuery.data?.[0]?.id ?? "");
  }, [regimeEnginesQuery.data, selectedPackId]);

  // Versión activa del paquete: se muestra junto al borrador para que quede
  // claro qué versión se está editando y cuál sigue aplicando a los cálculos.
  const activeVersion = useMemo(
    () => detailQuery.data?.versions.find((version) => version.status === "ACTIVE"),
    [detailQuery.data],
  );
  const canDeletePack = Boolean(
    firmId &&
    capabilities.has("data.delete") &&
    detailQuery.data?.origin === "UI" &&
    detailQuery.data.createdByFirmId === firmId &&
    detailQuery.data.status === "DRAFT" &&
    detailQuery.data.versions.every((version) => version.status === "DRAFT"),
  );
  // Primer aviso: explica qué se pierde. El cajón que sigue muestra el impacto real
  // y pide escribir el nombre, así que borrar un paquete son dos confirmaciones.
  const requestPackDeletion = () => {
    if (!firmId || !selectedPackId) return;
    const path = `/firms/${firmId}/tax/rule-packs/${selectedPackId}`;
    confirm.ask({
      title: detailQuery.data ? `¿Eliminar el paquete ${detailQuery.data.name}?` : "¿Eliminar el paquete?",
      description:
        "Se borran el paquete y todos sus borradores: alícuotas, vencimientos y fuentes cargadas. No se puede deshacer. En el paso siguiente vas a ver qué se elimina y tenés que escribir el nombre para confirmar.",
      confirmLabel: "Continuar",
      tone: "danger",
      onConfirm: () => setDeletingTarget({ path, kind: "pack" }),
    });
  };
  const canDeleteVersion = Boolean(
    firmId &&
    capabilities.has("data.delete") &&
    selectedVersion?.origin === "UI" &&
    selectedVersion.createdByFirmId === firmId &&
    selectedVersion.status === "DRAFT",
  );

  useEffect(() => {
    const selectedDraft = selectedVersion?.status === "DRAFT" ? selectedVersion : null;
    setDraftRows(selectedDraft?.rateRules ?? []);
    setDraftRowsVersionId(selectedDraft?.id ?? null);
  }, [selectedVersion?.id]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["tax-rule-packs", firmId] });
    void queryClient.invalidateQueries({ queryKey: ["tax-rule-pack", selectedPackId] });
  };


  const cloneMutation = useMutation({
    mutationFn: () => api.post(`/tax/rule-packs/${selectedPackId}/versions/clone`, { validFrom }),
    onSuccess: () => {
      invalidate();
      setShowCloneForm(false);
      // El borrador nuevo pasa a ser la versión seleccionada y se lleva al
      // usuario a las alícuotas, que es lo que vino a modificar.
      setSelectedVersionId(null);
      setRuleTab("rates");
      notify.success("Se abrió un borrador con las alícuotas vigentes. Editá los valores y guardá; la versión anterior sigue aplicando hasta que actives la nueva.");
      window.setTimeout(() => {
        document.getElementById("rule-rates-title")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      }, 0);
    },
  });
  const createPackMutation = useMutation({
    mutationFn: () =>
      api.post<RulePack>("/tax/rule-packs", {
        code: newPack.code.trim(),
        name: newPack.name.trim(),
        regimeId: newPack.regimeId,
      }),
    onSuccess: (pack) => {
      void queryClient.invalidateQueries({ queryKey: ["tax-rule-packs", firmId] });
      setSelectedPackId(pack.id);
      setNewPack({ code: "", name: "", regimeId: "" });
      setShowPackForm(false);
      notify.success("El paquete quedó creado. Ahora podés iniciar su primera versión.");
    },
  });
  const createVersionMutation = useMutation({
    mutationFn: () =>
      api.post(`/tax/rule-packs/${selectedPackId}/versions`, {
        validFrom,
        engineId,
        rulesHash: "PENDING_DRAFT",
      }),
    onSuccess: () => {
      invalidate();
      setShowInitialVersionForm(false);
      notify.success("La primera versión quedó abierta como borrador.");
    },
  });
  const saveMutation = useMutation({
    mutationFn: () =>
      api.put(`/tax/rule-versions/${selectedVersion?.id}/rate-rules`, {
        rules: draftRows.map((row) => ({
          concept: row.concept.trim(),
          ...(row.kindId ? { kindId: row.kindId } : {}),
          ...(row.activityId ? { activityId: row.activityId } : {}),
          ...(row.categoryCode ? { categoryCode: row.categoryCode } : {}),
          isDefault: row.isDefault ?? false,
          ...(row.rate ? { rate: row.rate } : {}),
          ...(row.activityCode ? { activityCode: row.activityCode } : {}),
          ...(row.jurisdictionId ? { jurisdictionId: row.jurisdictionId } : {}),
          ...(row.minAmount ? { minAmount: row.minAmount } : {}),
          validFrom: row.validFrom.slice(0, 10),
          ...(row.validTo ? { validTo: row.validTo.slice(0, 10) } : {}),
        })),
      }),
    onSuccess: async () => {
      const savedVersionId = selectedVersion?.id;
      setRowFieldErrors({});
      void queryClient.invalidateQueries({ queryKey: ["tax-rule-packs", firmId] });
      await queryClient.invalidateQueries({ queryKey: ["tax-rule-pack", selectedPackId] });
      // El servidor reemplaza las filas al guardar (con ids nuevos): se toma lo
      // guardado como borrador de trabajo; si no, el borrador quedaría "sin
      // guardar" y bloquearía la activación.
      const saved = queryClient
        .getQueryData<RulePackDetail>(["tax-rule-pack", selectedPackId])
        ?.versions.find((version) => version.id === savedVersionId);
      if (saved) {
        setDraftRows(saved.rateRules);
        setDraftRowsVersionId(saved.id);
      }
      notify.success("Las reglas del borrador quedaron guardadas.");
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return;
      const details = error.details;
      const nested = details?.details;
      const issues = Array.isArray(nested) ? nested : [];
      const pathDetails = nested && typeof nested === "object" && !Array.isArray(nested)
        ? nested as { path?: unknown; message?: unknown }
        : null;
      const directPath = Array.isArray(pathDetails?.path)
        ? pathDetails.path
        : Array.isArray(details?.path) ? details.path : null;
      const parsedIssues = [...issues];
      if (directPath) {
        parsedIssues.push({
          path: directPath,
          message: typeof pathDetails?.message === "string" ? pathDetails.message : error.message,
        });
      }
      const next: Record<string, string> = {};
      for (const issue of parsedIssues) {
        if (!issue || typeof issue !== "object" || !Array.isArray(issue.path)) continue;
        const path = issue.path as Array<string | number>;
        if (path.length < 3 || !["rules", "rateRules"].includes(String(path[0]))) continue;
        const row = draftRows[Number(path[1])];
        if (row && typeof issue.message === "string") next[`${row.id}.${String(path[2])}`] = issue.message;
      }
      setRowFieldErrors(next);
    },
  });
  const submitMutation = useMutation({
    mutationFn: () => api.post(`/tax/rule-versions/${selectedVersion?.id}/submit-review`),
    onSuccess: () => {
      invalidate();
      notify.success("La versión fue enviada a revisión.");
    },
  });
  const approveMutation = useMutation({
    mutationFn: () =>
      api.post(`/tax/rule-versions/${selectedVersion?.id}/approve`, { credentialId }),
    onSuccess: () => {
      invalidate();
      notify.success("La versión fue aprobada con matrícula profesional.");
    },
  });
  const activateMutation = useMutation({
    mutationFn: (ruleVersionId: string) => api.post(`/tax/rule-versions/${ruleVersionId}/activate`),
    onSuccess: (_result, ruleVersionId) => {
      invalidate();
      const activatedVersion = detailQuery.data?.versions.find((version) => version.id === ruleVersionId);
      const message = `La versión v${activatedVersion?.version ?? ""} quedó activa y disponible para próximos cálculos.`;
      notify.success(message);
    },
    onError: (error) => {
      setActivationError(error instanceof Error ? error : new Error(String(error)));
    },
  });
  const addSourceMutation = useMutation({
    mutationFn: () =>
      api.post(`/tax/rule-versions/${selectedVersion?.id}/sources`, {
        authorityId: detailQuery.data?.regime.authority.id,
        title: newSource.title.trim(),
        ...(newSource.reference.trim() ? { reference: newSource.reference.trim() } : {}),
        ...(newSource.url.trim() ? { url: newSource.url.trim() } : {}),
        consultedAt: newSource.consultedAt,
      }),
    onSuccess: () => {
      invalidate();
      setNewSource({ title: "", reference: "", url: "", consultedAt: today });
      setShowSourceForm(false);
      notify.success("La fuente normativa quedó asociada al borrador.");
    },
  });
  const addDueDateMutation = useMutation({
    mutationFn: () =>
      api.post(`/tax/rule-versions/${selectedVersion?.id}/due-date-rules`, {
        jurisdictionId: detailQuery.data?.regime.jurisdiction.id,
        frequency: newDueDate.frequency,
        dueDay: Number(newDueDate.dueDay),
        ...(newDueDate.cuitEnding.trim() ? { cuitEnding: newDueDate.cuitEnding.trim() } : {}),
        validFrom: newDueDate.validFrom,
      }),
    onSuccess: () => {
      invalidate();
      setNewDueDate({
        frequency: FRECUENCIA_POR_DEFECTO,
        dueDay: "",
        cuitEnding: "",
        validFrom: today,
      });
      setShowDueDateForm(false);
      notify.success("El vencimiento quedó agregado al borrador.");
    },
  });

  if (!capabilities.has("tax.rules.read")) {
    return (
      <EmptyState
        title="Acceso restringido"
        description="No tenés permiso para consultar reglas fiscales."
      />
    );
  }

  const editable = selectedVersion?.status === "DRAFT" && capabilities.has("tax.rules.propose");
  const canPropose = capabilities.has("tax.rules.propose");
  const canActivateSelectedVersion = Boolean(
    selectedVersion &&
    ["DRAFT", "IN_REVIEW", "APPROVED"].includes(selectedVersion.status) &&
    canPropose,
  );
  const activationBlockedByUnsavedChanges = Boolean(
    selectedVersion?.status === "DRAFT" &&
    (draftRowsVersionId !== selectedVersion.id || !sameRuleRows(draftRows, selectedVersion.rateRules)),
  );
  const confirmActivation = () => {
    if (!activationTarget) return;
    const versionId = activationTarget.id;
    setActivationTarget(null);
    setActivationError(null);
    activateMutation.reset();
    activateMutation.mutate(versionId);
  };
  const requestActivation = (version: RuleVersion) => {
    if (activationBlockedByUnsavedChanges) {
      setActivationError(new Error("Guardá los cambios del borrador antes de activarlo."));
      return;
    }
    activateMutation.reset();
    setActivationError(null);
    setActivationTarget(version);
  };
  // Guardar y editar el borrador viven en el encabezado del resumen (D-R3-1 y D-R3-2). Una fila
  // sin tipo se marca antes de guardar, como antes en el pie del editor.
  const draftIncomplete = draftRows.some((row) => !row.rate && !row.minAmount);
  const guardarBorrador = () => {
    const missingKindRows = draftRows.filter((row) => !row.kindId);
    if (missingKindRows.length > 0) {
      setRowFieldErrors(Object.fromEntries(missingKindRows.map((row) => [
        `${row.id}.kindId`, "Seleccioná un tipo de regla.",
      ])));
      return;
    }
    saveMutation.mutate();
  };
  const editarBorrador = () => {
    document.getElementById("rule-rates-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // Una versión que no es borrador es de sólo lectura: para cambiar valores se
  // abre un borrador nuevo. La acción se ofrece en la sección de alícuotas,
  // junto a los datos que el usuario quiere modificar.
  // Sin familia de cálculo el régimen no tiene motores: la API rechaza
  // cualquier versión nueva. Se avisa antes, con el camino para resolverlo.
  const regimeMissingFamily = Boolean(detailQuery.data && !detailQuery.data.regime.calcFamilyId);
  const canStartNewVersion = Boolean(
    selectedVersion &&
      selectedVersion.status !== "DRAFT" &&
      !["IN_REVIEW", "APPROVED"].includes(selectedVersion.status) &&
      canPropose,
  );

  const allPacks = packsQuery.data ?? [];
  const packsWith = (status: RuleStatus) =>
    allPacks.filter((pack) => pack.versions.some((version) => version.status === status)).length;
  const isEmptyPackList = packsQuery.isSuccess && allPacks.length === 0;
  // Antes de la respuesta la cifra dice «pendiente»; con error, «no disponible». El cero es solo respuesta.
  const cifraPacks = (valor: number) =>
    packsQuery.isError ? "no disponible" : packsQuery.isSuccess ? valor : "pendiente";
  const newPackRef = useRef<() => void>(() => undefined);
  newPackRef.current = () => setShowPackForm(true);
  useDenseShortcuts({
    searchRef,
    onNew: canPropose ? () => newPackRef.current() : undefined,
  });

  return (
    <DensePage density={density} flow className="fiscal-rules">
      <DenseHeader
        title="Reglas fiscales"
        description="Alícuotas, mínimos y porcentajes normativos con vigencia; activación directa por Administrador o Titular."
        actions={
          canPropose ? (
            <Button
              size="sm"
              variant={isEmptyPackList && !showPackForm ? "primary" : "secondary"}
              onClick={() => setShowPackForm((visible) => !visible)}
            >
              <Icon name={showPackForm ? "close" : "plus"} size={16} />{" "}
              {showPackForm ? "Cerrar alta" : isEmptyPackList ? "Crear paquete" : "Nuevo paquete"}
            </Button>
          ) : undefined
        }
      />

      <StatStrip
        label="Resumen de paquetes de reglas"
        items={[
          { key: "packs", label: "Paquetes", value: cifraPacks(allPacks.length) },
          {
            key: "active",
            label: "Con versión vigente",
            value: cifraPacks(packsWith("ACTIVE")),
            active: packFilter === "ACTIVE",
            pressed: packFilter === "ACTIVE",
            onSelect: () => setPackFilter((current) => (current === "ACTIVE" ? "" : "ACTIVE")),
          },
          {
            key: "draft",
            label: "Con borrador",
            value: cifraPacks(packsWith("DRAFT")),
            active: packFilter === "DRAFT",
            pressed: packFilter === "DRAFT",
            onSelect: () => setPackFilter((current) => (current === "DRAFT" ? "" : "DRAFT")),
          },
          {
            key: "review",
            label: "En revisión",
            value: cifraPacks(packsWith("IN_REVIEW")),
            tone: packsQuery.isSuccess && packsWith("IN_REVIEW") > 0 ? "warn" : undefined,
            active: packFilter === "IN_REVIEW",
            pressed: packFilter === "IN_REVIEW",
            onSelect: () => setPackFilter((current) => (current === "IN_REVIEW" ? "" : "IN_REVIEW")),
          },
        ]}
      />

      <p className="dense-note fiscal-rules-guide" role="note">
        <strong>Secuencia de cambios:</strong> borrador → activación directa por Administrador o
        Titular. Las versiones activas son inmutables; todo cambio posterior se prepara en una nueva
        versión a partir de la vigente. Las versiones antiguas conservan su flujo de revisión.
      </p>

      <PanelNuevoPaquete
        showPackForm={showPackForm}
        setShowPackForm={setShowPackForm}
        newPack={newPack}
        setNewPack={setNewPack}
        createPackMutation={createPackMutation}
        regimesQuery={regimesQuery}
      />

      <PanelVencimiento
        showDueDateForm={showDueDateForm}
        setShowDueDateForm={setShowDueDateForm}
        editable={editable}
        newDueDate={newDueDate}
        setNewDueDate={setNewDueDate}
        addDueDateMutation={addDueDateMutation}
      />

      <PanelFuente
        showSourceForm={showSourceForm}
        setShowSourceForm={setShowSourceForm}
        editable={editable}
        newSource={newSource}
        setNewSource={setNewSource}
        addSourceMutation={addSourceMutation}
      />

      <PanelPrimeraVersion
        showInitialVersionForm={showInitialVersionForm}
        setShowInitialVersionForm={setShowInitialVersionForm}
        detailQuery={detailQuery}
        selectedVersion={selectedVersion}
        validFrom={validFrom}
        setValidFrom={setValidFrom}
        versionDateError={versionDateError}
        setVersionDateError={setVersionDateError}
        createVersionMutation={createVersionMutation}
        regimeEnginesQuery={regimeEnginesQuery}
        engineId={engineId}
        setEngineId={setEngineId}
      />

      <PanelModificarAlicuotas
        showCloneForm={showCloneForm}
        setShowCloneForm={setShowCloneForm}
        selectedVersion={selectedVersion}
        validFrom={validFrom}
        setValidFrom={setValidFrom}
        versionDateError={versionDateError}
        setVersionDateError={setVersionDateError}
        cloneMutation={cloneMutation}
      />


      <ListaPaquetes
        packs={allPacks}
        isLoading={packsQuery.isLoading}
        isEmpty={isEmptyPackList}
        isError={packsQuery.isError}
        onRetry={() => void packsQuery.refetch()}
        search={packSearch}
        onSearchChange={setPackSearch}
        searchRef={searchRef}
        filter={packFilter}
        onClearFilter={() => setPackFilter("")}
        selectedPackId={selectedPackId}
        onSelectPack={setSelectedPackId}
        canPropose={canPropose}
      />

      <div role="region" aria-label="Detalle del paquete de reglas" className="dense-detail">
          <AsyncState
            loading={detailQuery.isLoading}
            error={detailQuery.isError}
            loadingLabel="Cargando detalle de reglas…"
            errorTitle="No se pudo cargar el paquete de reglas"
            errorDescription="Reintentá la consulta. La lista de paquetes sigue disponible."
            onRetry={() => void detailQuery.refetch()}
          />
          {!selectedPackId && allPacks.length > 0 ? (
            <EmptyState
              size="compact"
              title="Ningún paquete seleccionado"
              description="Elegí uno de la lista para ver sus versiones y reglas."
            />
          ) : null}
          {detailQuery.data ? (
            <ResumenVersion
              detail={detailQuery.data}
              selectedVersion={selectedVersion}
              canPropose={canPropose}
              canActivateSelectedVersion={canActivateSelectedVersion}
              activateMutation={activateMutation}
              requestActivation={requestActivation}
              canDeleteVersion={canDeleteVersion}
              canDeletePack={canDeletePack}
              firmId={firmId}
              setDeletingTarget={setDeletingTarget}
              requestPackDeletion={requestPackDeletion}
              setSelectedVersionId={setSelectedVersionId}
              activeVersion={activeVersion}
              activationError={activationError}
              activationFeedbackRef={activationFeedbackRef}
              editable={editable}
              bloqueadaPorCambios={activationBlockedByUnsavedChanges}
              saveMutation={saveMutation}
              saveError={editable && Object.keys(rowFieldErrors).length === 0 ? saveMutation.error : null}
              guardarIncompleto={draftIncomplete}
              onGuardar={guardarBorrador}
              onNuevaVersion={() => setShowInitialVersionForm(true)}
              onEditarBorrador={editarBorrador}
            />
          ) : null}
          {detailQuery.data && !selectedVersion ? (
            <EmptyState
              title="Este paquete todavía no tiene versión"
              description="Creá un borrador inicial antes de ingresar porcentajes o vencimientos."
            />
          ) : null}
          {detailQuery.data && selectedVersion ? (
            <>
              <DenseTabs<"rates" | "dueDates" | "sources" | "approval" | "simulate">
                label="Secciones de la versión"
                idPrefix="rule-tab"
                active={ruleTab}
                onChange={setRuleTab}
                tabs={[
                  { id: "rates", label: "Alícuotas", count: selectedVersion.rateRules.length },
                  { id: "dueDates", label: "Vencimientos", count: selectedVersion.dueDateRules.length },
                  { id: "sources", label: "Fuentes", count: selectedVersion.sources.length },
                  { id: "approval", label: "Control profesional" },
                  { id: "simulate", label: "Probar" },
                ]}
              />
              <div role="tabpanel" id="rule-tab-panel">
              {ruleTab === "rates" ? (
              <AlicuotasEditor
                editable={editable}
                canStartNewVersion={canStartNewVersion}
                regimeMissingFamily={regimeMissingFamily}
                canPropose={canPropose}
                detailQuery={detailQuery}
                selectedVersion={selectedVersion}
                validFrom={validFrom}
                setShowCloneForm={setShowCloneForm}
                cloneMutation={cloneMutation}
                draftRows={draftRows}
                setDraftRows={setDraftRows}
                rowFieldErrors={rowFieldErrors}
                setRowFieldErrors={setRowFieldErrors}
                ruleKindsQuery={ruleKindsQuery}
                activitiesQuery={activitiesQuery}
                jurisdictionsQuery={jurisdictionsQuery}
              />
              ) : null}
              {ruleTab === "simulate" ? (
                <RuleSimulator
                  key={selectedVersion.id}
                  versionId={selectedVersion.id}
                  versionNumber={selectedVersion.version}
                  isDraft={selectedVersion.status === "DRAFT"}
                  hasUnsavedChanges={activationBlockedByUnsavedChanges}
                  rules={selectedVersion.rateRules}
                />
              ) : null}
              {ruleTab === "dueDates" ? (
              <TabVencimientos
                editable={editable}
                showDueDateForm={showDueDateForm}
                setShowDueDateForm={setShowDueDateForm}
                selectedVersion={selectedVersion}
              />
              ) : null}
              {ruleTab === "sources" ? (
              <TabFuentes
                editable={editable}
                showSourceForm={showSourceForm}
                setShowSourceForm={setShowSourceForm}
                selectedVersion={selectedVersion}
              />
              ) : null}
              {ruleTab === "approval" ? (
              <TabControlProfesional
                selectedVersion={selectedVersion}
                canPropose={canPropose}
                submitMutation={submitMutation}
                capabilities={capabilities}
                credentialId={credentialId}
                setCredentialId={setCredentialId}
                credentialQuery={credentialQuery}
                approveMutation={approveMutation}
              />
              ) : null}
              </div>
            </>
          ) : null}
      </div>
      <ConfirmarActivacion
        activationTarget={activationTarget}
        setActivationTarget={setActivationTarget}
        detailQuery={detailQuery}
        activateMutation={activateMutation}
        confirmActivation={confirmActivation}
        activeVersion={activeVersion}
      />
      <ConfirmDialog confirm={confirm} />
      {deletingTarget ? (
        <DeletionDrawer
          isOpen
          path={deletingTarget.path}
          onClose={() => setDeletingTarget(null)}
          onDeleted={async () => {
            const kind = deletingTarget.kind;
            if (kind === "pack") setSelectedPackId(null);
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ["tax-rule-packs", firmId] }),
              queryClient.invalidateQueries({ queryKey: ["tax-rule-pack", selectedPackId] }),
            ]);
            notify.success(
              kind === "pack"
                ? "El paquete y su parametría quedaron eliminados y auditados."
                : "La versión borrador y su parametría quedaron eliminadas y auditadas.",
            );
          }}
        />
      ) : null}
    </DensePage>
  );
}
