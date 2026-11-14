import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field, MoneyField, Table, useNotify } from "@contable/design-system";
import {
  MONOTRIBUTO_CATEGORY_CODES,
  type CatalogEconomicActivity,
  type TaxRuleKindOption,
} from "@contable/contracts";
import type { TaxEngineOption } from "@contable/contracts";
import { ApiError, api } from "../lib/api";
import { FieldErrorsFromDetails } from "../components/forms/FieldErrorsFromDetails";
import { useClientContext } from "../context/ClientContext";
import { ActionDrawer } from "../ui/ActionDrawer";
import { DeletionDrawer } from "../ui/DeletionDrawer";
import { RuleSimulator } from "./RuleSimulator";
import { getStatusBadgeMeta, StatusBadge } from "../ui/StatusBadge";
import { Icon } from "../ui/Icon";
import {
  DenseAlert,
  DenseFooter,
  DenseHeader,
  DensePage,
  DenseSearch,
  DenseTable,
  DenseTabs,
  DenseToolbar,
  StatStrip,
  useDenseShortcuts,
  useDensity,
  normalizeSearch,
  type DenseColumn,
} from "../ui/Dense";
import "./study.css";

type RuleStatus = "DRAFT" | "IN_REVIEW" | "APPROVED" | "ACTIVE" | "RETIRED";

interface RuleRow {
  id: string;
  concept: string;
  kindId?: string | null;
  activityId?: string | null;
  categoryCode?: string | null;
  isDefault?: boolean;
  activityCode: string | null;
  jurisdictionId: string | null;
  rate: string | null;
  minAmount: string | null;
  validFrom: string;
  validTo: string | null;
}

interface RuleVersion {
  id: string;
  version: number;
  status: RuleStatus;
  origin?: "REFERENCE" | "UI";
  createdByFirmId?: string | null;
  validFrom: string;
  validTo: string | null;
  engineVersion: string;
  rulesHash: string;
  rateRules: RuleRow[];
  dueDateRules: Array<{
    id: string;
    frequency: string | null;
    dueDay: number;
    cuitEnding: string | null;
    validFrom: string;
    validTo: string | null;
  }>;
  sources: Array<{ id: string; title: string; reference: string | null; consultedAt: string }>;
}

interface RulePack {
  id: string;
  code: string;
  name: string;
  status: RuleStatus;
  origin?: "REFERENCE" | "UI";
  createdByFirmId?: string | null;
  regime: {
    id: string;
    name: string;
    code: string;
    calcFamilyId?: string | null;
    isActive: boolean;
    taxType: { name: string; code: string; isActive: boolean };
    jurisdiction: { name: string; code?: string; isActive: boolean };
  };
  versions: RuleVersion[];
}

interface RulePackDetail extends RulePack {
  regime: RulePack["regime"] & {
    jurisdiction: { id: string; name: string; code: string };
    authority: { id: string; name: string; isActive: boolean };
  };
}

interface RuleRegimeOption {
  id: string;
  code: string;
  name: string;
  taxType: { name: string };
  jurisdiction: { name: string };
}

interface Credential {
  id: string;
  registrationNumber: string;
  jurisdiction: { name: string };
}

interface RuleJurisdictionOption {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

const today = new Date().toISOString().slice(0, 10);

function validateRuleVersionDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "La fecha debe tener formato AAAA-MM-DD y un año entre 1900 y 2100.";
  }
  const year = Number(value.slice(0, 4));
  if (year < 1900 || year > 2100) return "El año debe estar entre 1900 y 2100.";
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return "Ingresá una fecha válida.";
  }
  return null;
}

function shortDate(value: string | null) {
  // Las vigencias son fechas calendario guardadas en UTC: se formatean en UTC
  // para no mostrar el día anterior en husos como el de Argentina (UTC-3).
  return value ? new Date(value).toLocaleDateString("es-AR", { timeZone: "UTC" }) : "Sin vencimiento";
}

