import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field } from "@contable/design-system";
import {
  ACTIVITY_CODE_PATTERN,
  normalizeActivityCode,
  type CalcFamilyOption,
  type EconomicActivityCodeChange,
} from "@contable/contracts";
import { ApiError, api, type FiscalJurisdiction, type FiscalTaxType } from "../lib/api";
import { FieldErrorsFromDetails } from "../components/forms/FieldErrorsFromDetails";
import { useClientContext } from "../context/ClientContext";
import { ActionDrawer } from "../ui/ActionDrawer";
import { DeletionDrawer } from "../ui/DeletionDrawer";
import { StatusBadge } from "../ui/StatusBadge";
import {
  DenseAlert,
  DenseHeader,
  DensePage,
  DenseSearch,
  DensitySwitch,
  DenseTable,
  DenseTabs,
  DenseToolbar,
  DenseWorkspace,
  Inspector,
  InspectorFacts,
  InspectorSection,
  ShortcutHint,
  normalizeSearch,
  useDenseShortcuts,
  useDensity,
  type DenseColumn,
} from "../ui/Dense";
import { Icon } from "../ui/Icon";
import "./study.css";
import "./StudyCatalogosFiscales.css";

type JurisdictionOption = FiscalJurisdiction;
type TaxTypeOption = FiscalTaxType;

interface TaxAuthorityRow {
  id: string;
  code: string;
  name: string;
  jurisdictionId: string;
  isActive: boolean;
  origin?: "REFERENCE" | "UI";
  createdByFirmId?: string | null;
  jurisdiction: JurisdictionOption;
}

interface TaxRegimeRow {
  id: string;
  code: string;
  name: string;
  calcFamilyId?: string | null;
  isActive: boolean;
  origin?: "REFERENCE" | "UI";
  createdByFirmId?: string | null;
  authority: TaxAuthorityRow;
  jurisdiction: JurisdictionOption;
  taxType: TaxTypeOption;
}

interface AuthorityForm {
  code: string;
  name: string;
  jurisdictionId: string;
}

interface RegimeForm {
  code: string;
  name: string;
  taxTypeId: string;
  calcFamilyId: string;
  jurisdictionId: string;
  authorityId: string;
}

interface JurisdictionForm {
  code: string;
  name: string;
  kind: JurisdictionOption["kind"];
  parentId: string;
}

interface TaxTypeForm {
  code: string;
  name: string;
  defaultFamilyId: string;
}

interface CatalogActivityRow {
  id: string;
  code: string;
  name: string;
  jurisdictionId: string;
  source: string | null;
  validFrom: string;
  validTo: string | null;
  isActive: boolean;
  origin?: "REFERENCE" | "UI";
  createdByFirmId?: string | null;
  activeClientLinks?: number;
  codeChange?: EconomicActivityCodeChange | null;
}

interface ActivityForm {
  code: string;
  name: string;
  jurisdictionId: string;
  source: string;
  validFrom: string;
  validTo: string;
}

interface CatalogUsage {
  entityId: string;
  used: boolean;
  count: number;
  places: Array<{ label: string; count: number }>;
}

const today = new Date().toISOString().slice(0, 10);

const emptyActivityForm: ActivityForm = {
  code: "",
  name: "",
  jurisdictionId: "",
  source: "",
  validFrom: today,
  validTo: "",
};

const emptyJurisdictionForm: JurisdictionForm = {
  code: "",
  name: "",
  kind: "NATIONAL",
  parentId: "",
};

const emptyTaxTypeForm: TaxTypeForm = { code: "", name: "", defaultFamilyId: "" };

function shortDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString("es-AR") : "—";
}

function validityLabel(validFrom: string, validTo: string | null) {
  return validTo
    ? `${shortDate(validFrom)} — ${shortDate(validTo)}`
    : `Desde ${shortDate(validFrom)}`;
}

type CatalogTab = "jurisdictions" | "taxTypes" | "authorities" | "regimes" | "activities";
type MasterDrawer = "jurisdiction-create" | "jurisdiction-edit" | "tax-type-create" | "tax-type-edit";
type CatalogDrawer = "authority-create" | "authority-edit" | "regime-create" | "regime-edit";

const jurisdictionKindLabel: Record<JurisdictionOption["kind"], string> = {
  NATIONAL: "Nación",
  PROVINCIAL: "Provincia",
  MUNICIPAL: "Municipio",
};

function ActivityStateBadge({ isActive }: { isActive: boolean }) {
  return <StatusBadge status={isActive ? "ACTIVE" : "INACTIVE"} />;
}

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span className={`status-badge status-badge--${active ? "ok" : "muted"}`}>
      {active ? "Activo" : "Inactivo"}
    </span>
  );
}

function OriginBadge({ origin }: { origin?: "REFERENCE" | "UI" }) {
  if (!origin) return <span className="muted-copy">—</span>;
  return (
    <span className={`status-badge status-badge--${origin === "UI" ? "info" : "muted"}`}>
      {origin === "UI" ? "Del estudio" : "Referencia"}
    </span>
  );
}

function isOwnedUiRecord(
  row: { origin?: string; createdByFirmId?: string | null },
  firmId: string,
): boolean {
  return row.origin === "UI" && row.createdByFirmId === firmId;
}

function MutationError({ error }: { error: unknown }) {
  if (!error || codeConflict(error)) return null;
  if (error instanceof ApiError) return <FieldErrorsFromDetails error={error} />;
  return (
    <p className="form-error" role="alert">
      {error instanceof Error ? error.message : "Ocurrió un error inesperado."}
    </p>
  );
}

function apiFieldIssue(error: unknown, field: string): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const details = error.details?.details;
  if (!Array.isArray(details)) return undefined;
  const issue = details.find((candidate) => {
    if (typeof candidate !== "object" || candidate === null) return false;
    const path = (candidate as { path?: unknown }).path;
    return Array.isArray(path) && path.some((part) => part === field);
  }) as { message?: unknown } | undefined;
  return typeof issue?.message === "string" ? issue.message : undefined;
}

function InspectorActions({
  onEdit,
  children,
  menu,
}: {
  onEdit?: () => void;
  children?: ReactNode;
  menu?: ReactNode;
}) {
  return (
    <div className="dense-inspector-actions">
      {onEdit ? (
        <Button size="sm" variant="primary" onClick={onEdit}>
          Editar
        </Button>
      ) : null}
      {children}
      {menu ? (
        <details className="dense-inspector-actions__menu">
          <summary
            className="dense-inspector-actions__trigger"
            aria-label="Más acciones"
            title="Más acciones"
          >
            ⋯
          </summary>
          <div className="dense-inspector-actions__items" role="group" aria-label="Acciones secundarias">
            {menu}
          </div>
        </details>
      ) : null}
    </div>
  );
}

const CATALOG_CODE_CONFLICT = "CATALOG_CODE_CONFLICT";

function codeConflict(error: unknown): string | undefined {
  return error instanceof ApiError && error.code === CATALOG_CODE_CONFLICT ? error.message : undefined;
}

function suggestedCode(current: string, usedCodes: string[], maxLength = 40): string {
  const normalized = new Set(usedCodes.map((code) => code.toLocaleUpperCase("es-AR")));
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const tail = `-${suffix}`;
    const candidate = `${current.slice(0, maxLength - tail.length)}${tail}`;
    if (!normalized.has(candidate.toLocaleUpperCase("es-AR"))) return candidate;
  }
  return current.slice(0, maxLength);
}

function selectionOptions<T extends { id: string; isActive: boolean }>(rows: T[], selectedId?: string) {
  const activeRows = rows.filter((row) => row.isActive);
  const selectedHidden = rows.find((row) => row.id === selectedId && !row.isActive);
  return selectedHidden ? [...activeRows, selectedHidden] : activeRows;
}

