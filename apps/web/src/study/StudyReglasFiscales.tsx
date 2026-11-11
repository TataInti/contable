import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field, MoneyField, Table } from "@contable/design-system";
import {
  compatibleTaxEnginesForRegime,
  normalizeActivityCode,
  type CatalogEconomicActivity,
} from "@contable/contracts";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { ActionDrawer } from "../ui/ActionDrawer";
import { DeletionDrawer } from "../ui/DeletionDrawer";
import { StatusBadge } from "../ui/StatusBadge";
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
  DensitySwitch,
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
    name: string;
    code: string;
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

const today = new Date().toISOString().slice(0, 10);

function shortDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString("es-AR") : "Sin vencimiento";
}

function sameRuleRows(draftRows: RuleRow[], savedRows: RuleRow[]): boolean {
  if (draftRows.length !== savedRows.length) return false;
  const savedById = new Map(savedRows.map((row) => [row.id, row]));
  return draftRows.every((row) => {
    const saved = savedById.get(row.id);
    return Boolean(
      saved &&
      row.concept === saved.concept &&
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
  const [ruleTab, setRuleTab] = useState<"rates" | "dueDates" | "sources" | "approval">("rates");
  const [packSearch, setPackSearch] = useState("");
  const [packFilter, setPackFilter] = useState<"" | "ACTIVE" | "DRAFT" | "IN_REVIEW">("");
  const [density, setDensity] = useDensity();
  const searchRef = useRef<HTMLInputElement>(null);
  const [deletingTarget, setDeletingTarget] = useState<{
    path: string;
    kind: "pack" | "version";
  } | null>(null);
  const [validFrom, setValidFrom] = useState(today);
  const [credentialId, setCredentialId] = useState("");
  const [draftRows, setDraftRows] = useState<RuleRow[]>([]);
  const [draftRowsVersionId, setDraftRowsVersionId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [showPackForm, setShowPackForm] = useState(false);
  const [showSourceForm, setShowSourceForm] = useState(false);
  const [showDueDateForm, setShowDueDateForm] = useState(false);
  const [showInitialVersionForm, setShowInitialVersionForm] = useState(false);
  const [showCloneForm, setShowCloneForm] = useState(false);
  // Errores 409 del servidor por código de actividad (ACTIVITY_CODE_*): se
  // marcan las filas del borrador cuyo código coincide con el del mensaje.
  const [rowActivityErrors, setRowActivityErrors] = useState<Record<string, string>>({});
  const [newPack, setNewPack] = useState({ code: "", name: "", regimeId: "" });
  const [engineVersion, setEngineVersion] = useState("");
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
  const compatibleEngineOptions = useMemo(
    () =>
      detailQuery.data?.regime.taxType.code
        ? compatibleTaxEnginesForRegime({
            regimeCode: detailQuery.data.regime.code,
            taxTypeCode: detailQuery.data.regime.taxType.code,
            jurisdictionCode: detailQuery.data.regime.jurisdiction.code,
          })
        : [],
    [
      detailQuery.data?.regime.code,
      detailQuery.data?.regime.taxType.code,
      detailQuery.data?.regime.jurisdiction.code,
    ],
  );

  useEffect(() => {
    setEngineVersion(compatibleEngineOptions[0]?.engineVersion ?? "");
  }, [compatibleEngineOptions, selectedPackId]);

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

  const cloneMutation = useMutation({
    mutationFn: () => api.post(`/tax/rule-packs/${selectedPackId}/versions/clone`, { validFrom }),
    onSuccess: () => {
      invalidate();
      setShowCloneForm(false);
      setReceipt("Se creó una nueva versión borrador a partir de la vigente. La versión anterior sigue vigente hasta que se active la nueva.");
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
      setReceipt("El paquete quedó creado. Ahora podés iniciar su primera versión.");
    },
  });
  const createVersionMutation = useMutation({
    mutationFn: () =>
      api.post(`/tax/rule-packs/${selectedPackId}/versions`, {
        validFrom,
        engineVersion,
        rulesHash: "PENDING_DRAFT",
      }),
    onSuccess: () => {
      invalidate();
      setShowInitialVersionForm(false);
      setReceipt("La primera versión quedó abierta como borrador.");
    },
  });
  const saveMutation = useMutation({
    mutationFn: () =>
      api.put(`/tax/rule-versions/${selectedVersion?.id}/rate-rules`, {
        rules: draftRows.map((row) => ({
          concept: row.concept.trim(),
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
      setRowActivityErrors({});
      setReceipt("Las reglas del borrador quedaron guardadas.");
    },
    onError: (error) => {
      // Los 409 de validación del catálogo (ACTIVITY_CODE_UNKNOWN/INVALID/
      // INACTIVE/JURISDICTION_MISMATCH) citan el código entre comillas:
      // marcamos cada fila del borrador cuyo código coincida.
      const message = error instanceof Error ? error.message : String(error);
      const quotedCodes = message.match(/"([A-Z0-9][A-Z0-9._/-]{0,39})"/g) ?? [];
      if (quotedCodes.length === 0) return;
      const codes = quotedCodes.map((quoted) => quoted.slice(1, -1));
      const marked = new Map<string, string>();
      for (const row of draftRows) {
        const code = normalizeActivityCode(row.activityCode ?? "");
        if (code !== "" && codes.includes(code)) {
          marked.set(row.id, message);
        }
      }
      if (marked.size > 0) {
        setRowActivityErrors((previous) => ({ ...previous, ...Object.fromEntries(marked) }));
      }
    },
  });
  const submitMutation = useMutation({
    mutationFn: () => api.post(`/tax/rule-versions/${selectedVersion?.id}/submit-review`),
    onSuccess: () => {
      invalidate();
      setReceipt("La versión fue enviada a revisión.");
    },
  });
  const approveMutation = useMutation({
    mutationFn: () =>
      api.post(`/tax/rule-versions/${selectedVersion?.id}/approve`, { credentialId }),
    onSuccess: () => {
      invalidate();
      setReceipt("La versión fue aprobada con matrícula profesional.");
    },
  });
  const activateMutation = useMutation({
    mutationFn: (ruleVersionId: string) => api.post(`/tax/rule-versions/${ruleVersionId}/activate`),
    onSuccess: (_result, ruleVersionId) => {
      invalidate();
      const activatedVersion = detailQuery.data?.versions.find((version) => version.id === ruleVersionId);
      setReceipt(
        `La versión v${activatedVersion?.version ?? ""} quedó activa y disponible para próximos cálculos.`,
      );
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
      setReceipt("La fuente normativa quedó asociada al borrador.");
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
      setReceipt("El vencimiento quedó agregado al borrador.");
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
  const requestActivation = (version: RuleVersion) => {
    const validity = `${shortDate(version.validFrom)} — ${shortDate(version.validTo)}`;
    const versionName = `${detailQuery.data?.name ?? "Paquete fiscal"} · versión v${version.version}`;
    if (window.confirm(`¿Activar ${versionName}?\nVigencia: ${validity}`)) {
      activateMutation.mutate(version.id);
    }
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
    if (selectedVersion.status !== "DRAFT" && canPropose) {
      return { label: "Modificar alícuotas", description: "Prepará una nueva versión a partir de esta: modifica alícuotas en un borrador nuevo y la versión vigente sigue aplicando hasta que se active la nueva.", onClick: () => setShowCloneForm(true) };
    }
    return null;
  })();

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
        eyebrow="Configuración del estudio"
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
        eyebrow="Reglas fiscales"
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
        eyebrow="Vencimientos"
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
        eyebrow="Fuentes"
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
        eyebrow="Reglas fiscales"
        title="Crear primera versión"
        description="Abrí un borrador para cargar alícuotas, vencimientos y las fuentes que respaldan el cálculo."
      >
        <form
          className="study-form study-form--compact fiscal-action-form"
          onSubmit={(event) => {
            event.preventDefault();
            createVersionMutation.mutate();
          }}
        >
          <Field
            label="Vigencia desde"
            id="first-rule-version-valid-from"
            type="date"
            value={validFrom}
            onChange={(event) => setValidFrom(event.target.value)}
            required
          />
          <div className="ds-field">
            <label className="ds-field__label" htmlFor="first-rule-version-engine">
              Motor compatible con el régimen
            </label>
            <select
              id="first-rule-version-engine"
              className="ds-field__input"
              value={engineVersion}
              onChange={(event) => setEngineVersion(event.target.value)}
              required
            >
              <option value="">Seleccioná un motor compatible…</option>
              {compatibleEngineOptions.map((option) => (
                <option key={option.engineVersion} value={option.engineVersion}>
                  {option.label}
                </option>
              ))}
            </select>
            {compatibleEngineOptions.length === 0 ? (
              <p className="form-error" role="alert">
                No hay motores implementados para este régimen. La versión no se puede crear.
              </p>
            ) : null}
          </div>
          <div className="study-form__actions">
            <Button
              type="submit"
              loading={createVersionMutation.isPending}
              disabled={!compatibleEngineOptions.some((option) => option.engineVersion === engineVersion)}
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
        eyebrow="Reglas fiscales"
        title="Modificar alícuotas"
        description="Se crea una nueva versión borrador a partir de la vigente para ajustar alícuotas, vencimientos y fuentes. La versión vigente sigue aplicando hasta que el Administrador o Titular active la nueva."
      >
        <form
          className="study-form study-form--compact fiscal-action-form"
          onSubmit={(event) => {
            event.preventDefault();
            cloneMutation.mutate();
          }}
        >
          <Field
            label="Nueva vigencia desde"
            id="rule-valid-from"
            type="date"
            value={validFrom}
            onChange={(event) => setValidFrom(event.target.value)}
            required
          />
          <div className="study-form__actions">
            <Button type="submit" loading={cloneMutation.isPending}>
              <Icon name="plus" size={16} /> Crear nueva versión
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

      {receipt ? (
        <div className="action-receipt action-receipt--page" role="status">
          <Icon name="check" size={19} />
          <span>
            <strong>Actualización registrada</strong>
            <small>{receipt}</small>
          </span>
          <button type="button" aria-label="Cerrar confirmación" onClick={() => setReceipt(null)}>
            <Icon name="close" size={15} />
          </button>
        </div>
      ) : null}

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
          <DensitySwitch value={density} onChange={setDensity} />
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
              tone="ok"
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
                    <p className="study-page__eyebrow">Paquete seleccionado</p>
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
                        disabled={activationBlockedByUnsavedChanges}
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
                            v{version.version} · {version.status} · {shortDate(version.validFrom)}
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
                {activationBlockedByUnsavedChanges ? (
                  <p className="form-submit-hint" role="note">
                    Guardá los cambios del borrador antes de activarlo para incluir las reglas editadas.
                  </p>
                ) : null}
              </section>

              <DenseTabs<"rates" | "dueDates" | "sources" | "approval">
                label="Secciones de la versión"
                idPrefix="rule-tab"
                active={ruleTab}
                onChange={setRuleTab}
                tabs={[
                  { id: "rates", label: "Alícuotas", count: selectedVersion.rateRules.length },
                  { id: "dueDates", label: "Vencimientos", count: selectedVersion.dueDateRules.length },
                  { id: "sources", label: "Fuentes", count: selectedVersion.sources.length },
                  { id: "approval", label: "Control profesional" },
                ]}
              />
              <div role="tabpanel" id="rule-tab-panel" className="dense-tabpanel">
              {ruleTab === "rates" ? (
              <section className="study-panel" aria-labelledby="rule-rates-title">
                <div className="study-panel__heading">
                  <div>
                    <h2 id="rule-rates-title">Alícuotas y porcentajes</h2>
                    <p>
                      Los valores se expresan en porcentaje; los importes mínimos se guardan en ARS.
                      La actividad se elige del catálogo del estudio (código · nombre);{" "}
                      <strong>General</strong> aplica la regla a todas las actividades.
                    </p>
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
                            onChange={(event) =>
                              setDraftRows((rows) =>
                                rows.map((item) =>
                                  item.id === row.id
                                    ? { ...item, concept: event.target.value }
                                    : item,
                                ),
                              )
                            }
                          />
                        ) : (
                          row.concept
                        ),
                    },
                    {
                      key: "activity",
                      header: "Actividad",
                      render: (row) => {
                        if (!editable) {
                          const currentCode = normalizeActivityCode(row.activityCode ?? "");
                          const currentActivity = (activitiesQuery.data ?? []).find(
                            (activity) => activity.code === currentCode,
                          );
                          return row.activityCode
                            ? `${row.activityCode}${currentActivity && !currentActivity.isActive ? " (oculto)" : ""}`
                            : "General";
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
                        const currentCode = normalizeActivityCode(row.activityCode ?? "");
                        const currentActivity = catalogActivities.find(
                          (activity) => activity.code === currentCode,
                        );
                        const isLegacyCode =
                          currentCode !== "" &&
                          !options.some((activity) => activity.code === currentCode);
                        const rowError = rowActivityErrors[row.id];
                        return (
                          <div>
                            <select
                              className="fiscal-rule-input fiscal-rule-input--select"
                              aria-label={`Actividad ${row.id}`}
                              value={row.activityCode ?? ""}
                              onChange={(event) => {
                                const value = event.target.value;
                                setDraftRows((rows) =>
                                  rows.map((item) =>
                                    item.id === row.id
                                      ? {
                                          ...item,
                                          activityCode: value
                                            ? normalizeActivityCode(value)
                                            : null,
                                        }
                                      : item,
                                  ),
                                );
                                setRowActivityErrors((previous) => {
                                  if (!(row.id in previous)) return previous;
                                  const next = { ...previous };
                                  delete next[row.id];
                                  return next;
                                });
                              }}
                            >
                              <option value="">General</option>
                              {options.map((activity) => (
                                <option key={activity.id} value={activity.code}>
                                  {activity.code} · {activity.name}
                                </option>
                              ))}
                              {isLegacyCode ? (
                                <option value={row.activityCode ?? ""} disabled>
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
                    },
                    {
                      key: "rate",
                      header: "Alícuota",
                      align: "right",
                      render: (row) =>
                        editable ? (
                          <MoneyField
                            className="fiscal-rule-input fiscal-rule-input--number"
                            aria-label={`Alícuota ${row.id}`}
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
                      onClick={() => saveMutation.mutate()}
                      loading={saveMutation.isPending}
                      disabled={draftRows.some(
                        (row) => !row.concept.trim() || (!row.rate && !row.minAmount),
                      )}
                    >
                      Guardar borrador
                    </Button>
                  </div>
                ) : null}
                {editable && draftRows.some((row) => !row.concept.trim() || (!row.rate && !row.minAmount)) ? (
                  <p className="form-submit-hint" role="note">
                    Completá el concepto y la alícuota o el mínimo de cada fila para poder guardar
                    el borrador.
                  </p>
                ) : null}
              </section>
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
        <p className="form-error" role="alert">
          {mutationError.message}
        </p>
      ) : null}
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
            setReceipt(
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