function sameRuleRows(draftRows: RuleRow[], savedRows: RuleRow[]): boolean {
  if (draftRows.length !== savedRows.length) return false;
  const savedById = new Map(savedRows.map((row) => [row.id, row]));
  return draftRows.every((row) => {
    const saved = savedById.get(row.id);
    return Boolean(
      saved &&
      row.concept === saved.concept &&
      row.kindId === saved.kindId &&
      row.activityId === saved.activityId &&
      row.categoryCode === saved.categoryCode &&
      Boolean(row.isDefault) === Boolean(saved.isDefault) &&
      row.activityCode === saved.activityCode &&
      row.jurisdictionId === saved.jurisdictionId &&
      row.rate === saved.rate &&
      row.minAmount === saved.minAmount &&
      row.validFrom.slice(0, 10) === saved.validFrom.slice(0, 10) &&
      (row.validTo?.slice(0, 10) ?? null) === (saved.validTo?.slice(0, 10) ?? null),
    );
  });
}

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
    frequency: "MENSUAL",
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

  const updateDraftRule = (ruleId: string, changes: Partial<RuleRow>) => {
    setDraftRows((rows) => rows.map((row) => row.id === ruleId ? { ...row, ...changes } : row));
    setRowFieldErrors((previous) => Object.fromEntries(
      Object.entries(previous).filter(([key]) => !key.startsWith(`${ruleId}.`)),
    ));
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
    onSuccess: () => {
      invalidate();
      setRowFieldErrors({});
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
        ...(newDueDate.frequency.trim() ? { frequency: newDueDate.frequency.trim() } : {}),
        dueDay: Number(newDueDate.dueDay),
        ...(newDueDate.cuitEnding.trim() ? { cuitEnding: newDueDate.cuitEnding.trim() } : {}),
        validFrom: newDueDate.validFrom,
      }),
    onSuccess: () => {
      invalidate();
      setNewDueDate({ frequency: "MENSUAL", dueDay: "", cuitEnding: "", validFrom: today });
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
  const mutationError =
    cloneMutation.error ??
    createPackMutation.error ??
    createVersionMutation.error ??
    saveMutation.error ??
    submitMutation.error ??
    approveMutation.error ??
    activateMutation.error ??
    addSourceMutation.error ??
    addDueDateMutation.error;
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
  const resetOtherMutationErrors = () => {
    cloneMutation.reset();
    createPackMutation.reset();
    createVersionMutation.reset();
    saveMutation.reset();
    submitMutation.reset();
    approveMutation.reset();
    addSourceMutation.reset();
    addDueDateMutation.reset();
  };
  const confirmActivation = () => {
    if (!activationTarget) return;
    const versionId = activationTarget.id;
    setActivationTarget(null);
    setActivationError(null);
    resetOtherMutationErrors();
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
  const rulesNextAction = (() => {
    if (!selectedPackId) {
      return canPropose
        ? { label: "Crear paquete", description: "Definí el régimen sobre el que vas a configurar reglas.", onClick: () => setShowPackForm(true) }
        : null;
    }
    if (detailQuery.data && !selectedVersion) {
      return canPropose
        ? { label: "Crear primera versión", description: "Abrí un borrador para cargar alícuotas, vencimientos y fuentes.", onClick: () => setShowInitialVersionForm(true) }
        : null;
    }
    if (!selectedVersion) return null;
    if (selectedVersion.status === "DRAFT" && canPropose) {
      return { label: `Editar borrador v${selectedVersion.version}`, description: "Revisá las reglas y guardá los cambios; después podés activar directamente esta versión.", onClick: () => document.getElementById("rule-rates-title")?.scrollIntoView({ behavior: "smooth", block: "start" }) };
    }
    if (["IN_REVIEW", "APPROVED"].includes(selectedVersion.status) && canActivateSelectedVersion) {
      return { label: "Activar versión", description: "La versión quedará vigente para los próximos cálculos.", onClick: () => requestActivation(selectedVersion) };
    }
    return null;
  })();
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
  const visiblePacks = useMemo(() => {
    const needle = normalizeSearch(packSearch);
    return allPacks.filter((pack) => {
      if (packFilter && !pack.versions.some((version) => version.status === packFilter)) return false;
      if (!needle) return true;
      return normalizeSearch(
        `${pack.name} ${pack.code} ${pack.regime.taxType.name} ${pack.regime.jurisdiction.name}`,
      ).includes(needle);
    });
  }, [allPacks, packFilter, packSearch]);
  const isEmptyPackList = packsQuery.isSuccess && allPacks.length === 0;
  const newPackRef = useRef<() => void>(() => undefined);
  newPackRef.current = () => setShowPackForm(true);
  useDenseShortcuts({
    searchRef,
    onNew: canPropose ? () => newPackRef.current() : undefined,
  });
  const versionsLabel = (pack: RulePack) => {
    const active = pack.versions.find((version) => version.status === "ACTIVE");
    const draft = pack.versions.find((version) => version.status === "DRAFT");
    const review = pack.versions.find((version) => version.status === "IN_REVIEW");
    const parts = [
      draft ? `Borrador v${draft.version}` : null,
      review ? `En revisión v${review.version}` : null,
      active ? `Vigente v${active.version}` : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : "Sin versión activa";
  };
  const packColumns: DenseColumn<RulePack>[] = [
    {
      key: "name",
      header: "Paquete",
      sortValue: (pack) => pack.name.toLocaleLowerCase("es-AR"),
      render: (pack) => (
        <span className="dense-name">
          <span className="dense-name__text">
            <strong>{pack.name}</strong>
            <small>{pack.code} · {pack.regime.name}{!pack.regime.isActive ? " (oculto)" : ""}</small>
          </span>
        </span>
      ),
    },
    {
      key: "tax",
      header: "Impuesto",
      sortValue: (pack) => pack.regime.taxType.name,
      render: (pack) => `${pack.regime.taxType.name}${!pack.regime.taxType.isActive ? " (oculto)" : ""}`,
    },
    {
      key: "jurisdiction",
      header: "Jurisdicción",
      sortValue: (pack) => pack.regime.jurisdiction.name,
      render: (pack) => `${pack.regime.jurisdiction.name}${!pack.regime.jurisdiction.isActive ? " (oculto)" : ""}`,
    },
    {
      key: "versions",
      header: "Versiones",
      render: (pack) => <span>{versionsLabel(pack)}</span>,
    },
  ];

  return (
    <DensePage density={density} flow className="fiscal-rules">
      <DenseHeader
        title="Reglas fiscales"
        description="Alícuotas, mínimos y porcentajes normativos con vigencia; activación directa por Administrador o Titular."
        actions={
          canPropose ? (
            <Button size="sm" onClick={() => setShowPackForm((visible) => !visible)}>
              <Icon name={showPackForm ? "close" : "plus"} size={16} />{" "}
              {showPackForm ? "Cerrar alta" : "Nuevo paquete"}
            </Button>
          ) : undefined
        }
      />

      <StatStrip
        label="Resumen de paquetes de reglas"
        items={[
          { key: "packs", label: "Paquetes", value: allPacks.length },
          {
            key: "active",
            label: "Con versión vigente",
            value: packsWith("ACTIVE"),
            active: packFilter === "ACTIVE",
            onSelect: () => setPackFilter((current) => (current === "ACTIVE" ? "" : "ACTIVE")),
          },
          {
            key: "draft",
            label: "Con borrador",
            value: packsWith("DRAFT"),
            active: packFilter === "DRAFT",
            onSelect: () => setPackFilter((current) => (current === "DRAFT" ? "" : "DRAFT")),
          },
          {
            key: "review",
            label: "En revisión",
            value: packsWith("IN_REVIEW"),
            tone: packsWith("IN_REVIEW") > 0 ? "warn" : undefined,
            active: packFilter === "IN_REVIEW",
            onSelect: () => setPackFilter((current) => (current === "IN_REVIEW" ? "" : "IN_REVIEW")),
          },
        ]}
      />

      <p className="dense-note fiscal-rules-guide" role="note">
        <strong>Secuencia de cambios:</strong> borrador → activación directa por Administrador o
        Titular. Las versiones activas son inmutables; todo cambio posterior se prepara en una nueva
        versión a partir de la vigente. Las versiones antiguas conservan su flujo de revisión.
      </p>

      <ActionDrawer
        isOpen={showPackForm}
        onClose={() => setShowPackForm(false)}
        title="Nuevo paquete de reglas"
        description="Iniciá la configuración para un régimen y luego abrí su primera versión."
        size="wide"
      >
        <form
          className="study-form fiscal-action-form"
          onSubmit={(event) => {
            event.preventDefault();
            createPackMutation.mutate();
          }}
        >
          <Field
            label="Código"
            id="new-rule-pack-code"
            value={newPack.code}
            onChange={(event) => setNewPack({ ...newPack, code: event.target.value.toUpperCase() })}
            placeholder="IVA-RI-ARCA"
            required
          />
          <Field
            label="Nombre"
            id="new-rule-pack-name"
            value={newPack.name}
            onChange={(event) => setNewPack({ ...newPack, name: event.target.value })}
            placeholder="IVA Responsable Inscripto"
            required
          />
          <div className="ds-field">
            <label className="ds-field__label" htmlFor="new-rule-pack-regime">
              Régimen
            </label>
            <select
              id="new-rule-pack-regime"
              className="ds-field__input"
              value={newPack.regimeId}
              onChange={(event) => setNewPack({ ...newPack, regimeId: event.target.value })}
              required
            >
              <option value="">Seleccioná un régimen…</option>
              {regimesQuery.data?.map((regime) => (
                <option key={regime.id} value={regime.id}>
                  {regime.name} · {regime.taxType.name} · {regime.jurisdiction.name}
                </option>
              ))}
            </select>
            {regimesQuery.isError ? (
              <p className="form-error" role="alert">
                No pudimos consultar los regímenes.{" "}
                <button type="button" className="fiscal-retry" onClick={() => void regimesQuery.refetch()}>
                  Reintentar
                </button>
              </p>
            ) : regimesQuery.isSuccess && regimesQuery.data.length === 0 ? (
              <p className="form-submit-hint" role="note">
                Todavía no hay regímenes. Creá uno en{" "}
                <a
                  className="dense-link"
                  href="/catalogos-fiscales"
                >
                  Catálogos fiscales
                </a>.
              </p>
            ) : null}
          </div>
          <div className="study-form__actions">
            <Button
              type="submit"
              loading={createPackMutation.isPending}
              disabled={!newPack.code.trim() || !newPack.name.trim() || !newPack.regimeId}
            >
              Crear paquete
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowPackForm(false)}>
              Cancelar
            </Button>
          </div>
          {!newPack.code.trim() || !newPack.name.trim() || !newPack.regimeId ? (
            <p className="form-submit-hint" role="note">
              Completá código, nombre y régimen para poder crear el paquete.
            </p>
          ) : null}
        </form>
      </ActionDrawer>

      <ActionDrawer
        isOpen={showDueDateForm && editable}
        onClose={() => setShowDueDateForm(false)}
        title="Agregar vencimiento"
        description="Definí la regla usada para calcular fechas de presentación y pago."
      >
        <form
          className="study-form study-form--compact fiscal-action-form"
          onSubmit={(event) => {
            event.preventDefault();
            addDueDateMutation.mutate();
          }}
        >
          <Field
            label="Frecuencia"
            id="rule-due-frequency"
            value={newDueDate.frequency}
            onChange={(event) => setNewDueDate({ ...newDueDate, frequency: event.target.value })}
            required
          />
          <Field
            label="Día del mes"
            id="rule-due-day"
            type="number"
            min="1"
            max="31"
            value={newDueDate.dueDay}
            onChange={(event) => setNewDueDate({ ...newDueDate, dueDay: event.target.value })}
            required
          />
          <Field
            label="Terminación de CUIT"
            id="rule-due-cuit-ending"
            value={newDueDate.cuitEnding}
            onChange={(event) => setNewDueDate({ ...newDueDate, cuitEnding: event.target.value })}
            placeholder="Opcional"
          />
          <Field
            label="Vigencia desde"
            id="rule-due-valid-from"
            type="date"
            value={newDueDate.validFrom}
            onChange={(event) => setNewDueDate({ ...newDueDate, validFrom: event.target.value })}
            required
          />
          <div className="study-form__actions">
            <Button
              type="submit"
              loading={addDueDateMutation.isPending}
              disabled={
                !newDueDate.dueDay ||
                Number(newDueDate.dueDay) < 1 ||
                Number(newDueDate.dueDay) > 31
              }
            >
              Guardar vencimiento
            </Button>
          </div>
        </form>
      </ActionDrawer>

      <ActionDrawer
        isOpen={showSourceForm && editable}
        onClose={() => setShowSourceForm(false)}
        title="Agregar fuente normativa"
        description="Asociá la norma, padrón o resolución que respalda esta versión."
        size="wide"
      >
        <form
          className="study-form fiscal-action-form"
          onSubmit={(event) => {
            event.preventDefault();
            addSourceMutation.mutate();
          }}
        >
          <Field
            label="Título"
            id="rule-source-title"
            value={newSource.title}
            onChange={(event) => setNewSource({ ...newSource, title: event.target.value })}
            required
          />
          <Field
            label="Referencia"
            id="rule-source-reference"
            value={newSource.reference}
            onChange={(event) => setNewSource({ ...newSource, reference: event.target.value })}
            placeholder="Opcional"
          />
          <Field
            label="URL"
            id="rule-source-url"
            type="url"
            value={newSource.url}
            onChange={(event) => setNewSource({ ...newSource, url: event.target.value })}
            placeholder="https://…"
          />
          <Field
            label="Consultada el"
            id="rule-source-consulted-at"
            type="date"
            value={newSource.consultedAt}
            onChange={(event) => setNewSource({ ...newSource, consultedAt: event.target.value })}
            required
          />
          <div className="study-form__actions">
            <Button
              type="submit"
              loading={addSourceMutation.isPending}
              disabled={!newSource.title.trim()}
            >
              Guardar fuente
            </Button>
          </div>
        </form>
      </ActionDrawer>

      <ActionDrawer
        isOpen={showInitialVersionForm && Boolean(detailQuery.data) && !selectedVersion}
        onClose={() => setShowInitialVersionForm(false)}
        title="Crear primera versión"
        description="Abrí un borrador para cargar alícuotas, vencimientos y las fuentes que respaldan el cálculo."
      >
        <form
          className="study-form study-form--compact fiscal-action-form"
          onSubmit={(event) => {
            event.preventDefault();
            const dateError = validateRuleVersionDate(validFrom);
            setVersionDateError(dateError);
            if (dateError) return;
            createVersionMutation.mutate();
          }}
        >
          <Field
            label="Vigencia desde"
            id="first-rule-version-valid-from"
            type="date"
            min="1900-01-01"
            max="2100-12-31"
            value={validFrom}
            error={versionDateError ?? undefined}
            onChange={(event) => {
              setValidFrom(event.target.value);
              setVersionDateError(null);
            }}
            onInvalid={(event) => {
              event.preventDefault();
              setVersionDateError(
                validateRuleVersionDate(event.currentTarget.value) ??
                  "La fecha debe estar entre 01/01/1900 y 31/12/2100.",
              );
            }}
            required
          />
          {!detailQuery.data?.regime.calcFamilyId ? (
            <EmptyState
              size="compact"
              role="alert"
              title="Elegí una familia de cálculo"
              description="Este régimen necesita una familia para mostrar las opciones de cálculo."
              action={(
                <a
                  className="dense-link"
                  href={`/catalogos-fiscales?editRegime=${encodeURIComponent(detailQuery.data?.regime.id ?? "")}`}
                >
                  Editar régimen
                </a>
              )}
            />
          ) : regimeEnginesQuery.isLoading ? (
            <p className="muted-copy" role="status">Buscando opciones de cálculo…</p>
          ) : regimeEnginesQuery.isError ? (
            <p className="form-error" role="alert">
              No pudimos cargar las opciones de cálculo. <Button type="button" variant="ghost" size="sm" onClick={() => void regimeEnginesQuery.refetch()}>Reintentar</Button>
            </p>
          ) : regimeEnginesQuery.data?.length ? (
            <div className="ds-field">
              <label className="ds-field__label" htmlFor="first-rule-version-engine">Opción de cálculo</label>
              <select
                id="first-rule-version-engine"
                className="ds-field__input"
                value={engineId}
                onChange={(event) => setEngineId(event.target.value)}
                required
              >
                <option value="">Seleccioná una opción…</option>
                {regimeEnginesQuery.data.map((engine) => (
                  <option key={engine.id} value={engine.id}>{engine.label}</option>
                ))}
              </select>
              {createVersionMutation.error instanceof ApiError ? (
                <p className="form-error" role="alert">{createVersionMutation.error.message}</p>
              ) : null}
            </div>
          ) : (
            <EmptyState
              size="compact"
              title="Esta familia aún no tiene opciones de cálculo"
              description="Elegí otra familia para este régimen o consultá con quien administra la configuración del estudio."
            />
          )}
          <div className="study-form__actions">
            <Button
              type="submit"
              loading={createVersionMutation.isPending}
              disabled={!regimeEnginesQuery.data?.some((engine) => engine.id === engineId)}
            >
              Crear primera versión
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowInitialVersionForm(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      </ActionDrawer>

      <ActionDrawer
        isOpen={showCloneForm && Boolean(selectedVersion) && selectedVersion?.status !== "DRAFT"}
        onClose={() => setShowCloneForm(false)}
        title="Modificar alícuotas"
        description="Primero elegí desde cuándo rigen los nuevos valores. Al continuar se abre un borrador con las alícuotas actuales para que las edites; la versión vigente sigue aplicando hasta que el Administrador o Titular active la nueva."
      >
        <form
          className="study-form study-form--compact fiscal-action-form"
          onSubmit={(event) => {
            event.preventDefault();
            const dateError = validateRuleVersionDate(validFrom);
            setVersionDateError(dateError);
            if (dateError) return;
            cloneMutation.mutate();
          }}
        >
          <Field
            label="Nueva vigencia desde"
            id="rule-valid-from"
            type="date"
            min="1900-01-01"
            max="2100-12-31"
            value={validFrom}
            error={versionDateError ?? undefined}
            onChange={(event) => {
              setValidFrom(event.target.value);
              setVersionDateError(null);
            }}
            onInvalid={(event) => {
              event.preventDefault();
              setVersionDateError(
                validateRuleVersionDate(event.currentTarget.value) ??
                  "La fecha debe estar entre 01/01/1900 y 31/12/2100.",
              );
            }}
            required
          />
          {cloneMutation.error ? (
            <p className="form-error" role="alert">
              {cloneMutation.error instanceof Error
                ? cloneMutation.error.message
                : "No se pudo crear el borrador."}
            </p>
          ) : null}
          <div className="study-form__actions">
            <Button type="submit" loading={cloneMutation.isPending}>
              <Icon name="plus" size={16} /> Crear borrador y editar
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowCloneForm(false)}>
              Cancelar
            </Button>
          </div>
          <p className="muted-copy">
            La versión vigente no se modifica: sigue activa hasta que el Administrador o Titular
            active esta nueva versión.
          </p>
        </form>
      </ActionDrawer>


      {!isEmptyPackList ? (
        <DenseToolbar>
          <DenseSearch
            inputRef={searchRef}
            value={packSearch}
            onChange={setPackSearch}
            placeholder="Buscar paquete, impuesto o jurisdicción…"
            label="Buscar paquetes"
          />
          {packFilter ? (
            <button type="button" className="dense-toggle" aria-pressed onClick={() => setPackFilter("")}>
              Filtro activo · quitar
            </button>
          ) : null}
          <span className="dense-toolbar__spacer" />
        </DenseToolbar>
      ) : null}

      {packsQuery.isLoading ? (
        <div className="dense-table-card">
          <div className="query-state" role="status">
            <span className="loading-copy">Cargando reglas…</span>
          </div>
        </div>
      ) : isEmptyPackList ? (
        <EmptyState
          size="compact"
          className="fiscal-rules-empty"
          title="Todavía no hay paquetes de reglas"
          description="Creá un paquete para definir alícuotas, vencimientos y fuentes normativas."
        />
      ) : (
        <div className="dense-packs">
          <DenseTable<RulePack>
            label="Paquetes de reglas disponibles"
            columns={packColumns}
            rows={visiblePacks}
            rowKey={(pack) => pack.id}
            selectedKey={selectedPackId}
            onSelect={(key) => {
              if (key) setSelectedPackId(key);
            }}
            footer={
              <DenseFooter
                count={visiblePacks.length}
                noun={visiblePacks.length === 1 ? "paquete" : "paquetes"}
                hint="Elegí un paquete para ver sus versiones y reglas."
                newShortcut={canPropose}
              />
            }
            empty={
              <p className="muted-copy">
                Ningún paquete coincide.
              </p>
            }
          />
        </div>
      )}

      <div className="fiscal-rules-detail dense-detail">
          {detailQuery.isLoading ? (
            <div className="query-state">Cargando detalle de reglas…</div>
          ) : null}
          {detailQuery.isError ? (
            <EmptyState title="No se pudo cargar el paquete de reglas" />
          ) : null}
          {!selectedPackId && !packsQuery.isLoading && allPacks.length > 0 ? (
            <EmptyState
              title="Todavía no hay paquetes de reglas"
              description="Creá un paquete para definir alícuotas, vencimientos y fuentes normativas."
            />
          ) : null}
          {selectedPackId && rulesNextAction ? (
            <DenseAlert
              tone="hint"
              action={<Button size="sm" onClick={rulesNextAction.onClick}>{rulesNextAction.label}</Button>}
            >
              <strong>Próximo paso:</strong> {rulesNextAction.description}
            </DenseAlert>
          ) : null}
          {detailQuery.data && canDeletePack ? (
            <section className="study-panel fiscal-rule-delete" aria-label="Administración del paquete">
              <div>
                <h2>Paquete creado desde UI</h2>
                <p>Revisá sus dependencias antes de confirmar la eliminación definitiva.</p>
              </div>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  if (firmId && selectedPackId) {
                    setDeletingTarget({
                      path: `/firms/${firmId}/tax/rule-packs/${selectedPackId}`,
                      kind: "pack",
                    });
                  }
                }}
              >
                Eliminar paquete
              </Button>
            </section>
          ) : null}
          {detailQuery.data && !selectedVersion ? (
            <EmptyState
              title="Este paquete todavía no tiene versión"
              description="Creá un borrador inicial antes de ingresar porcentajes o vencimientos."
            />
          ) : null}
          {detailQuery.data && selectedVersion ? (
            <>
              <section className="study-panel fiscal-rule-summary fiscal-rule-context">
                <div className="study-panel__heading">
                  <div>
                    <p className="fiscal-rule-context__regime">
                      {detailQuery.data.regime.taxType.name}{!detailQuery.data.regime.taxType.isActive ? " (oculto)" : ""} ·{" "}
                      {detailQuery.data.regime.jurisdiction.name}{!detailQuery.data.regime.jurisdiction.isActive ? " (oculto)" : ""}
                    </p>
                    <h2>{detailQuery.data.name}</h2>
                    <p>
                      {detailQuery.data.code} · Régimen {detailQuery.data.regime.name}{!detailQuery.data.regime.isActive ? " (oculto)" : ""} · Organismo recaudador {detailQuery.data.regime.authority.name}{!detailQuery.data.regime.authority.isActive ? " (oculto)" : ""}
                    </p>
                  </div>
                  <div className="table-actions">
                    <StatusBadge status={selectedVersion.status} />
                    {canActivateSelectedVersion ? (
                      <Button
                        size="sm"
                        loading={activateMutation.isPending}
                        onClick={() => requestActivation(selectedVersion)}
                      >
                        Activar
                      </Button>
                    ) : null}
                    {canDeleteVersion ? (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          if (firmId) {
                            setDeletingTarget({
                              path: `/firms/${firmId}/tax/rule-versions/${selectedVersion.id}`,
                              kind: "version",
                            });
                          }
                        }}
                      >
                        Eliminar borrador v{selectedVersion.version}
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="fiscal-rule-summary__meta">
                  {detailQuery.data.versions.length > 1 ? (
                    <label className="ds-field">
                      <span className="ds-field__label">Versión del paquete</span>
                      <select
                        className="ds-field__input"
                        aria-label="Versión del paquete"
                        value={selectedVersion.id}
                        onChange={(event) => setSelectedVersionId(event.target.value)}
                      >
                        {detailQuery.data.versions.map((version) => (
                          <option key={version.id} value={version.id}>
                            v{version.version} · {getStatusBadgeMeta(version.status).label} · {shortDate(version.validFrom)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <span>
                    Régimen <strong>{detailQuery.data.regime.name}</strong>
                  </span>
                  <span>
                    {selectedVersion.status === "DRAFT" ? "Editando borrador" : "Versión"}{" "}
                    <strong>v{selectedVersion.version}</strong>
                  </span>
                  {selectedVersion.status === "DRAFT" && activeVersion ? (
                    <span>
                      Versión activa <strong>v{activeVersion.version}</strong>
                    </span>
                  ) : null}
                  <span>
                    Vigencia{" "}
                    <strong>
                      {shortDate(selectedVersion.validFrom)} — {shortDate(selectedVersion.validTo)}
                    </strong>
                  </span>
                  <span>
                    Motor <strong>{selectedVersion.engineVersion}</strong>
                  </span>
                </div>
                {activationError ? (
                  <div ref={activationFeedbackRef} className="activation-feedback" tabIndex={-1}>
                    {activationError instanceof ApiError ? (
                      <FieldErrorsFromDetails error={activationError} />
                    ) : (
                      <p className="form-error" role="alert">
                        {activationError.message}
                      </p>
                    )}
                  </div>
                ) : null}
              </section>

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
              <div role="tabpanel" id="rule-tab-panel" className="dense-tabpanel">
              {ruleTab === "rates" ? (
              <section className="study-panel" aria-labelledby="rule-rates-title">
                <div className="study-panel__heading">
                  <div>
                    <h2 id="rule-rates-title">Alícuotas y porcentajes</h2>
                    <p>
                      Elegí el tipo y el sujeto desde los catálogos del régimen. Concepto identifica
                      la regla para el estudio y es opcional.
                    </p>
                    {canStartNewVersion && regimeMissingFamily ? (
                      <p className="muted-copy">
                        Este régimen no tiene familia de cálculo, así que no se puede abrir una
                        versión nueva ni calcular con él. Asignale una familia en Catálogos fiscales.
                      </p>
                    ) : canStartNewVersion ? (
                      <p className="muted-copy">
                        Esta versión es de sólo lectura porque ya se usa para calcular. Para cambiar
                        valores se abre un borrador nuevo; la versión actual sigue aplicando hasta
                        que actives la nueva.
                      </p>
                    ) : null}
                  </div>
                  {editable ? (
                    <Button
                      size="sm"
                      onClick={() =>
                        setDraftRows((rows) => [
                          ...rows,
                          {
                            id: crypto.randomUUID(),
                            concept: "",
                            kindId: null,
                            activityId: null,
                            categoryCode: null,
                            isDefault: false,
                            activityCode: null,
                            jurisdictionId: null,
                            rate: null,
                            minAmount: null,
                            validFrom,
                            validTo: null,
                          },
                        ])
                      }
                    >
                      <Icon name="plus" size={15} /> Agregar regla
                    </Button>
                  ) : canStartNewVersion && regimeMissingFamily ? (
                    <a
                      className="dense-link"
                      href={`/catalogos-fiscales?editRegime=${encodeURIComponent(detailQuery.data?.regime.id ?? "")}`}
                    >
                      Asignar familia de cálculo
                    </a>
                  ) : canStartNewVersion ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        cloneMutation.reset();
                        setShowCloneForm(true);
                      }}
                    >
                      Modificar alícuotas
                    </Button>
                  ) : null}
                </div>
                <Table<RuleRow>
                  rows={editable ? draftRows : selectedVersion.rateRules}
                  rowKey={(row) => row.id}
                  empty="Esta versión no tiene alícuotas configuradas."
                  columns={[
                    {
                      key: "concept",
                      header: "Concepto",
                      render: (row) =>
                        editable ? (
                          <input
                            className="fiscal-rule-input fiscal-rule-input--concept"
                            aria-label={`Concepto ${row.id}`}
                            value={row.concept}
                            placeholder="Etiqueta opcional"
                            onChange={(event) => updateDraftRule(row.id, { concept: event.target.value })}
                          />
                        ) : (
                          row.concept
                        ),
                    },
                    {
                      key: "kind",
                      header: "Tipo de regla",
                      render: (row) => {
                        const kinds = ruleKindsQuery.data ?? [];
                        const currentKind = kinds.find((kind) => kind.id === row.kindId);
                        if (!editable) return currentKind?.label ?? "Tipo sin resolver";
                        const error = rowFieldErrors[`${row.id}.kindId`];
                        return (
                          <div>
                            <select
                              className="fiscal-rule-input fiscal-rule-input--select"
                              aria-label={`Tipo de regla ${row.id}`}
                              aria-invalid={Boolean(error)}
                              value={row.kindId ?? ""}
                              onChange={(event) => updateDraftRule(row.id, {
                                kindId: event.target.value || null,
                                activityId: null,
                                activityCode: null,
                                jurisdictionId: null,
                                categoryCode: null,
                                isDefault: false,
                              })}
                            >
                              <option value="">Seleccioná un tipo…</option>
                              {kinds.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
                            </select>
                            {error ? <p className="fiscal-rule-row-error" role="alert">{error}</p> : null}
                          </div>
                        );
                      },
                    },
                    ...((ruleKindsQuery.data ?? []).some((option) => option.subject === "ACTIVITY" || option.subject === "ACTIVITY_OR_DEFAULT") ? [{
                      key: "activity",
                      header: "Actividad",
                      render: (row: RuleRow) => {
                        const kind = (ruleKindsQuery.data ?? []).find((option) => option.id === row.kindId);
                        if (kind?.subject !== "ACTIVITY_OR_DEFAULT" && kind?.subject !== "ACTIVITY") return "—";
                        if (!editable) {
                          const currentActivity = (activitiesQuery.data ?? []).find(
                            (activity) => activity.id === row.activityId,
                          );
                          return row.activityId
                            ? `${currentActivity?.code ?? row.activityCode ?? "Actividad"}${currentActivity && !currentActivity.isActive ? " (oculta)" : ""}`
                            : row.isDefault ? "Todas las actividades" : row.activityCode ?? "Sin actividad específica";
                        }
                        // La opción actual oculta o ajena a la jurisdicción se
                        // conserva como lectura deshabilitada; para elegirla
                        // nuevamente hay que mostrarla en el catálogo.
                        const packJurisdictionId = detailQuery.data?.regime.jurisdiction.id;
                        const catalogActivities = activitiesQuery.data ?? [];
                        const options = catalogActivities.filter(
                          (activity) =>
                            activity.isActive &&
                            (!packJurisdictionId || activity.jurisdictionId === packJurisdictionId),
                        );
                        const currentCode = row.activityCode ?? "";
                        const currentActivity = catalogActivities.find(
                          (activity) => activity.id === row.activityId,
                        );
                        const isLegacyCode =
                          Boolean(row.activityId || currentCode) &&
                          !options.some((activity) => activity.id === row.activityId);
                        const rowError = rowFieldErrors[`${row.id}.activityId`];
                        return (
                          <div>
                            <select
                              className="fiscal-rule-input fiscal-rule-input--select"
                              aria-label={`Actividad ${row.id}`}
                              aria-invalid={Boolean(rowError)}
                                  value={row.isDefault && kind.subject === "ACTIVITY_OR_DEFAULT" ? "__all__" : row.activityId ?? row.activityCode ?? ""}
                              onChange={(event) => {
                                const value = event.target.value;
                                const selected = options.find((activity) => activity.id === value);
                                updateDraftRule(row.id, {
                                  activityId: selected?.id ?? null,
                                  activityCode: selected?.code ?? null,
                                  isDefault: kind.subject === "ACTIVITY_OR_DEFAULT" && value === "__all__",
                                });
                              }}
                            >
                              <option value="">{kind.subject === "ACTIVITY" ? "Sin actividad específica" : "Seleccioná una actividad…"}</option>
                              {kind.subject === "ACTIVITY_OR_DEFAULT" ? <option value="__all__">Todas las actividades</option> : null}
                              {options.map((activity) => (
                                <option key={activity.id} value={activity.id}>
                                  {activity.code} · {activity.name}
                                </option>
                              ))}
                              {isLegacyCode ? (
                                <option value={row.activityId ?? row.activityCode ?? ""} disabled>
                                  {currentActivity && !currentActivity.isActive
                                    ? `${row.activityCode} (oculto)`
                                    : `${row.activityCode} — código histórico fuera de la jurisdicción del paquete`}
                                </option>
                              ) : null}
                            </select>
                            {rowError ? (
                              <p className="fiscal-rule-row-error" role="alert">
                                {rowError}
                              </p>
                            ) : null}
                          </div>
                        );
                      },
                    }] : []),
                    ...((ruleKindsQuery.data ?? []).some((option) => option.subject === "JURISDICTION" || option.subject === "JURISDICTION_OR_DEFAULT") ? [{
                      key: "jurisdiction",
                      header: "Jurisdicción",
                      render: (row: RuleRow) => {
                        const kind = (ruleKindsQuery.data ?? []).find((option) => option.id === row.kindId);
                        if (kind?.subject !== "JURISDICTION" && kind?.subject !== "JURISDICTION_OR_DEFAULT") return "—";
                        const options = jurisdictionsQuery.data ?? [];
                        const error = rowFieldErrors[`${row.id}.jurisdictionId`];
                        const current = options.find((option) => option.id === row.jurisdictionId);
                        if (!editable) return current?.name ?? row.jurisdictionId ?? "Sin jurisdicción";
                        return (
                          <div>
                            <select
                              className="fiscal-rule-input fiscal-rule-input--select"
                              aria-label={`Jurisdicción ${row.id}`}
                              aria-invalid={Boolean(error)}
                              value={row.isDefault && kind.subject === "JURISDICTION_OR_DEFAULT" ? "__all__" : row.jurisdictionId ?? ""}
                              onChange={(event) => updateDraftRule(row.id, {
                                jurisdictionId: event.target.value && event.target.value !== "__all__" ? event.target.value : null,
                                isDefault: event.target.value === "__all__",
                              })}
                            >
                              <option value="">Seleccioná una jurisdicción…</option>
                              {kind.subject === "JURISDICTION_OR_DEFAULT" ? <option value="__all__">Todas las jurisdicciones</option> : null}
                              {options.filter((option) => option.isActive).map((option) => (
                                <option key={option.id} value={option.id}>{option.name}</option>
                              ))}
                              {current && !current.isActive ? <option value={current.id} disabled>{current.name} (oculta)</option> : null}
                            </select>
                            {error ? <p className="fiscal-rule-row-error" role="alert">{error}</p> : null}
                          </div>
                        );
                      },
                    }] : []),
                    ...((ruleKindsQuery.data ?? []).some((option) => option.subject === "CATEGORY") ? [{
                      key: "category",
                      header: "Categoría",
                      render: (row: RuleRow) => {
                        const kind = (ruleKindsQuery.data ?? []).find((option) => option.id === row.kindId);
                        if (kind?.subject !== "CATEGORY") return "—";
                        const error = rowFieldErrors[`${row.id}.categoryCode`];
                        if (!editable) return row.categoryCode ?? "Sin categoría";
                        return (
                          <div>
                            <select
                              className="fiscal-rule-input fiscal-rule-input--select"
                              aria-label={`Categoría ${row.id}`}
                              aria-invalid={Boolean(error)}
                              value={row.categoryCode ?? ""}
                              onChange={(event) => updateDraftRule(row.id, { categoryCode: event.target.value || null })}
                            >
                              <option value="">Seleccioná una categoría…</option>
                              {MONOTRIBUTO_CATEGORY_CODES.map((code) => <option key={code} value={code}>Categoría {code}</option>)}
                            </select>
                            {error ? <p className="fiscal-rule-row-error" role="alert">{error}</p> : null}
                          </div>
                        );
                      },
                    }] : []),
                    {
                      key: "rate",
                      header: "Alícuota",
                      align: "right",
                      render: (row) =>
                        editable ? (
                          <MoneyField
                            className="fiscal-rule-input fiscal-rule-input--number"
                            aria-label={`Alícuota ${row.id}`}
                            prefix="%"
                            maxDecimals={4}
                            value={row.rate ?? ""}
                            onChange={(value) =>
                              setDraftRows((rows) =>
                                rows.map((item) =>
                                  item.id === row.id
                                    ? { ...item, rate: value || null }
                                    : item,
                                ),
                              )
                            }
                          />
                        ) : row.rate ? (
                          `${row.rate}%`
                        ) : (
                          "—"
                        ),
                    },
                    {
                      key: "minimum",
                      header: "Mínimo",
                      align: "right",
                      render: (row) =>
                        editable ? (
                          <MoneyField
                            className="fiscal-rule-input fiscal-rule-input--number"
                            aria-label={`Mínimo ${row.id}`}
                            value={row.minAmount ?? ""}
                            onChange={(value) =>
                              setDraftRows((rows) =>
                                rows.map((item) =>
                                  item.id === row.id
                                    ? { ...item, minAmount: value || null }
                                    : item,
                                ),
                              )
                            }
                          />
                        ) : (
                          (row.minAmount ?? "—")
                        ),
                    },
                    {
                      key: "actions",
                      header: "",
                      render: (row) =>
                        editable ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setDraftRows((rows) => rows.filter((item) => item.id !== row.id))
                            }
                          >
                            Quitar
                          </Button>
                        ) : null,
                    },
                  ]}
                />
                {editable ? (
                  <div className="study-page__actions fiscal-rule-actions">
                    <Button
                      onClick={() => {
                        const missingKindRows = draftRows.filter((row) => !row.kindId);
                        if (missingKindRows.length > 0) {
                          setRowFieldErrors(Object.fromEntries(missingKindRows.map((row) => [
                            `${row.id}.kindId`, "Seleccioná un tipo de regla.",
                          ])));
                          return;
                        }
                        saveMutation.mutate();
                      }}
                      loading={saveMutation.isPending}
                      disabled={draftRows.some(
                        (row) => !row.rate && !row.minAmount,
                      )}
                    >
                      Guardar borrador
                    </Button>
                  </div>
                ) : null}
                {editable && draftRows.some((row) => !row.rate && !row.minAmount) ? (
                  <p className="form-submit-hint" role="note">
                    Completá la tasa, cuota o importe de cada fila para guardar el borrador.
                  </p>
                ) : null}
              </section>
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
              <section className="study-panel" aria-labelledby="rule-due-dates-title">
                <div className="study-panel__heading">
                  <div>
                    <h2 id="rule-due-dates-title">Vencimientos</h2>
                    <p>Reglas usadas para calcular fechas de presentación y pago.</p>
                  </div>
                  {editable ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setShowDueDateForm((visible) => !visible)}
                    >
                      {showDueDateForm ? "Cancelar" : "Agregar vencimiento"}
                    </Button>
                  ) : null}
                </div>
                <Table<RuleVersion["dueDateRules"][number]>
                  rows={selectedVersion.dueDateRules}
                  rowKey={(row) => row.id}
                  empty="No hay vencimientos cargados para esta versión."
                  columns={[
                    {
                      key: "frequency",
                      header: "Frecuencia",
                      render: (row) => row.frequency ?? "—",
                    },
                    { key: "dueDay", header: "Día", render: (row) => String(row.dueDay) },
                    {
                      key: "cuitEnding",
                      header: "CUIT",
                      render: (row) => row.cuitEnding ?? "Todas",
                    },
                    {
                      key: "validFrom",
                      header: "Vigencia",
                      render: (row) => `${shortDate(row.validFrom)} — ${shortDate(row.validTo)}`,
                    },
                  ]}
                />
              </section>
              ) : null}
              {ruleTab === "sources" ? (
              <section className="study-panel" aria-labelledby="rule-sources-title">
                <div className="study-panel__heading">
                  <div>
                    <h2 id="rule-sources-title">Fuentes normativas</h2>
                    <p>Resoluciones, padrones o normas que respaldan esta versión.</p>
                  </div>
                  {editable ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setShowSourceForm((visible) => !visible)}
                    >
                      {showSourceForm ? "Cancelar" : "Agregar fuente"}
                    </Button>
                  ) : null}
                </div>
                <Table<RuleVersion["sources"][number]>
                  rows={selectedVersion.sources}
                  rowKey={(row) => row.id}
                  empty="No hay fuentes normativas asociadas a esta versión."
                  columns={[
                    { key: "title", header: "Fuente", render: (row) => row.title },
                    {
                      key: "reference",
                      header: "Referencia",
                      render: (row) => row.reference ?? "—",
                    },
                    {
                      key: "consultedAt",
                      header: "Consultada",
                      render: (row) => shortDate(row.consultedAt),
                    },
                  ]}
                />
              </section>
              ) : null}
              {ruleTab === "approval" ? (
              <section id="rule-approval" className="study-panel fiscal-rule-approval">
                <div>
                  <h2>Flujo de revisión anterior</h2>
                  <p>
                    La activación directa es el recorrido principal. Las versiones históricas pueden
                    conservar revisión profesional; las versiones activas siguen siendo inmutables.
                  </p>
                </div>
                <div className="fiscal-rule-approval__actions">
                  {selectedVersion.status === "DRAFT" && canPropose ? (
                    <Button
                      variant="secondary"
                      onClick={() => submitMutation.mutate()}
                      loading={submitMutation.isPending}
                    >
                      Enviar a revisión (flujo anterior)
                    </Button>
                  ) : null}
                  {selectedVersion.status === "IN_REVIEW" &&
                  capabilities.has("tax.rules.approve") ? (
                    <>
                      <select
                        className="ds-field__input"
                        aria-label="Matrícula para aprobar"
                        value={credentialId}
                        onChange={(event) => setCredentialId(event.target.value)}
                      >
                        <option value="">Seleccioná matrícula…</option>
                        {credentialQuery.data?.map((credential) => (
                          <option key={credential.id} value={credential.id}>
                            {credential.registrationNumber} · {credential.jurisdiction.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        disabled={!credentialId}
                        loading={approveMutation.isPending}
                        onClick={() => approveMutation.mutate()}
                      >
                        Aprobar
                      </Button>
                      {!credentialId ? (
                        <p className="form-submit-hint" role="note">
                          Seleccioná la matrícula profesional para habilitar la aprobación.
                        </p>
                      ) : null}
                    </>
                  ) : null}
                </div>
                {selectedVersion.sources.length > 0 ? (
                  <p className="fiscal-rule-approval__sources">
                    Fuentes:{" "}
                    {selectedVersion.sources
                      .map((source) => source.reference || source.title)
                      .join(" · ")}
                  </p>
                ) : (
                  <p className="fiscal-rule-approval__sources">Sin fuente normativa cargada.</p>
                )}
              </section>
              ) : null}
              </div>
            </>
          ) : null}
      </div>
      {mutationError ? (
        mutationError instanceof ApiError ? (
          <FieldErrorsFromDetails error={mutationError} />
        ) : (
          <p className="form-error" role="alert">
            {mutationError.message}
          </p>
        )
      ) : null}
      <ActionDrawer
        isOpen={Boolean(activationTarget)}
        onClose={() => setActivationTarget(null)}
        title={
          activationTarget
            ? `${detailQuery.data?.name ?? "Paquete fiscal"} · versión v${activationTarget.version}`
            : "Confirmar activación"
        }
        description="Revisá el paquete y la vigencia antes de activar esta versión."
        footer={
          <div className="study-form__actions">
            <Button type="button" loading={activateMutation.isPending} onClick={confirmActivation}>
              Activar versión
            </Button>
            <Button type="button" variant="ghost" onClick={() => setActivationTarget(null)}>
              Cancelar
            </Button>
          </div>
        }
      >
        {activationTarget ? (
          <div>
            <p>Vigencia: {shortDate(activationTarget.validFrom)} — {shortDate(activationTarget.validTo)}</p>
            {activeVersion ? (
              <p role="note">Al activar esta versión, la versión vigente quedará retirada</p>
            ) : null}
          </div>
        ) : null}
      </ActionDrawer>
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