export function StudyCatalogosFiscales() {
  const { firmId, capabilities } = useClientContext();
  const queryClient = useQueryClient();
  const canPropose = capabilities.has("tax.rules.propose");
  const canDelete = capabilities.has("data.delete");
  const [drawer, setDrawer] = useState<CatalogDrawer | null>(null);
  const [masterDrawer, setMasterDrawer] = useState<MasterDrawer | null>(null);
  const [activityDrawer, setActivityDrawer] = useState<"create" | "edit" | "deactivate" | null>(null);
  const [duplicateOfId, setDuplicateOfId] = useState<string | null>(null);
  const [editingActivity, setEditingActivity] = useState<CatalogActivityRow | null>(null);
  const [editingAuthority, setEditingAuthority] = useState<TaxAuthorityRow | null>(null);
  const [editingRegime, setEditingRegime] = useState<TaxRegimeRow | null>(null);
  const [activityForm, setActivityForm] = useState<ActivityForm>(emptyActivityForm);
  const [editingJurisdiction, setEditingJurisdiction] = useState<JurisdictionOption | null>(null);
  const [jurisdictionForm, setJurisdictionForm] = useState<JurisdictionForm>(emptyJurisdictionForm);
  const [editingTaxType, setEditingTaxType] = useState<TaxTypeOption | null>(null);
  const [taxTypeForm, setTaxTypeForm] = useState<TaxTypeForm>(emptyTaxTypeForm);
  const [tab, setTab] = useState<CatalogTab>("authorities");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [jurisdictionFilter, setJurisdictionFilter] = useState("");
  const [originFilter, setOriginFilter] = useState<"" | "REFERENCE" | "UI">("");
  const [stateFilter, setStateFilter] = useState<"" | "active" | "inactive">("");
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [density, setDensity] = useDensity();
  const searchRef = useRef<HTMLInputElement>(null);
  const createRef = useRef<() => void>(() => undefined);
  useDenseShortcuts({
    searchRef,
    onNew: () => createRef.current(),
    onEscape: () => setSelectedId(null),
  });
  const [receipt, setReceipt] = useState<string | null>(null);
  const [deletingTarget, setDeletingTarget] = useState<{ path: string } | null>(null);
  const [authorityForm, setAuthorityForm] = useState<AuthorityForm>({
    code: "",
    name: "",
    jurisdictionId: "",
  });
  const [regimeForm, setRegimeForm] = useState<RegimeForm>({
    code: "",
    name: "",
    taxTypeId: "",
    calcFamilyId: "",
    jurisdictionId: "",
    authorityId: "",
  });

  const jurisdictionsQuery = useQuery({
    queryKey: ["tax-jurisdictions", firmId, "catalog-admin"],
    queryFn: () => api.get<JurisdictionOption[]>("/tax/jurisdictions?includeInactive=true"),
    enabled: Boolean(firmId && capabilities.has("tax.rules.read")),
  });
  const taxTypesQuery = useQuery({
    queryKey: ["tax-types", firmId, "catalog-admin"],
    queryFn: () => api.get<TaxTypeOption[]>("/tax/types?includeInactive=true"),
    enabled: Boolean(firmId && capabilities.has("tax.rules.read")),
  });
  const authoritiesQuery = useQuery({
    queryKey: ["tax-authorities", firmId, "catalog-admin"],
    queryFn: () => api.get<TaxAuthorityRow[]>("/tax/authorities?includeInactive=true"),
    enabled: Boolean(firmId && capabilities.has("tax.rules.read")),
  });
  const regimesQuery = useQuery({
    queryKey: ["tax-regimes", firmId, "catalog-admin"],
    queryFn: () => api.get<TaxRegimeRow[]>("/tax/regimes?includeInactive=true"),
    enabled: Boolean(firmId && capabilities.has("tax.rules.read")),
  });
  const calcFamiliesQuery = useQuery({
    queryKey: ["tax-calc-families", firmId],
    queryFn: () => api.get<CalcFamilyOption[]>("/tax/calc-families"),
    enabled: Boolean(firmId && capabilities.has("tax.rules.read")),
  });
  const deepLinkedRegimeId = useRef<string | null>(
    new URLSearchParams(window.location.search).get("editRegime"),
  );
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (deepLinkHandled.current || !deepLinkedRegimeId.current || regimesQuery.isLoading) return;
    const row = regimesQuery.data?.find((regime) => regime.id === deepLinkedRegimeId.current);
    if (!row) {
      deepLinkHandled.current = true;
      return;
    }
    deepLinkHandled.current = true;
    setTab("regimes");
    setEditingRegime(row);
    setDuplicateOfId(null);
    setRegimeForm({
      code: row.code,
      name: row.name,
      taxTypeId: row.taxType.id,
      calcFamilyId: row.calcFamilyId ?? row.taxType.defaultFamilyId ?? "",
      jurisdictionId: row.jurisdiction.id,
      authorityId: row.authority.id,
    });
    setDrawer("regime-edit");
  }, [regimesQuery.data, regimesQuery.isLoading]);
  // La administración del catálogo necesita también las desactivadas:
  // `includeInactive=true` es el parámetro acordado con el servidor.
  const activitiesQuery = useQuery({
    queryKey: ["tax-activities-catalog", firmId],
    queryFn: () => api.get<CatalogActivityRow[]>("/tax/activities?includeInactive=true"),
    enabled: Boolean(firmId && capabilities.has("tax.rules.read")),
  });
  const catalogKindByTab: Record<CatalogTab, string> = {
    jurisdictions: "jurisdiction",
    taxTypes: "taxType",
    authorities: "authority",
    regimes: "regime",
    activities: "activity",
  };
  const usageQuery = useQuery({
    queryKey: ["tax-catalog-usage", firmId, catalogKindByTab[tab], selectedId],
    queryFn: () => api.get<CatalogUsage>(`/tax/catalog-usage/${catalogKindByTab[tab]}/${selectedId}`),
    enabled: Boolean(firmId && selectedId && capabilities.has("tax.rules.read")),
  });

  const createAuthority = useMutation({
    mutationFn: () =>
      api.post<TaxAuthorityRow>("/tax/authorities", {
        code: authorityForm.code.trim(),
        name: authorityForm.name.trim(),
        jurisdictionId: authorityForm.jurisdictionId,
        ...(duplicateOfId ? { duplicateOfId } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tax-authorities", firmId] });
      setAuthorityForm({ code: "", name: "", jurisdictionId: "" });
      setEditingAuthority(null);
      setDuplicateOfId(null);
      setDrawer(null);
    },
  });
  const updateAuthority = useMutation({
    mutationFn: () => api.patch<TaxAuthorityRow>(`/tax/authorities/${editingAuthority?.id ?? ""}`, {
      code: authorityForm.code.trim(),
      name: authorityForm.name.trim(),
      jurisdictionId: authorityForm.jurisdictionId,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tax-authorities", firmId] });
      setEditingAuthority(null);
      setDrawer(null);
      setReceipt("El organismo quedó actualizado.");
    },
  });
  const toggleAuthority = useMutation({
    mutationFn: (row: TaxAuthorityRow) => api.patch<TaxAuthorityRow>(`/tax/authorities/${row.id}`, { isActive: !row.isActive }),
    onSuccess: (_updated, row) => {
      void queryClient.invalidateQueries({ queryKey: ["tax-authorities", firmId] });
      setReceipt(row.isActive ? "El organismo quedó oculto." : "El organismo vuelve a mostrarse.");
    },
  });
  const createRegime = useMutation({
    mutationFn: () =>
      api.post<TaxRegimeRow>("/tax/regimes", {
        code: regimeForm.code.trim(),
        name: regimeForm.name.trim(),
        taxTypeId: regimeForm.taxTypeId,
        calcFamilyId: regimeForm.calcFamilyId,
        jurisdictionId: regimeForm.jurisdictionId,
        authorityId: regimeForm.authorityId,
        ...(duplicateOfId ? { duplicateOfId } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tax-regimes", firmId] });
      setEditingRegime(null);
      setDuplicateOfId(null);
      setRegimeForm({
        code: "",
        name: "",
        taxTypeId: "",
        calcFamilyId: "",
        jurisdictionId: "",
        authorityId: "",
      });
      setDrawer(null);
    },
  });
  const updateRegime = useMutation({
    mutationFn: () => api.patch<TaxRegimeRow>(`/tax/regimes/${editingRegime?.id ?? ""}`, {
      code: regimeForm.code.trim(),
      name: regimeForm.name.trim(),
      taxTypeId: regimeForm.taxTypeId,
      calcFamilyId: regimeForm.calcFamilyId || null,
      jurisdictionId: regimeForm.jurisdictionId,
      authorityId: regimeForm.authorityId,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tax-regimes", firmId] });
      setEditingRegime(null);
      setDrawer(null);
      setReceipt("El régimen quedó actualizado.");
    },
  });
  const toggleRegime = useMutation({
    mutationFn: (row: TaxRegimeRow) => api.patch<TaxRegimeRow>(`/tax/regimes/${row.id}`, { isActive: !row.isActive }),
    onSuccess: (_updated, row) => {
      void queryClient.invalidateQueries({ queryKey: ["tax-regimes", firmId] });
      setReceipt(row.isActive ? "El régimen quedó oculto." : "El régimen vuelve a mostrarse.");
    },
  });
  const createJurisdiction = useMutation({
    mutationFn: () =>
      api.post<JurisdictionOption>("/tax/jurisdictions", {
        code: jurisdictionForm.code.trim(),
        name: jurisdictionForm.name.trim(),
        kind: jurisdictionForm.kind,
        ...(jurisdictionForm.kind === "NATIONAL" ? {} : { parentId: jurisdictionForm.parentId }),
        ...(duplicateOfId ? { duplicateOfId } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tax-jurisdictions", firmId] });
      setJurisdictionForm(emptyJurisdictionForm);
      setDuplicateOfId(null);
      setMasterDrawer(null);
      setReceipt("La jurisdicción quedó registrada en el catálogo.");
    },
  });
  const updateJurisdiction = useMutation({
    mutationFn: () =>
      api.patch<JurisdictionOption>(`/tax/jurisdictions/${editingJurisdiction?.id ?? ""}`, {
        code: jurisdictionForm.code.trim(),
        name: jurisdictionForm.name.trim(),
        kind: jurisdictionForm.kind,
        parentId: jurisdictionForm.kind === "NATIONAL" ? null : jurisdictionForm.parentId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tax-jurisdictions", firmId] });
      setEditingJurisdiction(null);
      setMasterDrawer(null);
      setReceipt("La jurisdicción quedó actualizada.");
    },
  });
  const toggleJurisdiction = useMutation({
    mutationFn: (row: JurisdictionOption) =>
      api.patch<JurisdictionOption>(`/tax/jurisdictions/${row.id}`, { isActive: !row.isActive }),
    onSuccess: (_updated, row) => {
      void queryClient.invalidateQueries({ queryKey: ["tax-jurisdictions", firmId] });
      setReceipt(row.isActive ? "La jurisdicción quedó oculta." : "La jurisdicción vuelve a mostrarse.");
    },
  });
  const createTaxType = useMutation({
    mutationFn: () =>
      api.post<TaxTypeOption>("/tax/types", {
        code: taxTypeForm.code.trim(),
        name: taxTypeForm.name.trim(),
        ...(taxTypeForm.defaultFamilyId ? { defaultFamilyId: taxTypeForm.defaultFamilyId } : {}),
        ...(duplicateOfId ? { duplicateOfId } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tax-types", firmId] });
      setTaxTypeForm(emptyTaxTypeForm);
      setDuplicateOfId(null);
      setMasterDrawer(null);
      setReceipt("El tipo de impuesto quedó registrado en el catálogo.");
    },
  });
  const updateTaxType = useMutation({
    mutationFn: () =>
      api.patch<TaxTypeOption>(`/tax/types/${editingTaxType?.id ?? ""}`, {
        code: taxTypeForm.code.trim(),
        name: taxTypeForm.name.trim(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tax-types", firmId] });
      setEditingTaxType(null);
      setMasterDrawer(null);
      setReceipt("El tipo de impuesto quedó actualizado.");
    },
  });
  const toggleTaxType = useMutation({
    mutationFn: (row: TaxTypeOption) =>
      api.patch<TaxTypeOption>(`/tax/types/${row.id}`, { isActive: !row.isActive }),
    onSuccess: (_updated, row) => {
      void queryClient.invalidateQueries({ queryKey: ["tax-types", firmId] });
      setReceipt(row.isActive ? "El tipo de impuesto quedó oculto." : "El tipo de impuesto vuelve a mostrarse.");
    },
  });

  const createActivity = useMutation({
    mutationFn: () =>
      api.post<CatalogActivityRow>("/tax/activities", {
        code: normalizeActivityCode(activityForm.code),
        name: activityForm.name.trim(),
        jurisdictionId: activityForm.jurisdictionId,
        ...(activityForm.source.trim() ? { source: activityForm.source.trim() } : {}),
        validFrom: activityForm.validFrom,
        ...(activityForm.validTo ? { validTo: activityForm.validTo } : {}),
        ...(duplicateOfId ? { duplicateOfId } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tax-activities-catalog", firmId] });
      setActivityForm(emptyActivityForm);
      setDuplicateOfId(null);
      setActivityDrawer(null);
      setReceipt("La actividad quedó registrada en el catálogo.");
    },
  });
  const updateActivity = useMutation({
    mutationFn: () =>
      api.patch<CatalogActivityRow>(`/tax/activities/${editingActivity?.id ?? ""}`, {
        code: normalizeActivityCode(activityForm.code),
        name: activityForm.name.trim(),
        jurisdictionId: activityForm.jurisdictionId,
        source: activityForm.source.trim() ? activityForm.source.trim() : null,
        validFrom: activityForm.validFrom,
        ...(activityForm.validTo ? { validTo: activityForm.validTo } : { validTo: null }),
      }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ["tax-activities-catalog", firmId] });
      setEditingActivity(null);
      setActivityForm(emptyActivityForm);
      setActivityDrawer(null);
      if (updated.codeChange) {
        const { previousCode, updatedReferences, retainedReferences } = updated.codeChange;
        const updatedLabel = `${updatedReferences} ${updatedReferences === 1 ? "referencia actualizada" : "referencias actualizadas"}`;
        const retainedLabel = retainedReferences > 0
          ? `${retainedReferences} ${retainedReferences === 1 ? "referencia conserva" : "referencias conservan"} el código anterior (${previousCode}).`
          : "No quedan referencias al código anterior.";
        setReceipt(`Se propagó el cambio de código ${previousCode} → ${updated.code}: ${updatedLabel}. ${retainedLabel}`);
      } else {
        setReceipt("Los datos de la actividad quedaron actualizados.");
      }
    },
  });
  // Desactivar conserva el historial. El Titular también puede eliminar una
  // actividad UI sin dependencias desde su preview de impacto.
  const toggleActivity = useMutation({
    mutationFn: (row: CatalogActivityRow) =>
      api.post<CatalogActivityRow & { activeClientLinks?: number }>(
        `/tax/activities/${row.id}/${row.isActive ? "deactivate" : "activate"}`,
      ),
    onSuccess: (updated, row) => {
      void queryClient.invalidateQueries({ queryKey: ["tax-activities-catalog", firmId] });
      setActivityDrawer(null);
      if (row.isActive) {
        setReceipt("La actividad quedó oculta en los selectores. Sus vínculos y reglas siguen asociados al registro.");
      } else {
        setReceipt("La actividad vuelve a mostrarse en los selectores.");
      }
    },
  });

  if (!firmId) {
    return <EmptyState title="Seleccioná un estudio" description="Elegí un estudio para consultar sus catálogos fiscales." />;
  }
  if (!capabilities.has("tax.rules.read")) {
    return <EmptyState title="Acceso restringido" description="No tenés permiso para consultar catálogos fiscales." />;
  }

  const matchingAuthorities = selectionOptions<TaxAuthorityRow>(authoritiesQuery.data ?? [], regimeForm.authorityId).filter(
    (authority) => authority.jurisdictionId === regimeForm.jurisdictionId,
  );
  const failedQueries = [
    { label: "jurisdicciones", query: jurisdictionsQuery },
    { label: "impuestos", query: taxTypesQuery },
    { label: "organismos recaudadores", query: authoritiesQuery },
    { label: "regímenes", query: regimesQuery },
    { label: "actividades económicas", query: activitiesQuery },
  ].filter((item) => item.query.isError);

  const jurisdictions = jurisdictionsQuery.data ?? [];
  const taxTypes = taxTypesQuery.data ?? [];
  const calcFamilies = calcFamiliesQuery.data ?? [];
  const selectableJurisdictions = jurisdictions.filter((row) => row.isActive);
  const selectableTaxTypes = taxTypes.filter((row) => row.isActive);
  const jurisdictionLabel = (jurisdiction: JurisdictionOption) => {
    const parent = jurisdiction.parent ?? jurisdictions.find((item) => item.id === jurisdiction.parentId);
    const ancestry = parent ? `, ${parent.name}` : "";
    return `${jurisdiction.name} — ${jurisdictionKindLabel[jurisdiction.kind]}${ancestry} (${jurisdiction.code})`;
  };
  const jurisdictionName = (jurisdictionId: string) => {
    const jurisdiction = jurisdictions.find((item) => item.id === jurisdictionId);
    return jurisdiction ? `${jurisdictionLabel(jurisdiction)}${!jurisdiction.isActive ? " (oculto)" : ""}` : "—";
  };
  const activityCodeValid = ACTIVITY_CODE_PATTERN.test(normalizeActivityCode(activityForm.code));
  const activityValidityValid =
    !activityForm.validTo || activityForm.validFrom <= activityForm.validTo;

  const authorities = authoritiesQuery.data ?? [];
  const regimes = regimesQuery.data ?? [];
  const activities = activitiesQuery.data ?? [];
  const selectableAuthorities = authorities.filter((row) => row.isActive);
  // El régimen puede venir con el organismo "plano": se completa con la lista de organismos.
  const authorityOf = (row: TaxRegimeRow) =>
    authorities.find((item) => item.id === row.authority.id) ?? row.authority;
  const authorityJurisdictionName = (row: TaxRegimeRow) =>
    authorityOf(row).jurisdiction?.name ??
    jurisdictionsQuery.data?.find((item) => item.id === authorityOf(row).jurisdictionId)?.name ??
    "otra jurisdicción";
  const regimeMismatch = (row: TaxRegimeRow) => {
    const authorityJurisdictionId = authorityOf(row).jurisdictionId;
    return Boolean(authorityJurisdictionId) && authorityJurisdictionId !== row.jurisdiction.id;
  };
  const mismatchedRegimes = regimes.filter(regimeMismatch);
  const regimesByAuthority = (authorityId: string) =>
    regimes.filter((row) => row.authority.id === authorityId);
  const originKnown = [...jurisdictions, ...taxTypes, ...authorities, ...regimes, ...activities].some((row) => row.origin);
  const studioRecords = [...jurisdictions, ...taxTypes, ...authorities, ...regimes, ...activities].filter(
    (row) => row.origin === "UI",
  ).length;
  const referenceRecords = [...jurisdictions, ...taxTypes, ...authorities, ...regimes, ...activities].filter(
    (row) => row.origin === "REFERENCE",
  ).length;
  const selectedUsageSummary = usageQuery.isLoading
    ? "Verificando usos…"
    : usageQuery.isError
      ? "No pudimos consultar los usos del registro."
      : usageQuery.data?.used
        ? `Se usa en ${usageQuery.data.count} lugares: ${usageQuery.data.places.map((place) => `${place.label} (${place.count})`).join(", ")}`
        : "Sin usos registrados.";
  const canEditSelected = canPropose;

  const searchQuery = normalizeSearch(search);
  const textMatch = (...parts: Array<string | null | undefined>) =>
    !searchQuery || normalizeSearch(parts.filter(Boolean).join(" ")).includes(searchQuery);
  const commonMatch = (
    row: { isActive: boolean; origin?: "REFERENCE" | "UI" },
    jurisdictionId: string,
  ) =>
    (!jurisdictionFilter || jurisdictionId === jurisdictionFilter) &&
    (!originFilter || row.origin === originFilter) &&
    (!stateFilter || (stateFilter === "active") === row.isActive);

  const visibleAuthorities = authorities.filter(
    (row) =>
      commonMatch(row, row.jurisdictionId) &&
      textMatch(row.code, row.name, row.jurisdiction.name, row.jurisdiction.code),
  );
  const visibleRegimes = regimes.filter(
    (row) =>
      commonMatch(row, row.jurisdiction.id) &&
      (!alertsOnly || regimeMismatch(row)) &&
      textMatch(
        row.code,
        row.name,
        row.taxType.name,
        row.taxType.code,
        row.jurisdiction.name,
        row.authority.code,
        row.authority.name,
      ),
  );
  const visibleActivities = activities.filter(
    (row) =>
      commonMatch(row, row.jurisdictionId) &&
      textMatch(row.code, row.name, row.source, jurisdictionName(row.jurisdictionId)),
  );
  const visibleJurisdictions = jurisdictions.filter(
    (row) =>
      (!jurisdictionFilter || row.id === jurisdictionFilter || row.parentId === jurisdictionFilter) &&
      (!originFilter || row.origin === originFilter) &&
      (!stateFilter || (stateFilter === "active") === row.isActive) &&
      textMatch(row.code, row.name, jurisdictionKindLabel[row.kind], row.parent?.name),
  );
  const visibleTaxTypes = taxTypes.filter(
    (row) =>
      (!originFilter || row.origin === originFilter) &&
      (!stateFilter || (stateFilter === "active") === row.isActive) &&
      textMatch(row.code, row.name),
  );

  const selectedJurisdiction = jurisdictions.find((row) => row.id === selectedId) ?? null;
  const duplicateJurisdictionSource = jurisdictions.find((row) => row.id === duplicateOfId) ?? null;
  const selectedTaxType = taxTypes.find((row) => row.id === selectedId) ?? null;
  const selectedAuthority = authorities.find((row) => row.id === selectedId) ?? null;
  const selectedRegime = regimes.find((row) => row.id === selectedId) ?? null;
  const selectedActivity = activities.find((row) => row.id === selectedId) ?? null;
  const inspectorOpen =
    (tab === "jurisdictions" && Boolean(selectedJurisdiction)) ||
    (tab === "taxTypes" && Boolean(selectedTaxType)) ||
    (tab === "authorities" && Boolean(selectedAuthority)) ||
    (tab === "regimes" && Boolean(selectedRegime)) ||
    (tab === "activities" && Boolean(selectedActivity));

  const switchTab = (next: CatalogTab) => {
    setTab(next);
    setSelectedId(null);
    setAlertsOnly(false);
    setDrawer(null);
    setMasterDrawer(null);
    setActivityDrawer(null);
  };

  const openActivityEdit = (row: CatalogActivityRow) => {
    setEditingActivity(row);
    setDuplicateOfId(null);
    setActivityForm({
      code: row.code,
      name: row.name,
      jurisdictionId: row.jurisdictionId,
      source: row.source ?? "",
      validFrom: row.validFrom.slice(0, 10),
      validTo: row.validTo?.slice(0, 10) ?? "",
    });
    setActivityDrawer("edit");
  };
  const openJurisdictionEdit = (row: JurisdictionOption) => {
    setEditingJurisdiction(row);
    setDuplicateOfId(null);
    setJurisdictionForm({ code: row.code, name: row.name, kind: row.kind, parentId: row.parentId ?? "" });
    setMasterDrawer("jurisdiction-edit");
  };
  const openTaxTypeEdit = (row: TaxTypeOption) => {
    setEditingTaxType(row);
    setDuplicateOfId(null);
    setTaxTypeForm({ code: row.code, name: row.name, defaultFamilyId: row.defaultFamilyId ?? "" });
    setMasterDrawer("tax-type-edit");
  };

  const openAuthorityEdit = (row: TaxAuthorityRow) => {
    setEditingAuthority(row);
    setDuplicateOfId(null);
    setAuthorityForm({ code: row.code, name: row.name, jurisdictionId: row.jurisdictionId });
    setDrawer("authority-edit");
  };
  const openRegimeEdit = (row: TaxRegimeRow) => {
    setEditingRegime(row);
    setDuplicateOfId(null);
    setRegimeForm({
      code: row.code,
      name: row.name,
      taxTypeId: row.taxType.id,
      calcFamilyId: row.calcFamilyId ?? row.taxType.defaultFamilyId ?? "",
      jurisdictionId: row.jurisdiction.id,
      authorityId: row.authority.id,
    });
    setDrawer("regime-edit");
  };
  const duplicateJurisdiction = (row: JurisdictionOption) => {
    const copySuffix = " (copia)";
    setDuplicateOfId(row.id);
    setJurisdictionForm({
      code: suggestedCode(row.code, jurisdictions.map((item) => item.code)),
      name: `${row.name.slice(0, 160 - copySuffix.length).trimEnd()}${copySuffix}`,
      kind: row.kind,
      parentId: row.parentId ?? "",
    });
    setMasterDrawer("jurisdiction-create");
  };
  const duplicateTaxType = (row: TaxTypeOption) => {
    setDuplicateOfId(row.id);
    setTaxTypeForm({
      code: suggestedCode(row.code, taxTypes.map((item) => item.code)),
      name: row.name,
      defaultFamilyId: row.defaultFamilyId ?? "",
    });
    setMasterDrawer("tax-type-create");
  };
  const duplicateAuthority = (row: TaxAuthorityRow) => {
    setDuplicateOfId(row.id);
    setAuthorityForm({
      code: suggestedCode(row.code, authorities.map((item) => item.code)),
      name: row.name,
      jurisdictionId: row.jurisdictionId,
    });
    setDrawer("authority-create");
  };
  const duplicateRegime = (row: TaxRegimeRow) => {
    setDuplicateOfId(row.id);
    setRegimeForm({
      code: suggestedCode(row.code, regimes.map((item) => item.code)),
      name: row.name,
      taxTypeId: row.taxType.id,
      calcFamilyId: row.calcFamilyId ?? row.taxType.defaultFamilyId ?? "",
      jurisdictionId: row.jurisdiction.id,
      authorityId: row.authority.id,
    });
    setDrawer("regime-create");
  };
  const duplicateActivity = (row: CatalogActivityRow) => {
    setDuplicateOfId(row.id);
    setEditingActivity(null);
    setActivityForm({
      code: suggestedCode(row.code, activities.filter((item) => item.jurisdictionId === row.jurisdictionId).map((item) => item.code)),
      name: row.name,
      jurisdictionId: row.jurisdictionId,
      source: row.source ?? "",
      validFrom: row.validFrom.slice(0, 10),
      validTo: row.validTo?.slice(0, 10) ?? "",
    });
    setActivityDrawer("create");
  };

  const jurisdictionsReady = selectableJurisdictions.length > 0;
  const regimePrerequisitesLoaded =
    !jurisdictionsQuery.isLoading && !taxTypesQuery.isLoading && !authoritiesQuery.isLoading &&
    !jurisdictionsQuery.isError && !taxTypesQuery.isError && !authoritiesQuery.isError;
  const canCreateRegime =
    jurisdictionsReady &&
    selectableTaxTypes.length > 0 &&
    selectableAuthorities.length > 0;
  const createLabel = {
    jurisdictions: "Nueva jurisdicción",
    taxTypes: "Nuevo tipo de impuesto",
    authorities: "Nuevo organismo",
    regimes: "Nuevo régimen",
    activities: "Nueva actividad",
  }[tab];
  const createDisabled =
    tab === "regimes"
      ? !regimePrerequisitesLoaded || !canCreateRegime
      : tab === "activities"
        ? !jurisdictionsReady
        : false;
  const openCreate = () => {
    if (!canPropose || createDisabled) return;
    setDuplicateOfId(null);
    setEditingActivity(null);
    setEditingAuthority(null);
    setEditingRegime(null);
    if (tab === "jurisdictions") {
      setJurisdictionForm(emptyJurisdictionForm);
      setMasterDrawer("jurisdiction-create");
    } else if (tab === "taxTypes") {
      setTaxTypeForm(emptyTaxTypeForm);
      setMasterDrawer("tax-type-create");
    } else if (tab === "authorities") setDrawer("authority-create");
    else if (tab === "regimes") setDrawer("regime-create");
    else {
      setEditingActivity(null);
      setActivityForm(emptyActivityForm);
      setActivityDrawer("create");
    }
  };
  createRef.current = openCreate;

  const tabHints: Record<CatalogTab, string> = {
    jurisdictions: "Jerarquía fiscal: Nación → provincia → municipio. El código es editable y los vínculos se conservan por identificador.",
    taxTypes: "Tipos de impuesto disponibles para los regímenes fiscales del estudio.",
    authorities:
      "Quién recauda cada impuesto según la jurisdicción: ARCA en Nación, la DGR provincial o la dirección municipal de rentas.",
    regimes: "Cada régimen requiere impuesto, jurisdicción y organismo recaudador compatibles.",
    activities:
      "Editá la actividad o creá una nueva versión; ocultar conserva sus vínculos y reglas.",
  };
  const visibleCount =
    tab === "jurisdictions" ? visibleJurisdictions.length
      : tab === "taxTypes" ? visibleTaxTypes.length
        : tab === "authorities" ? visibleAuthorities.length
          : tab === "regimes" ? visibleRegimes.length
            : visibleActivities.length;
  const totalCount =
    tab === "jurisdictions" ? jurisdictions.length
      : tab === "taxTypes" ? taxTypes.length
        : tab === "authorities" ? authorities.length
          : tab === "regimes" ? regimes.length
            : activities.length;

  const tableFooter = (
    <>
      <span>
        {visibleCount} de {totalCount}
      </span>
      <span className="dense-table-foot__hint">{tabHints[tab]}</span>
      <span className="dense-table-foot__spacer" />
      <ShortcutHint
        items={[
          ["↑↓", "navegar"],
          ["/", "buscar"],
          ...(canPropose ? ([["N", "nuevo"]] as Array<[string, string]>) : []),
          ["Esc", "cerrar"],
        ]}
      />
    </>
  );

  const loadingFor = (loading: boolean, label: string) =>
    loading ? (
      <div className="dense-table-card">
        <p className="muted-copy dense-empty">{label}</p>
      </div>
    ) : null;

  const deleteButton = (path: string) => (
    <Button
      size="sm"
      variant="danger"
      onClick={() => setDeletingTarget({ path: `/firms/${firmId}${path}` })}
    >
      Eliminar
    </Button>
  );

  let inspector: ReactNode = null;
  if (tab === "jurisdictions" && selectedJurisdiction) {
    const parent = selectedJurisdiction.parent ?? jurisdictions.find((row) => row.id === selectedJurisdiction.parentId);
    const ownedUi = isOwnedUiRecord(selectedJurisdiction, firmId);
    inspector = (
      <Inspector
        label="Detalle de la jurisdicción"
        eyebrow="Jurisdicción"
        title={selectedJurisdiction.code}
        subtitle={selectedJurisdiction.name}
        onClose={() => setSelectedId(null)}
        footer={canPropose || (canDelete && ownedUi && usageQuery.data?.used === false) ? (
          <InspectorActions
            onEdit={canEditSelected ? () => openJurisdictionEdit(selectedJurisdiction) : undefined}
            menu={canDelete && ownedUi && usageQuery.data?.used === false
              ? deleteButton(`/tax/jurisdictions/${selectedJurisdiction.id}`)
              : null}
          >
            {canPropose ? (
              <Button size="sm" variant="secondary" onClick={() => duplicateJurisdiction(selectedJurisdiction)}>
                Duplicar
              </Button>
            ) : null}
            {canPropose ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => toggleJurisdiction.mutate(selectedJurisdiction)}
                loading={toggleJurisdiction.isPending && toggleJurisdiction.variables?.id === selectedJurisdiction.id}
              >
                {selectedJurisdiction.isActive ? "Ocultar" : "Mostrar"}
              </Button>
            ) : null}
          </InspectorActions>
        ) : undefined}
      >
        <InspectorSection title="Ficha">
          <InspectorFacts
            items={[
              ["Nivel", jurisdictionKindLabel[selectedJurisdiction.kind]],
              ["Padre", parent ? parent.name : "—"],
              ["Origen", <OriginBadge key="origin" origin={selectedJurisdiction.origin} />],
              ["Estado", <ActiveBadge key="state" active={selectedJurisdiction.isActive} />],
            ]}
          />
          <MutationError error={toggleJurisdiction.error} />
        </InspectorSection>
        <InspectorSection title="Uso"><p>{selectedUsageSummary}</p></InspectorSection>
      </Inspector>
    );
  } else if (tab === "taxTypes" && selectedTaxType) {
    const ownedUi = isOwnedUiRecord(selectedTaxType, firmId);
    inspector = (
      <Inspector
        label="Detalle del tipo de impuesto"
        eyebrow="Tipo de impuesto"
        title={selectedTaxType.code}
        subtitle={selectedTaxType.name}
        onClose={() => setSelectedId(null)}
        footer={canPropose || (canDelete && ownedUi && usageQuery.data?.used === false) ? (
          <InspectorActions
            onEdit={canEditSelected ? () => openTaxTypeEdit(selectedTaxType) : undefined}
            menu={canDelete && ownedUi && usageQuery.data?.used === false
              ? deleteButton(`/tax/types/${selectedTaxType.id}`)
              : null}
          >
            {canPropose ? (
              <Button size="sm" variant="secondary" onClick={() => duplicateTaxType(selectedTaxType)}>
                Duplicar
              </Button>
            ) : null}
            {canPropose ? (
              <Button size="sm" variant="ghost" onClick={() => toggleTaxType.mutate(selectedTaxType)}>
                {selectedTaxType.isActive ? "Ocultar" : "Mostrar"}
              </Button>
            ) : null}
          </InspectorActions>
        ) : undefined}
      >
        <InspectorSection title="Ficha">
          <InspectorFacts
            items={[
              ["Origen", <OriginBadge key="origin" origin={selectedTaxType.origin} />],
              ["Estado", <ActiveBadge key="state" active={selectedTaxType.isActive} />],
            ]}
          />
          <MutationError error={toggleTaxType.error} />
        </InspectorSection>
        <InspectorSection title="Uso"><p>{selectedUsageSummary}</p></InspectorSection>
      </Inspector>
    );
  } else if (tab === "authorities" && selectedAuthority) {
    const linked = regimesByAuthority(selectedAuthority.id);
    const ownedUi = isOwnedUiRecord(selectedAuthority, firmId);
    inspector = (
      <Inspector
        label="Detalle del organismo"
        eyebrow="Organismo"
        title={selectedAuthority.code}
        subtitle={selectedAuthority.name}
        onClose={() => setSelectedId(null)}
        footer={canPropose || (canDelete && ownedUi && usageQuery.data?.used === false) ? (
          <InspectorActions
            onEdit={canEditSelected ? () => openAuthorityEdit(selectedAuthority) : undefined}
            menu={canDelete && ownedUi && usageQuery.data?.used === false
              ? deleteButton(`/tax/authorities/${selectedAuthority.id}`)
              : null}
          >
            {canPropose ? (
              <Button size="sm" variant="secondary" onClick={() => duplicateAuthority(selectedAuthority)}>
                Duplicar
              </Button>
            ) : null}
            {canPropose ? (
              <Button size="sm" variant="ghost" onClick={() => toggleAuthority.mutate(selectedAuthority)}>
                {selectedAuthority.isActive ? "Ocultar" : "Mostrar"}
              </Button>
            ) : null}
          </InspectorActions>
        ) : undefined}
      >
        <InspectorSection title="Ficha">
          <InspectorFacts
            items={[
              [
                "Jurisdicción",
                <>
                  {selectedAuthority.jurisdiction.name}{!selectedAuthority.jurisdiction.isActive ? " (oculto)" : " "}
                  <span className="dense-chip">{selectedAuthority.jurisdiction.code}</span>
                </>,
              ],
              ["Origen", selectedAuthority.origin ? <OriginBadge key="origin" origin={selectedAuthority.origin} /> : null],
              ["Estado", <ActiveBadge key="state" active={selectedAuthority.isActive} />],
            ]}
          />
        </InspectorSection>
        <InspectorSection title="Uso"><p>{selectedUsageSummary}</p></InspectorSection>
        <InspectorSection title={`Regímenes vinculados · ${linked.length}`}>
          {linked.length > 0 ? (
            <ul className="dense-linked">
              {linked.map((row) => (
                <li key={row.id}>
                  <strong>{row.code}</strong>
                  <span title={row.name}>{row.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>Ningún régimen usa este organismo.</p>
          )}
        </InspectorSection>
      </Inspector>
    );
  } else if (tab === "regimes" && selectedRegime) {
    const mismatch = regimeMismatch(selectedRegime);
    const ownedUi = isOwnedUiRecord(selectedRegime, firmId);
    inspector = (
      <Inspector
        label="Detalle del régimen"
        eyebrow="Régimen"
        title={selectedRegime.code}
        subtitle={selectedRegime.name}
        onClose={() => setSelectedId(null)}
        footer={canPropose || (canDelete && ownedUi && usageQuery.data?.used === false) ? (
          <InspectorActions
            onEdit={canEditSelected ? () => openRegimeEdit(selectedRegime) : undefined}
            menu={canDelete && ownedUi && usageQuery.data?.used === false
              ? deleteButton(`/tax/regimes/${selectedRegime.id}`)
              : null}
          >
            {canPropose ? (
              <Button size="sm" variant="secondary" onClick={() => duplicateRegime(selectedRegime)}>
                Duplicar
              </Button>
            ) : null}
            {canPropose ? (
              <Button size="sm" variant="ghost" onClick={() => toggleRegime.mutate(selectedRegime)}>
                {selectedRegime.isActive ? "Ocultar" : "Mostrar"}
              </Button>
            ) : null}
          </InspectorActions>
        ) : undefined}
      >
        <InspectorSection title="Cadena de vinculación">
          <div className="dense-chain">
            <span>
              <small>Impuesto</small>
              {selectedRegime.taxType.name}{!selectedRegime.taxType.isActive ? " (oculto)" : ""}
            </span>
            <span className="dense-chain__arrow" aria-hidden="true">
              →
            </span>
            <span>
              <small>Jurisdicción</small>
              {selectedRegime.jurisdiction.name}{!selectedRegime.jurisdiction.isActive ? " (oculto)" : ""}
            </span>
            <span className="dense-chain__arrow" aria-hidden="true">
              →
            </span>
            <span className={mismatch ? "dense-chain__bad" : undefined}>
              <small>Organismo</small>
              {selectedRegime.authority.code}{!selectedRegime.authority.isActive ? " (oculto)" : ""}
            </span>
          </div>
          <div className={`dense-note ${mismatch ? "dense-note--warn" : "dense-note--ok"}`}>
            <Icon name={mismatch ? "alert" : "check"} size={14} />
            <span>
              {mismatch
                ? `${selectedRegime.authority.code} recauda en ${authorityJurisdictionName(selectedRegime)}; el régimen es de ${selectedRegime.jurisdiction.name}. Revisá el organismo.`
                : "El organismo corresponde a la jurisdicción del régimen."}
            </span>
          </div>
        </InspectorSection>
        <InspectorSection title="Ficha">
          <InspectorFacts
            items={[
              [
                "Impuesto",
                <>
                  {selectedRegime.taxType.name}{!selectedRegime.taxType.isActive ? " (oculto)" : " "}
                  <span className="dense-chip">{selectedRegime.taxType.code}</span>
                </>,
              ],
              ["Organismo", `${selectedRegime.authority.name}${!selectedRegime.authority.isActive ? " (oculto)" : ""}`],
              ["Origen", selectedRegime.origin ? <OriginBadge key="origin" origin={selectedRegime.origin} /> : null],
              ["Estado", <ActiveBadge key="state" active={selectedRegime.isActive} />],
            ]}
          />
        </InspectorSection>
        <InspectorSection title="Uso"><p>{selectedUsageSummary}</p></InspectorSection>
      </Inspector>
    );
  } else if (tab === "activities" && selectedActivity) {
    const ownedUi = isOwnedUiRecord(selectedActivity, firmId);
    inspector = (
      <Inspector
        label="Detalle de la actividad"
        eyebrow="Actividad económica"
        title={selectedActivity.code}
        subtitle={selectedActivity.name}
        onClose={() => setSelectedId(null)}
        footer={
          canPropose || (canDelete && ownedUi && usageQuery.data?.used === false) ? (
            <InspectorActions
              onEdit={canEditSelected ? () => openActivityEdit(selectedActivity) : undefined}
              menu={canDelete && ownedUi && usageQuery.data?.used === false
                ? deleteButton(`/tax/activities/${selectedActivity.id}`)
                : null}
            >
              {canPropose ? (
                <Button size="sm" variant="secondary" onClick={() => duplicateActivity(selectedActivity)}>
                  Duplicar
                </Button>
              ) : null}
              {canPropose ? (
                selectedActivity.isActive ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditingActivity(selectedActivity);
                      setActivityDrawer("deactivate");
                    }}
                  >
                    Ocultar
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleActivity.mutate(selectedActivity)}
                    loading={
                      toggleActivity.isPending && toggleActivity.variables?.id === selectedActivity.id
                    }
                  >
                    Mostrar
                  </Button>
                )
              ) : null}
            </InspectorActions>
          ) : undefined
        }
      >
        <InspectorSection title="Ficha">
          <InspectorFacts
            items={[
              ["Jurisdicción", jurisdictionName(selectedActivity.jurisdictionId)],
              ["Fuente", selectedActivity.source ?? "—"],
              [
                "Vigencia",
                validityLabel(selectedActivity.validFrom, selectedActivity.validTo),
              ],
              ["Origen", selectedActivity.origin ? <OriginBadge key="origin" origin={selectedActivity.origin} /> : null],
              ["Estado", <ActivityStateBadge key="state" isActive={selectedActivity.isActive} />],
            ]}
          />
        </InspectorSection>
        <InspectorSection title="Uso"><p>{selectedUsageSummary}</p></InspectorSection>
      </Inspector>
    );
  }

  const authorityColumns: DenseColumn<TaxAuthorityRow>[] = [
    {
      key: "code",
      header: "Código",
      sortValue: (row) => row.code,
      render: (row) => <span className="dense-code">{row.code}</span>,
    },
    {
      key: "name",
      header: "Organismo",
      sortValue: (row) => row.name,
      render: (row) => <span title={row.name}>{row.name}</span>,
    },
    {
      key: "jurisdiction",
      header: "Jurisdicción",
      sortValue: (row) => row.jurisdiction.name,
      render: (row) => (
        <span className="dense-cell-inline">
          {row.jurisdiction.name}
          <span className="dense-chip dense-chip--hide-narrow">{row.jurisdiction.code}</span>
        </span>
      ),
    },
    {
      key: "regimes",
      header: "Regímenes",
      align: "right",
      sortValue: (row) => regimesByAuthority(row.id).length,
      render: (row) => regimesByAuthority(row.id).length || "—",
    },
    {
      key: "origin",
      header: "Origen",
      secondary: true,
      sortValue: (row) => row.origin ?? "",
      render: (row) => <OriginBadge origin={row.origin} />,
    },
    {
      key: "state",
      header: "Estado",
      secondary: true,
      sortValue: (row) => row.isActive,
      render: (row) => <ActiveBadge active={row.isActive} />,
    },
  ];

  const regimeColumns: DenseColumn<TaxRegimeRow>[] = [
    {
      key: "code",
      header: "Código",
      sortValue: (row) => row.code,
      render: (row) => <span className="dense-code">{row.code}</span>,
    },
    {
      key: "name",
      header: "Régimen",
      sortValue: (row) => row.name,
      render: (row) => <span title={row.name}>{row.name}</span>,
    },
    {
      key: "taxType",
      header: "Impuesto",
      secondary: true,
      sortValue: (row) => row.taxType.name,
      render: (row) => (
        <span className="dense-cell-inline" title={`${row.taxType.name} (${row.taxType.code})`}>
          {row.taxType.name}
          <span className="dense-chip">{row.taxType.code}</span>
        </span>
      ),
    },
    {
      key: "jurisdiction",
      header: "Jurisdicción",
      sortValue: (row) => row.jurisdiction.name,
      render: (row) => (
        <span className="dense-cell-inline">
          {row.jurisdiction.name}
          <span className="dense-chip dense-chip--hide-narrow">{row.jurisdiction.code}</span>
        </span>
      ),
    },
    {
      key: "authority",
      header: "Organismo",
      sortValue: (row) => row.authority.code,
      render: (row) => (
        <span className="dense-chip" title={row.authority.name}>
          {row.authority.code}
        </span>
      ),
    },
    {
      key: "coherence",
      header: "Coherencia",
      sortValue: (row) => (regimeMismatch(row) ? 0 : 1),
      render: (row) =>
        regimeMismatch(row) ? (
          <span
            className="dense-coherence dense-coherence--bad"
            title={`${row.authority.code} recauda en ${authorityJurisdictionName(row)}, no en ${row.jurisdiction.name}`}
          >
            <Icon name="alert" size={14} />
            Revisar
          </span>
        ) : (
          <span className="dense-coherence dense-coherence--ok">
            <Icon name="check" size={14} />
            OK
          </span>
        ),
    },
    {
      key: "origin",
      header: "Origen",
      secondary: true,
      sortValue: (row) => row.origin ?? "",
      render: (row) => <OriginBadge origin={row.origin} />,
    },
    {
      key: "state",
      header: "Estado",
      secondary: true,
      sortValue: (row) => row.isActive,
      render: (row) => <ActiveBadge active={row.isActive} />,
    },
  ];

  const activityColumns: DenseColumn<CatalogActivityRow>[] = [
    {
      key: "code",
      header: "Código",
      sortValue: (row) => row.code,
      render: (row) => (
        <span className="dense-code" title={row.code}>
          {row.code}
        </span>
      ),
    },
    {
      key: "name",
      header: "Actividad",
      sortValue: (row) => row.name,
      render: (row) => <span title={row.name}>{row.name}</span>,
    },
    {
      key: "jurisdiction",
      header: "Jurisdicción",
      sortValue: (row) => jurisdictionName(row.jurisdictionId),
      render: (row) => {
        const jurisdiction = jurisdictions.find((item) => item.id === row.jurisdictionId);
        return (
          <span className="dense-activity-jurisdiction" title={jurisdictionName(row.jurisdictionId)}>
            <span>{jurisdiction?.name ?? "—"}</span>
            {jurisdiction ? (
              <small>
                {jurisdictionKindLabel[jurisdiction.kind]} · {jurisdiction.code}
                {!jurisdiction.isActive ? " (oculta)" : ""}
              </small>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "source",
      header: "Fuente",
      sortValue: (row) => row.source ?? "",
      render: (row) => <span title={row.source ?? undefined}>{row.source ?? "—"}</span>,
    },
    {
      key: "validity",
      header: "Vigencia",
      sortValue: (row) => row.validFrom,
      render: (row) => validityLabel(row.validFrom, row.validTo),
    },
    {
      key: "origin",
      header: "Origen",
      secondary: true,
      sortValue: (row) => row.origin ?? "",
      render: (row) => <OriginBadge origin={row.origin} />,
    },
    {
      key: "state",
      header: "Estado",
      secondary: true,
      sortValue: (row) => row.isActive,
      render: (row) => <ActivityStateBadge isActive={row.isActive} />,
    },
  ];

  const jurisdictionParentLabel = (jurisdiction: JurisdictionOption) => {
    const parent = jurisdictions.find((row) => row.id === jurisdiction.parentId) ?? jurisdiction.parent;
    const hidden = parent && "isActive" in parent && !parent.isActive;
    return parent ? `${parent.name}${hidden ? " (oculto)" : ""}` : "—";
  };
  const jurisdictionColumns: DenseColumn<JurisdictionOption>[] = [
    {
      key: "code",
      header: "Código",
      sortValue: (row) => row.code,
      render: (row) => <span className="dense-code">{row.code}</span>,
    },
    {
      key: "name",
      header: "Jurisdicción",
      sortValue: (row) => row.name,
      render: (row) => <span title={row.name}>{row.name}</span>,
    },
    {
      key: "kind",
      header: "Nivel",
      sortValue: (row) => jurisdictionKindLabel[row.kind],
      render: (row) => jurisdictionKindLabel[row.kind],
    },
    {
      key: "parent",
      header: "Padre",
      sortValue: jurisdictionParentLabel,
      render: jurisdictionParentLabel,
    },
    {
      key: "origin",
      header: "Origen",
      secondary: true,
      sortValue: (row) => row.origin ?? "",
      render: (row) => <OriginBadge origin={row.origin} />,
    },
    {
      key: "state",
      header: "Estado",
      secondary: true,
      sortValue: (row) => row.isActive,
      render: (row) => <ActiveBadge active={row.isActive} />,
    },
  ];
  const taxTypeColumns: DenseColumn<TaxTypeOption>[] = [
    {
      key: "code",
      header: "Código",
      sortValue: (row) => row.code,
      render: (row) => <span className="dense-code">{row.code}</span>,
    },
    {
      key: "name",
      header: "Tipo de impuesto",
      sortValue: (row) => row.name,
      render: (row) => <span title={row.name}>{row.name}</span>,
    },
    {
      key: "origin",
      header: "Origen",
      secondary: true,
      sortValue: (row) => row.origin ?? "",
      render: (row) => <OriginBadge origin={row.origin} />,
    },
    {
      key: "state",
      header: "Estado",
      secondary: true,
      sortValue: (row) => row.isActive,
      render: (row) => <ActiveBadge active={row.isActive} />,
    },
  ];

  const select = (key: string | null) => setSelectedId(key);

  let tableBody: ReactNode;
  if (tab === "jurisdictions") {
    tableBody =
      loadingFor(jurisdictionsQuery.isLoading, "Cargando jurisdicciones…") ??
      (jurisdictionsQuery.isError ? null : (
        <DenseTable<JurisdictionOption>
          label="Jurisdicciones"
          columns={jurisdictionColumns}
          rows={visibleJurisdictions}
          rowKey={(row) => row.id}
          selectedKey={selectedId}
          onSelect={select}
          inspectorOpen={inspectorOpen}
          rowClassName={(row) => (row.isActive ? undefined : "dense-row--muted")}
          footer={tableFooter}
          empty={
            <EmptyState
              size="compact"
              title={jurisdictions.length === 0 ? "Todavía no hay jurisdicciones" : "Ninguna jurisdicción coincide con los filtros"}
              description={jurisdictions.length === 0 ? "Creá Nación, provincia y municipio para completar el alcance fiscal del estudio." : "Probá con otro código o nombre, o quitá filtros."}
            />
          }
        />
      ));
  } else if (tab === "taxTypes") {
    tableBody =
      loadingFor(taxTypesQuery.isLoading, "Cargando tipos de impuesto…") ??
      (taxTypesQuery.isError ? null : (
        <DenseTable<TaxTypeOption>
          label="Tipos de impuesto"
          columns={taxTypeColumns}
          rows={visibleTaxTypes}
          rowKey={(row) => row.id}
          selectedKey={selectedId}
          onSelect={select}
          inspectorOpen={inspectorOpen}
          rowClassName={(row) => (row.isActive ? undefined : "dense-row--muted")}
          footer={tableFooter}
          empty={
            <EmptyState
              size="compact"
              title={taxTypes.length === 0 ? "Todavía no hay tipos de impuesto" : "Ningún tipo de impuesto coincide con los filtros"}
              description={taxTypes.length === 0 ? "Creá un tipo de impuesto para poder iniciar regímenes fiscales." : "Probá con otro código o nombre, o quitá filtros."}
            />
          }
        />
      ));
  } else if (tab === "authorities") {
    tableBody =
      loadingFor(authoritiesQuery.isLoading, "Cargando organismos recaudadores…") ??
      (authoritiesQuery.isError ? null : (
        <DenseTable<TaxAuthorityRow>
          label="Organismos recaudadores"
          columns={authorityColumns.filter((column) => originKnown || column.key !== "origin")}
          rows={visibleAuthorities}
          rowKey={(row) => row.id}
          selectedKey={selectedId}
          onSelect={select}
          inspectorOpen={inspectorOpen}
          rowClassName={(row) => (row.isActive ? undefined : "dense-row--muted")}
          footer={tableFooter}
          empty={
            <EmptyState
              size="compact"
              title={
                selectableAuthorities.length === 0
                  ? "Todavía no hay organismos recaudadores"
                  : "Ningún organismo coincide con los filtros"
              }
              description={
                selectableAuthorities.length === 0
                  ? "Creá un organismo asociado a una jurisdicción para poder registrar regímenes."
                  : "Probá con otro código o nombre, o quitá filtros."
              }
            />
          }
        />
      ));
  } else if (tab === "regimes") {
    tableBody =
      loadingFor(regimesQuery.isLoading, "Cargando regímenes…") ??
      (regimesQuery.isError ? null : (
        <DenseTable<TaxRegimeRow>
          label="Regímenes"
          columns={regimeColumns.filter((column) => originKnown || column.key !== "origin")}
          rows={visibleRegimes}
          rowKey={(row) => row.id}
          selectedKey={selectedId}
          onSelect={select}
          inspectorOpen={inspectorOpen}
          rowClassName={(row) => (row.isActive ? undefined : "dense-row--muted")}
          footer={tableFooter}
          empty={
            <EmptyState
              size="compact"
              title={
                regimes.length === 0
                  ? "Todavía no hay regímenes fiscales"
                  : "Ningún régimen coincide con los filtros"
              }
              description={
                regimes.length === 0
                  ? "Definí un régimen con un organismo recaudador y jurisdicción verificados."
                  : "Probá con otro código o nombre, o quitá filtros."
              }
            />
          }
        />
      ));
  } else {
    tableBody =
      loadingFor(activitiesQuery.isLoading, "Cargando actividades económicas…") ??
      (activitiesQuery.isError ? null : (
        <DenseTable<CatalogActivityRow>
          label="Actividades económicas"
          columns={activityColumns.filter((column) => originKnown || column.key !== "origin")}
          rows={visibleActivities}
          rowKey={(row) => row.id}
          selectedKey={selectedId}
          onSelect={select}
          inspectorOpen={inspectorOpen}
          rowClassName={(row) => (row.isActive ? undefined : "dense-row--muted")}
          footer={tableFooter}
          empty={
            <EmptyState
              size="compact"
              title={
                searchQuery
                  ? "Ninguna actividad coincide con la búsqueda"
                  : "Todavía no hay actividades económicas"
              }
              description={
                searchQuery
                  ? "Probá con otro código o nombre."
                  : "Creá una actividad para poder vincularla a clientes y reglas fiscales."
              }
            />
          }
        />
      ));
  }

  return (
    <DensePage density={density} flow className="fiscal-catalog-page">
      <DenseHeader
        eyebrow="Administración fiscal"
        title="Catálogos fiscales"
        description="Administrá jurisdicciones, tipos de impuesto, organismos recaudadores, regímenes y actividades que organizan la configuración fiscal del estudio."
        actions={
          canPropose ? (
            <Button size="sm" onClick={openCreate} disabled={createDisabled}>
              {createLabel}
            </Button>
          ) : null
        }
      />

      <p className="dense-catalog-summary" role="status">
        <span>
          {originKnown
            ? `${studioRecords} propios, ${referenceRecords} de referencia`
            : "— propios, — de referencia"}
        </span>
        <span>
          {regimesQuery.isLoading
            ? "— alertas"
            : `${mismatchedRegimes.length} ${mismatchedRegimes.length === 1 ? "alerta" : "alertas"}`}
        </span>
      </p>

      {tab === "regimes" && canPropose && regimePrerequisitesLoaded && !canCreateRegime ? (
        <DenseAlert>
          {!jurisdictionsReady ? (
            <p>
              Falta una jurisdicción: creala en{" "}
              <a className="dense-link" href="#catalog-tab-jurisdictions" onClick={(event) => { event.preventDefault(); switchTab("jurisdictions"); }}>
                Jurisdicciones
              </a>.
            </p>
          ) : null}
          {selectableTaxTypes.length === 0 ? (
            <p>
              Falta un tipo de impuesto: crealo en{" "}
              <a className="dense-link" href="#catalog-tab-taxTypes" onClick={(event) => { event.preventDefault(); switchTab("taxTypes"); }}>
                Tipos de impuesto
              </a>.
            </p>
          ) : null}
          {authorities.length === 0 ? (
            <p>
              Falta un organismo recaudador: crealo en{" "}
              <a className="dense-link" href="#catalog-tab-authorities" onClick={(event) => { event.preventDefault(); switchTab("authorities"); }}>
                Organismos recaudadores
              </a>.
            </p>
          ) : null}
        </DenseAlert>
      ) : null}

      <DenseTabs<CatalogTab>
        label="Catálogos fiscales"
        idPrefix="catalog-tab"
        active={tab}
        onChange={switchTab}
        tabs={[
          { id: "jurisdictions", label: "Jurisdicciones", count: jurisdictions.length },
          { id: "taxTypes", label: "Tipos de impuesto", count: taxTypes.length },
          { id: "authorities", label: "Organismos recaudadores", count: authorities.length },
          {
            id: "regimes",
            label: "Regímenes",
            count: regimes.length,
            warnCount: mismatchedRegimes.length,
          },
          { id: "activities", label: "Actividades económicas", count: activities.length },
        ]}
      />

      {failedQueries.map(({ label, query }) => (
        <div className="form-error" role="alert" key={label}>
          <strong>No pudimos cargar {label}.</strong>{" "}
          <Button type="button" variant="text" size="row" onClick={() => void query.refetch()}>
            Reintentar
          </Button>
        </div>
      ))}

      <DenseToolbar>
        <DenseSearch
          inputRef={searchRef}
          value={search}
          onChange={setSearch}
          placeholder="Buscar código o nombre…"
        />
        <select
          className="dense-select"
          aria-label="Filtrar por jurisdicción"
          value={jurisdictionFilter}
          onChange={(event) => setJurisdictionFilter(event.target.value)}
        >
          <option value="">Jurisdicción: todas</option>
          {jurisdictions.map((jurisdiction) => (
            <option key={jurisdiction.id} value={jurisdiction.id}>
              {jurisdictionLabel(jurisdiction)}
            </option>
          ))}
        </select>
        {originKnown ? (
          <select
            className="dense-select"
            aria-label="Filtrar por origen"
            value={originFilter}
            onChange={(event) => setOriginFilter(event.target.value as "" | "REFERENCE" | "UI")}
          >
            <option value="">Origen: todos</option>
            <option value="REFERENCE">Referencia</option>
            <option value="UI">Del estudio</option>
          </select>
        ) : null}
        <select
          className="dense-select"
          aria-label="Filtrar por estado"
          value={stateFilter}
          onChange={(event) => setStateFilter(event.target.value as "" | "active" | "inactive")}
        >
          <option value="">Estado: todos</option>
          <option value="active">Activos</option>
          <option value="inactive">Inactivos</option>
        </select>
        {tab === "regimes" ? (
          <Button
            type="button"
            variant="secondary"
            size="row"
            aria-pressed={alertsOnly}
            onClick={() => setAlertsOnly((current) => !current)}
          >
            <Icon name="alert" size={14} />
            Sólo con alertas
          </Button>
        ) : null}
        <span className="dense-toolbar__spacer" />
        <DensitySwitch value={density} onChange={setDensity} />
      </DenseToolbar>

      {tab === "regimes" && mismatchedRegimes.length > 0 ? (
        <DenseAlert
          action={
            <Button size="sm" variant="secondary" onClick={() => setAlertsOnly((current) => !current)}>
              {alertsOnly ? "Quitar filtro" : "Filtrar"}
            </Button>
          }
        >
          <strong>
            {mismatchedRegimes.length}{" "}
            {mismatchedRegimes.length === 1 ? "régimen tiene" : "regímenes tienen"} un organismo que no
            corresponde a su jurisdicción:
          </strong>{" "}
          {mismatchedRegimes.map((row) => (
            <span className="dense-chip" key={row.id}>
              {row.code}
            </span>
          ))}
        </DenseAlert>
      ) : null}

      <DenseWorkspace panelId="catalog-tab-panel" inspector={inspector}>
        {tableBody}
      </DenseWorkspace>

      <ActionDrawer
        isOpen={drawer === "authority-create" || drawer === "authority-edit"}
        onClose={() => { setDrawer(null); setEditingAuthority(null); }}
        eyebrow="Catálogo fiscal del estudio"
        title={drawer === "authority-edit" ? "Editar organismo recaudador" : "Nuevo organismo recaudador"}
        description="La jurisdicción define el alcance en el que puede asignarse este organismo: ARCA recauda en Nación, las DGR en cada provincia y las direcciones de rentas en cada municipio."
      >
        <form
          className="study-form study-form--compact dense-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (editingAuthority) updateAuthority.mutate();
            else createAuthority.mutate();
          }}
        >
          <Field
            id="authority-code"
            label="Código"
            value={authorityForm.code}
            onChange={(event) => setAuthorityForm({ ...authorityForm, code: event.target.value })}
            error={codeConflict(editingAuthority ? updateAuthority.error : createAuthority.error)}
            maxLength={40}
            required
          />
          <Field
            id="authority-name"
            label="Nombre"
            value={authorityForm.name}
            onChange={(event) => setAuthorityForm({ ...authorityForm, name: event.target.value })}
            maxLength={160}
            required
          />
          <div className="ds-field dense-form__full">
            <label className="ds-field__label" htmlFor="authority-jurisdiction">Jurisdicción</label>
            <select
              id="authority-jurisdiction"
              className="ds-field__input"
              value={authorityForm.jurisdictionId}
              onChange={(event) => setAuthorityForm({ ...authorityForm, jurisdictionId: event.target.value })}
              required
            >
              <option value="">Seleccioná una jurisdicción…</option>
              {selectionOptions<JurisdictionOption>(jurisdictions, authorityForm.jurisdictionId).map((jurisdiction) => (
                <option key={jurisdiction.id} value={jurisdiction.id} disabled={!jurisdiction.isActive}>
                  {jurisdictionLabel(jurisdiction)}{!jurisdiction.isActive ? " (oculto)" : ""}
                </option>
              ))}
            </select>
          </div>
          <MutationError error={editingAuthority ? updateAuthority.error : createAuthority.error} />
          <div className="study-form__actions">
            <Button
              type="submit"
              loading={editingAuthority ? updateAuthority.isPending : createAuthority.isPending}
              disabled={!authorityForm.code.trim() || !authorityForm.name.trim() || !authorityForm.jurisdictionId}
            >
              {editingAuthority ? "Guardar cambios" : "Crear organismo"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDrawer(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      </ActionDrawer>

      <ActionDrawer
        isOpen={drawer === "regime-create" || drawer === "regime-edit"}
        onClose={() => { setDrawer(null); setEditingRegime(null); }}
        eyebrow="Catálogo fiscal del estudio"
        title={drawer === "regime-edit" ? "Editar régimen" : "Nuevo régimen"}
        description="El organismo recaudador seleccionado debe corresponder a la jurisdicción del régimen."
      >
        <form
          className="study-form study-form--compact dense-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (editingRegime) updateRegime.mutate();
            else createRegime.mutate();
          }}
        >
          <Field
            id="regime-code"
            label="Código"
            value={regimeForm.code}
            onChange={(event) => setRegimeForm({ ...regimeForm, code: event.target.value })}
            error={codeConflict(editingRegime ? updateRegime.error : createRegime.error)}
            hint={editingRegime ? "El código identifica el régimen. La familia de cálculo y la fuente de importación se configuran por separado." : undefined}
            maxLength={40}
            required
          />
          <Field
            id="regime-name"
            label="Nombre"
            value={regimeForm.name}
            onChange={(event) => setRegimeForm({ ...regimeForm, name: event.target.value })}
            maxLength={160}
            required
          />
          <div className="ds-field">
            <label className="ds-field__label" htmlFor="regime-tax-type">Impuesto</label>
            <select
              id="regime-tax-type"
              className="ds-field__input"
              value={regimeForm.taxTypeId}
              onChange={(event) => {
                const taxTypeId = event.target.value;
                const selectedTaxType = taxTypes.find((item) => item.id === taxTypeId);
                setRegimeForm({
                  ...regimeForm,
                  taxTypeId,
                  calcFamilyId: selectedTaxType?.defaultFamilyId ?? "",
                });
              }}
              required
            >
              <option value="">Seleccioná un impuesto…</option>
              {selectionOptions<TaxTypeOption>(taxTypes, regimeForm.taxTypeId).map((taxType) => (
                <option key={taxType.id} value={taxType.id} disabled={!taxType.isActive}>
                  {taxType.name} ({taxType.code}){!taxType.isActive ? " (oculto)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="ds-field">
            <label className="ds-field__label" htmlFor="regime-calc-family">Familia de cálculo</label>
            <select
              id="regime-calc-family"
              className="ds-field__input"
              value={regimeForm.calcFamilyId}
              onChange={(event) => setRegimeForm({ ...regimeForm, calcFamilyId: event.target.value })}
              required
            >
              <option value="">Seleccioná una familia…</option>
              {selectionOptions<CalcFamilyOption>(calcFamilies, regimeForm.calcFamilyId).map((family) => (
                <option key={family.id} value={family.id} disabled={!family.isActive}>
                  {family.label}{!family.isActive ? " (oculta)" : ""}
                </option>
              ))}
            </select>
            <p className="muted-copy">
              {regimeForm.calcFamilyId
                ? "La familia determina las opciones de cálculo de este régimen."
                : "Elegí una familia de cálculo para completar el régimen."}
            </p>
            {calcFamiliesQuery.isLoading ? <p className="muted-copy">Cargando familias…</p> : null}
            {!calcFamiliesQuery.isLoading && !calcFamiliesQuery.isError && calcFamilies.length === 0 ? (
              <p className="form-error" role="alert">No hay familias de cálculo disponibles para elegir.</p>
            ) : null}
            {calcFamiliesQuery.isError ? (
              <p className="form-error" role="alert">
                No pudimos cargar las familias de cálculo. <Button type="button" variant="ghost" size="sm" onClick={() => void calcFamiliesQuery.refetch()}>Reintentar</Button>
              </p>
            ) : null}
            {apiFieldIssue(editingRegime ? updateRegime.error : createRegime.error, "calcFamilyId") ? (
              <p className="form-error" role="alert">
                {apiFieldIssue(editingRegime ? updateRegime.error : createRegime.error, "calcFamilyId")}
              </p>
            ) : null}
          </div>
          <div className="ds-field">
            <label className="ds-field__label" htmlFor="regime-jurisdiction">Jurisdicción</label>
            <select
              id="regime-jurisdiction"
              className="ds-field__input"
              value={regimeForm.jurisdictionId}
              onChange={(event) => setRegimeForm({ ...regimeForm, jurisdictionId: event.target.value, authorityId: "" })}
              required
            >
              <option value="">Seleccioná una jurisdicción…</option>
              {selectionOptions<JurisdictionOption>(jurisdictions, regimeForm.jurisdictionId).map((jurisdiction) => (
                <option key={jurisdiction.id} value={jurisdiction.id} disabled={!jurisdiction.isActive}>
                  {jurisdictionLabel(jurisdiction)}{!jurisdiction.isActive ? " (oculto)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="ds-field dense-form__full">
            <label className="ds-field__label" htmlFor="regime-authority">Organismo recaudador</label>
            <select
              id="regime-authority"
              className="ds-field__input"
              value={regimeForm.authorityId}
              onChange={(event) => setRegimeForm({ ...regimeForm, authorityId: event.target.value })}
              required
              disabled={!regimeForm.jurisdictionId}
            >
              <option value="">Seleccioná un organismo…</option>
              {matchingAuthorities.map((authority) => (
                <option key={authority.id} value={authority.id} disabled={!authority.isActive}>
                  {authority.name} ({authority.code}){!authority.isActive ? " (oculto)" : ""}
                </option>
              ))}
            </select>
            {regimeForm.jurisdictionId && matchingAuthorities.length === 0 ? (
              <p className="muted-copy">Creá primero un organismo para esta jurisdicción.</p>
            ) : null}
          </div>
          {regimeForm.authorityId && regimeForm.jurisdictionId ? (
            <div className="dense-note dense-note--ok" role="status">
              <Icon name="check" size={14} />
              <span>
                Coherente:{" "}
                {matchingAuthorities.find((item) => item.id === regimeForm.authorityId)?.code ?? "el organismo"}{" "}
                recauda en {jurisdictionName(regimeForm.jurisdictionId)}.
              </span>
            </div>
          ) : null}
          <MutationError error={createRegime.error} />
          <div className="study-form__actions">
            <Button
              type="submit"
              loading={editingRegime ? updateRegime.isPending : createRegime.isPending}
              disabled={
                !regimeForm.code.trim() ||
                !regimeForm.name.trim() ||
                !regimeForm.taxTypeId ||
                !regimeForm.calcFamilyId ||
                !regimeForm.jurisdictionId ||
                !regimeForm.authorityId
              }
            >
              {editingRegime ? "Guardar cambios" : "Crear régimen"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDrawer(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      </ActionDrawer>

      {receipt ? (
        <div className="action-receipt action-receipt--page" role="status">
          <span>
            <strong>Actualización registrada</strong>
            <small>{receipt}</small>
          </span>
          <Button type="button" variant="text" size="row" aria-label="Cerrar confirmación" onClick={() => setReceipt(null)}>
            Cerrar
          </Button>
        </div>
      ) : null}

      <ActionDrawer
        isOpen={activityDrawer === "create"}
        onClose={() => setActivityDrawer(null)}
        eyebrow="Catálogo de actividades"
        title="Nueva actividad económica"
        description="El código se guarda en mayúsculas. Completá sus campos de catálogo y vigencia."
      >
        <form
          className="study-form study-form--compact dense-form"
          onSubmit={(event) => {
            event.preventDefault();
            createActivity.mutate();
          }}
        >
          <Field
            id="activity-code"
            label="Código"
            value={activityForm.code}
            onChange={(event) =>
              setActivityForm({ ...activityForm, code: event.target.value.toUpperCase() })
            }
            error={
              codeConflict(createActivity.error) ?? (activityForm.code && !activityCodeValid
                ? "Usá letras, números, punto, guion, guion bajo o barra (máx. 40)."
                : undefined)
            }
            hint="Ej.: CM03-02, SERV4, 462100"
            maxLength={40}
            required
          />
          <Field
            id="activity-name"
            label="Nombre"
            value={activityForm.name}
            onChange={(event) => setActivityForm({ ...activityForm, name: event.target.value })}
            maxLength={200}
            required
          />
          <div className="ds-field dense-form__full">
            <label className="ds-field__label" htmlFor="activity-jurisdiction">Jurisdicción</label>
            <select
              id="activity-jurisdiction"
              className="ds-field__input"
              value={activityForm.jurisdictionId}
              onChange={(event) =>
                setActivityForm({ ...activityForm, jurisdictionId: event.target.value })
              }
              required
            >
              <option value="">Seleccioná una jurisdicción…</option>
              {selectionOptions<JurisdictionOption>(jurisdictions, activityForm.jurisdictionId).map((jurisdiction) => (
                <option key={jurisdiction.id} value={jurisdiction.id} disabled={!jurisdiction.isActive}>
                  {jurisdictionLabel(jurisdiction)}{!jurisdiction.isActive ? " (oculto)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="dense-form__full">
            <Field
              id="activity-source"
              label="Fuente"
              value={activityForm.source}
              onChange={(event) => setActivityForm({ ...activityForm, source: event.target.value })}
              placeholder="Opcional: norma, padrón o resolución (ej. CM03, Arba)"
              maxLength={200}
            />
          </div>
          <Field
            id="activity-valid-from"
            label="Vigencia desde"
            type="date"
            value={activityForm.validFrom}
            onChange={(event) => setActivityForm({ ...activityForm, validFrom: event.target.value })}
            required
          />
          <Field
            id="activity-valid-to"
            label="Vigencia hasta"
            type="date"
            value={activityForm.validTo}
            min={activityForm.validFrom || undefined}
            onChange={(event) => setActivityForm({ ...activityForm, validTo: event.target.value })}
            hint="Opcional: dejala vacía si la vigencia no tiene fecha de cierre."
            error={
              activityValidityValid
                ? undefined
                : "La vigencia hasta no puede ser anterior a la vigencia desde."
            }
          />
          <MutationError error={createActivity.error} />
          {!activityForm.code.trim() ||
          !activityForm.name.trim() ||
          !activityForm.jurisdictionId ||
          !activityForm.validFrom ||
          !activityCodeValid ||
          !activityValidityValid ? (
            <p className="form-submit-hint" role="note">
              Completá código, nombre, jurisdicción y vigencia para poder crear la actividad.
            </p>
          ) : null}
          <div className="study-form__actions">
            <Button
              type="submit"
              loading={createActivity.isPending}
              disabled={
                !activityForm.code.trim() ||
                !activityForm.name.trim() ||
                !activityForm.jurisdictionId ||
                !activityForm.validFrom ||
                !activityCodeValid ||
                !activityValidityValid
              }
            >
              Crear actividad
            </Button>
            <Button type="button" variant="ghost" onClick={() => setActivityDrawer(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      </ActionDrawer>

      <ActionDrawer
        isOpen={activityDrawer === "edit" && Boolean(editingActivity)}
        onClose={() => setActivityDrawer(null)}
        eyebrow="Catálogo de actividades"
        title="Editar actividad económica"
        description="Actualizá el código, la jurisdicción, la fuente o la vigencia de la actividad."
      >
        {editingActivity ? (
          <form
            className="study-form study-form--compact dense-form"
            onSubmit={(event) => {
              event.preventDefault();
              updateActivity.mutate();
            }}
          >
            <Field
              id="activity-edit-code"
              label="Código"
              value={activityForm.code}
              onChange={(event) => setActivityForm({ ...activityForm, code: event.target.value.toUpperCase() })}
              error={codeConflict(updateActivity.error) ?? (activityForm.code && !activityCodeValid
                ? "Usá letras, números, punto, guion, guion bajo o barra (máx. 40)."
                : undefined)}
              maxLength={40}
              required
            />
            <div className="ds-field">
              <label className="ds-field__label" htmlFor="activity-edit-jurisdiction">
                Jurisdicción
              </label>
              <select
                id="activity-edit-jurisdiction"
                className="ds-field__input"
                value={activityForm.jurisdictionId}
                onChange={(event) => setActivityForm({ ...activityForm, jurisdictionId: event.target.value })}
                required
              >
                {selectionOptions<JurisdictionOption>(jurisdictions, activityForm.jurisdictionId).map((jurisdiction) => (
                  <option key={jurisdiction.id} value={jurisdiction.id} disabled={!jurisdiction.isActive}>
                    {jurisdictionLabel(jurisdiction)}{!jurisdiction.isActive ? " (oculto)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="dense-form__full">
              <Field
                id="activity-edit-name"
                label="Nombre"
                value={activityForm.name}
                onChange={(event) => setActivityForm({ ...activityForm, name: event.target.value })}
                maxLength={200}
                required
              />
            </div>
            <div className="dense-form__full">
              <Field
                id="activity-edit-source"
                label="Fuente"
                value={activityForm.source}
                onChange={(event) => setActivityForm({ ...activityForm, source: event.target.value })}
                placeholder="Opcional: dejala vacía para quitar la fuente"
                maxLength={200}
              />
            </div>
            <Field
              id="activity-edit-valid-from"
              label="Vigencia desde"
              type="date"
              value={activityForm.validFrom}
              onChange={(event) =>
                setActivityForm({ ...activityForm, validFrom: event.target.value })
              }
              required
            />
            <Field
              id="activity-edit-valid-to"
              label="Vigencia hasta"
              type="date"
              value={activityForm.validTo}
              min={activityForm.validFrom || undefined}
              onChange={(event) =>
                setActivityForm({ ...activityForm, validTo: event.target.value })
              }
              hint="Opcional: dejala vacía si la vigencia no tiene fecha de cierre."
              error={
                activityValidityValid
                  ? undefined
                  : "La vigencia hasta no puede ser anterior a la vigencia desde."
              }
            />
            <MutationError error={updateActivity.error} />
            <div className="study-form__actions">
              <Button
                type="submit"
                loading={updateActivity.isPending}
                disabled={
                  !activityForm.code.trim() ||
                  !activityCodeValid ||
                  !activityForm.name.trim() ||
                  !activityForm.jurisdictionId ||
                  !activityForm.validFrom ||
                  !activityValidityValid
                }
              >
                Guardar cambios
              </Button>
              <Button type="button" variant="ghost" onClick={() => setActivityDrawer(null)}>
                Cancelar
              </Button>
            </div>
          </form>
        ) : null}
      </ActionDrawer>

      <ActionDrawer
        isOpen={activityDrawer === "deactivate" && Boolean(editingActivity)}
        onClose={() => setActivityDrawer(null)}
        eyebrow="Catálogo de actividades"
        title="Ocultar actividad económica"
        description="El registro, sus vínculos y reglas se conservan. La actividad deja de ofrecerse en los selectores."
      >
        {editingActivity ? (
          <form
            className="study-form study-form--compact"
            onSubmit={(event) => {
              event.preventDefault();
              toggleActivity.mutate(editingActivity);
            }}
          >
            <p className="fiscal-activity-confirm">
              ¿Ocultamos <strong>{editingActivity.code}</strong> — {editingActivity.name}?
            </p>
            <MutationError error={toggleActivity.error} />
            <div className="study-form__actions">
              <Button type="submit" loading={toggleActivity.isPending}>
                Ocultar
              </Button>
              <Button type="button" variant="ghost" onClick={() => setActivityDrawer(null)}>
                Cancelar
              </Button>
            </div>
          </form>
        ) : null}
      </ActionDrawer>

      <ActionDrawer
        isOpen={masterDrawer === "jurisdiction-create"}
        onClose={() => setMasterDrawer(null)}
        eyebrow="Catálogo fiscal del estudio"
        title={duplicateJurisdictionSource
          ? `Nueva jurisdicción a partir de ${duplicateJurisdictionSource.code}`
          : "Nueva jurisdicción"}
        description={duplicateJurisdictionSource
          ? `Copia de ${duplicateJurisdictionSource.code} · ${duplicateJurisdictionSource.name}. Ajustá los datos del nuevo registro.`
          : "Registrá una jurisdicción de nivel Nación, provincia o municipio."}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setMasterDrawer(null)}>Cancelar</Button>
            <Button
              type="submit"
              form="jurisdiction-create-form"
              loading={createJurisdiction.isPending}
              disabled={!jurisdictionForm.code.trim() || !jurisdictionForm.name.trim() || (jurisdictionForm.kind !== "NATIONAL" && !jurisdictionForm.parentId)}
            >
              Crear jurisdicción
            </Button>
          </>
        }
      >
        <form
          id="jurisdiction-create-form"
          className="study-form study-form--compact dense-form"
          onSubmit={(event) => {
            event.preventDefault();
            createJurisdiction.mutate();
          }}
        >
          <div className="dense-form__fields">
            <Field
              id="jurisdiction-code"
              label="Código"
              value={jurisdictionForm.code}
              onChange={(event) => setJurisdictionForm({ ...jurisdictionForm, code: event.target.value.toUpperCase() })}
              error={codeConflict(createJurisdiction.error)}
              maxLength={40}
              required
            />
            <Field
              id="jurisdiction-name"
              label="Nombre"
              value={jurisdictionForm.name}
              onChange={(event) => setJurisdictionForm({ ...jurisdictionForm, name: event.target.value })}
              maxLength={160}
              required
            />
            <div className="ds-field">
              <label className="ds-field__label" htmlFor="jurisdiction-kind">Nivel</label>
              <select
                id="jurisdiction-kind"
                className="ds-field__input"
                value={jurisdictionForm.kind}
                onChange={(event) => setJurisdictionForm({
                  ...jurisdictionForm,
                  kind: event.target.value as JurisdictionOption["kind"],
                  parentId: "",
                })}
              >
                <option value="NATIONAL">Nación</option>
                <option value="PROVINCIAL">Provincia</option>
                <option value="MUNICIPAL">Municipio</option>
              </select>
            </div>
            {jurisdictionForm.kind !== "NATIONAL" ? (
              <div className="ds-field dense-form__full">
                <label className="ds-field__label" htmlFor="jurisdiction-parent">Jurisdicción padre</label>
                <select
                  id="jurisdiction-parent"
                  className="ds-field__input"
                  value={jurisdictionForm.parentId}
                  onChange={(event) => setJurisdictionForm({ ...jurisdictionForm, parentId: event.target.value })}
                  required
                >
                  <option value="">Seleccioná una jurisdicción padre…</option>
                  {selectionOptions<JurisdictionOption>(
                    jurisdictions.filter((row) => row.kind === (jurisdictionForm.kind === "PROVINCIAL" ? "NATIONAL" : "PROVINCIAL")),
                    jurisdictionForm.parentId,
                  ).map((row) => <option key={row.id} value={row.id} disabled={!row.isActive}>{jurisdictionLabel(row)}{!row.isActive ? " (oculto)" : ""}</option>)}
                </select>
                <p className="ds-field__hint">
                  {jurisdictionForm.kind === "PROVINCIAL" ? "Una provincia requiere una jurisdicción de nivel Nación." : "Un municipio requiere una jurisdicción de nivel Provincia."}
                </p>
              </div>
            ) : null}
            <MutationError error={createJurisdiction.error} />
          </div>
        </form>
      </ActionDrawer>

      <ActionDrawer
        isOpen={masterDrawer === "jurisdiction-edit" && Boolean(editingJurisdiction)}
        onClose={() => setMasterDrawer(null)}
        eyebrow="Catálogo fiscal del estudio"
        title="Editar jurisdicción"
        description="Actualizá el código, el nivel o el nombre."
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setMasterDrawer(null)}>Cancelar</Button>
            <Button
              type="submit"
              form="jurisdiction-edit-form"
              loading={updateJurisdiction.isPending}
              disabled={!jurisdictionForm.code.trim() || !jurisdictionForm.name.trim() || (jurisdictionForm.kind !== "NATIONAL" && !jurisdictionForm.parentId)}
            >
              Guardar cambios
            </Button>
          </>
        }
      >
        {editingJurisdiction ? (
          <form
            id="jurisdiction-edit-form"
            className="study-form study-form--compact dense-form"
            onSubmit={(event) => {
              event.preventDefault();
              updateJurisdiction.mutate();
            }}
          >
            <div className="dense-form__fields">
              <Field
                id="jurisdiction-edit-code"
                label="Código"
                value={jurisdictionForm.code}
                onChange={(event) => setJurisdictionForm({ ...jurisdictionForm, code: event.target.value.toUpperCase() })}
                error={codeConflict(updateJurisdiction.error)}
                maxLength={40}
                required
              />
              <Field
                id="jurisdiction-edit-name"
                label="Nombre"
                value={jurisdictionForm.name}
                onChange={(event) => setJurisdictionForm({ ...jurisdictionForm, name: event.target.value })}
                maxLength={160}
                required
              />
              <div className="ds-field">
                <label className="ds-field__label" htmlFor="jurisdiction-edit-kind">Nivel</label>
                <select
                  id="jurisdiction-edit-kind"
                  className="ds-field__input"
                  value={jurisdictionForm.kind}
                  onChange={(event) => setJurisdictionForm({
                    ...jurisdictionForm,
                    kind: event.target.value as JurisdictionOption["kind"],
                    parentId: "",
                  })}
                >
                  <option value="NATIONAL">Nación</option>
                  <option value="PROVINCIAL">Provincia</option>
                  <option value="MUNICIPAL">Municipio</option>
                </select>
              </div>
              {jurisdictionForm.kind !== "NATIONAL" ? (
                <div className="ds-field dense-form__full">
                  <label className="ds-field__label" htmlFor="jurisdiction-edit-parent">Jurisdicción padre</label>
                  <select
                    id="jurisdiction-edit-parent"
                    className="ds-field__input"
                    value={jurisdictionForm.parentId}
                    onChange={(event) => setJurisdictionForm({ ...jurisdictionForm, parentId: event.target.value })}
                    required
                  >
                    <option value="">Seleccioná una jurisdicción padre…</option>
                    {selectionOptions<JurisdictionOption>(
                      jurisdictions.filter((row) => row.kind === (jurisdictionForm.kind === "PROVINCIAL" ? "NATIONAL" : "PROVINCIAL")),
                      jurisdictionForm.parentId,
                    ).map((row) => <option key={row.id} value={row.id} disabled={!row.isActive}>{jurisdictionLabel(row)}{!row.isActive ? " (oculto)" : ""}</option>)}
                  </select>
                </div>
              ) : null}
              <MutationError error={updateJurisdiction.error} />
            </div>
          </form>
        ) : null}
      </ActionDrawer>

      <ActionDrawer
        isOpen={masterDrawer === "tax-type-create"}
        onClose={() => setMasterDrawer(null)}
        eyebrow="Catálogo fiscal del estudio"
        title="Nuevo tipo de impuesto"
        description="Agregá el impuesto que usa el estudio para definir sus regímenes fiscales."
      >
        <form
          className="study-form study-form--compact dense-form"
          onSubmit={(event) => {
            event.preventDefault();
            createTaxType.mutate();
          }}
        >
          <Field
            id="tax-type-code"
            label="Código"
            value={taxTypeForm.code}
            onChange={(event) => setTaxTypeForm({ ...taxTypeForm, code: event.target.value.toUpperCase() })}
            error={codeConflict(createTaxType.error)}
            maxLength={40}
            required
          />
          <Field
            id="tax-type-name"
            label="Nombre"
            value={taxTypeForm.name}
            onChange={(event) => setTaxTypeForm({ ...taxTypeForm, name: event.target.value })}
            maxLength={160}
            required
          />
          <div className="ds-field">
            <label className="ds-field__label" htmlFor="tax-type-default-family">Familia por defecto</label>
            <select
              id="tax-type-default-family"
              className="ds-field__input"
              value={taxTypeForm.defaultFamilyId}
              onChange={(event) => setTaxTypeForm({ ...taxTypeForm, defaultFamilyId: event.target.value })}
            >
              <option value="">Sin familia predeterminada</option>
              {calcFamilies.filter((family) => family.isActive).map((family) => (
                <option key={family.id} value={family.id}>{family.label}</option>
              ))}
            </select>
            <p className="muted-copy">Esta familia se propone al crear regímenes; cada régimen puede tener otra.</p>
            {calcFamiliesQuery.isLoading ? <p className="muted-copy">Cargando familias…</p> : null}
            {calcFamiliesQuery.isError ? (
              <p className="form-error" role="alert">
                No pudimos cargar las familias de cálculo. <Button type="button" variant="ghost" size="sm" onClick={() => void calcFamiliesQuery.refetch()}>Reintentar</Button>
              </p>
            ) : null}
            {apiFieldIssue(createTaxType.error, "defaultFamilyId") ? (
              <p className="form-error" role="alert">{apiFieldIssue(createTaxType.error, "defaultFamilyId")}</p>
            ) : null}
          </div>
          <MutationError error={createTaxType.error} />
          <div className="study-form__actions">
            <Button type="submit" loading={createTaxType.isPending} disabled={!taxTypeForm.code.trim() || !taxTypeForm.name.trim()}>Crear tipo de impuesto</Button>
            <Button type="button" variant="ghost" onClick={() => setMasterDrawer(null)}>Cancelar</Button>
          </div>
        </form>
      </ActionDrawer>

      <ActionDrawer
        isOpen={masterDrawer === "tax-type-edit" && Boolean(editingTaxType)}
        onClose={() => setMasterDrawer(null)}
        eyebrow="Catálogo fiscal del estudio"
        title="Editar tipo de impuesto"
        description="Actualizá el código o el nombre del tipo de impuesto."
      >
        {editingTaxType ? (
          <form
            className="study-form study-form--compact dense-form"
            onSubmit={(event) => {
              event.preventDefault();
              updateTaxType.mutate();
            }}
          >
            <Field
              id="tax-type-edit-code"
              label="Código"
              value={taxTypeForm.code}
              onChange={(event) => setTaxTypeForm({ ...taxTypeForm, code: event.target.value.toUpperCase() })}
              error={codeConflict(updateTaxType.error)}
              hint="El código identifica el tipo de impuesto. La fuente de importación se configura por separado."
              maxLength={40}
              required
            />
            <Field
              id="tax-type-edit-name"
              label="Nombre"
              value={taxTypeForm.name}
              onChange={(event) => setTaxTypeForm({ ...taxTypeForm, name: event.target.value })}
              maxLength={160}
              required
            />
            <MutationError error={updateTaxType.error} />
            <div className="study-form__actions">
              <Button type="submit" loading={updateTaxType.isPending} disabled={!taxTypeForm.code.trim() || !taxTypeForm.name.trim()}>Guardar cambios</Button>
              <Button type="button" variant="ghost" onClick={() => setMasterDrawer(null)}>Cancelar</Button>
            </div>
          </form>
        ) : null}
      </ActionDrawer>

      {deletingTarget ? (
        <DeletionDrawer
          isOpen
          path={deletingTarget.path}
          onClose={() => setDeletingTarget(null)}
          onDeleted={async () => {
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ["tax-jurisdictions", firmId] }),
              queryClient.invalidateQueries({ queryKey: ["tax-types", firmId] }),
              queryClient.invalidateQueries({ queryKey: ["tax-authorities", firmId] }),
              queryClient.invalidateQueries({ queryKey: ["tax-regimes", firmId] }),
              queryClient.invalidateQueries({ queryKey: ["tax-activities-catalog", firmId] }),
              queryClient.invalidateQueries({ queryKey: ["tax-activities", firmId] }),
              queryClient.invalidateQueries({ queryKey: ["client-profile-activity-catalog", firmId] }),
              queryClient.invalidateQueries({ queryKey: ["tax-rule-packs", firmId] }),
            ]);
            setReceipt("El catálogo quedó eliminado y la auditoría del estudio conserva el registro de la acción.");
          }}
        />
      ) : null}
    </DensePage>
  );
}