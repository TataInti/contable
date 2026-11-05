import { useEffect, useMemo, useState } from "react";
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
import { StatusBadge } from "../ui/StatusBadge";
import { Icon } from "../ui/Icon";
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
  regime: { name: string; code: string; taxType: { name: string }; jurisdiction: { name: string; code?: string } };
  versions: RuleVersion[];
}

interface RulePackDetail extends RulePack {
  regime: RulePack["regime"] & {
    jurisdiction: { id: string; name: string; code: string };
    authority: { id: string; name: string };
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

export function StudyReglasFiscales() {
  const { firmId, capabilities } = useClientContext();
  const queryClient = useQueryClient();
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [validFrom, setValidFrom] = useState(today);
  const [credentialId, setCredentialId] = useState("");
  const [draftRows, setDraftRows] = useState<RuleRow[]>([]);
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
  // Catálogo de actividades (sólo activas): alimenta el selector de cada regla.
  // Los borradores clonados pueden conservar códigos hoy desactivados; el
  // selector los mantiene como opción histórica para no romper el borrador.
  const activitiesQuery = useQuery({
    queryKey: ["tax-activities", firmId],
    queryFn: () => api.get<CatalogEconomicActivity[]>("/tax/activities"),
    enabled: Boolean(firmId && capabilities.has("tax.rules.read")),
  });

  const selectedVersion = useMemo(
    () =>
      detailQuery.data?.versions.find((version) => version.status === "DRAFT") ??
      detailQuery.data?.versions[0],
    [detailQuery.data],
  );
  const compatibleEngineOptions = useMemo(
    () =>
      detailQuery.data?.regime.code
        ? compatibleTaxEnginesForRegime(
            detailQuery.data.regime.code,
            detailQuery.data.regime.jurisdiction.code,
          )
        : [],
    [detailQuery.data?.regime.code, detailQuery.data?.regime.jurisdiction.code],
  );

  useEffect(() => {
    setEngineVersion(compatibleEngineOptions[0]?.engineVersion ?? "");
  }, [compatibleEngineOptions, selectedPackId]);

  useEffect(() => {
    setDraftRows(selectedVersion?.status === "DRAFT" ? selectedVersion.rateRules : []);
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
    mutationFn: () => api.post(`/tax/rule-versions/${selectedVersion?.id}/activate`),
    onSuccess: () => {
      invalidate();
      setReceipt("La versión activa quedó disponible para próximos cálculos.");
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
      return { label: "Editar borrador", description: "Revisá las reglas y guardá los cambios antes de enviarlo a revisión.", onClick: () => document.getElementById("rule-rates-title")?.scrollIntoView({ behavior: "smooth", block: "start" }) };
    }
    if (selectedVersion.status === "IN_REVIEW" && capabilities.has("tax.rules.approve")) {
      return { label: "Revisar y aprobar", description: "Seleccioná la matrícula profesional para aprobar esta versión.", onClick: () => document.getElementById("rule-approval")?.scrollIntoView({ behavior: "smooth", block: "start" }) };
    }
    if (selectedVersion.status === "APPROVED" && capabilities.has("tax.rules.activate")) {
      return { label: "Activar versión", description: "La versión aprobada quedará disponible para los próximos cálculos.", onClick: () => activateMutation.mutate() };
    }
    if (selectedVersion.status !== "DRAFT" && canPropose) {
      return { label: "Modificar alícuotas", description: "Prepará una nueva versión a partir de esta: modifica alícuotas en un borrador nuevo y la versión vigente sigue aplicando hasta que se active la nueva.", onClick: () => setShowCloneForm(true) };
    }
    return null;
  })();

  return (
    <section className="study-page study-page--wide" aria-labelledby="tax-rules-title">
      <header className="study-page__header">
        <div>
          <p className="study-page__eyebrow">Configuración del estudio</p>
          <h1 id="tax-rules-title" className="study-page__title">
            Reglas fiscales
          </h1>
          <p className="study-page__subtitle">
            Alícuotas, mínimos y porcentajes normativos con vigencia y aprobación profesional.
          </p>
        </div>
        {canPropose ? (
          <Button onClick={() => setShowPackForm((visible) => !visible)}>
            <Icon name={showPackForm ? "close" : "plus"} size={16} />{" "}
            {showPackForm ? "Cerrar alta" : "Nuevo paquete"}
          </Button>
        ) : null}
      </header>

      <p className="fiscal-rules-sequence" role="note">
        <strong>Secuencia de cambios:</strong> borrador → revisión → aprobación con matrícula
        profesional → activa. Las versiones aprobadas y activas quedan inmutables; todo cambio
        posterior se prepara en una nueva versión a partir de la vigente.
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
        description="Se crea una nueva versión borrador a partir de la vigente para ajustar alícuotas, vencimientos y fuentes. La versión vigente sigue aplicando hasta que la nueva se apruebe y active."
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
            La versión vigente no se modifica: sigue activa hasta que esta nueva versión se apruebe
            y se active.
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

      <div className="fiscal-rules-layout">
        <aside className="fiscal-rules-index" aria-label="Paquetes de reglas disponibles">
          <div className="fiscal-rules-index__heading">
            <p className="fiscal-rules-index__label">Paquetes fiscales</p>
            {canPropose ? <Button size="sm" variant="ghost" onClick={() => setShowPackForm(true)}><Icon name="plus" size={15} /> Nuevo</Button> : null}
          </div>
          <small className="fiscal-rules-index__count">{packsQuery.data?.length ?? 0} configurados</small>
          {packsQuery.isLoading ? <p className="muted-copy">Cargando reglas…</p> : null}
          {!packsQuery.isLoading && (packsQuery.data?.length ?? 0) === 0 ? (
            <p className="muted-copy">No hay paquetes configurados.</p>
          ) : null}
          {packsQuery.data?.map((pack) => {
            const active = pack.versions.find((version) => version.status === "ACTIVE");
            return (
              <button
                key={pack.id}
                type="button"
                className={`fiscal-rules-index__item${selectedPackId === pack.id ? " fiscal-rules-index__item--active" : ""}`}
                onClick={() => setSelectedPackId(pack.id)}
              >
                <strong>{pack.name}</strong>
                <span>
                  {pack.regime.taxType.name} · {pack.regime.jurisdiction.name}
                </span>
                <small>{active ? `Vigente v${active.version}` : "Sin versión activa"}</small>
              </button>
            );
          })}
        </aside>

          <div className="fiscal-rules-detail">
          {detailQuery.isLoading ? (
            <div className="query-state">Cargando detalle de reglas…</div>
          ) : null}
          {detailQuery.isError ? (
            <EmptyState title="No se pudo cargar el paquete de reglas" />
          ) : null}
          {!selectedPackId && !packsQuery.isLoading ? (
            <EmptyState
              title="Todavía no hay paquetes de reglas"
              description="Creá un paquete para definir alícuotas, vencimientos y fuentes normativas."
            />
          ) : null}
          {rulesNextAction ? <section className="fiscal-rules-next-step" aria-labelledby="rules-next-step-title">
            <div>
              <p className="study-page__eyebrow">Flujo guiado</p>
              <h2 id="rules-next-step-title">Próximo paso</h2>
              <p>{rulesNextAction.description}</p>
            </div>
            <Button onClick={rulesNextAction.onClick}>{rulesNextAction.label}</Button>
          </section> : null}
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
                      {detailQuery.data.regime.taxType.name} ·{" "}
                      {detailQuery.data.regime.jurisdiction.name}
                    </p>
                    <h2>{detailQuery.data.name}</h2>
                    <p>
                      {detailQuery.data.code} · Organismo recaudador {detailQuery.data.regime.authority.name}
                    </p>
                  </div>
                  <StatusBadge status={selectedVersion.status} />
                </div>
                <div className="fiscal-rule-summary__meta">
                  <span>
                    Régimen <strong>{detailQuery.data.regime.name}</strong>
                  </span>
                  <span>
                    Versión <strong>v{selectedVersion.version}</strong>
                  </span>
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
              </section>

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
                          return row.activityCode ?? "General";
                        }
                        // El selector ofrece las actividades activas del
                        // catálogo. Cuando el pack declara jurisdicción, filtra
                        // por ella (el servidor exige publicación para la
                        // jurisdicción de la regla). Un código histórico que ya
                        // no figure (desactivado o de otra jurisdicción) se
                        // conserva como opción para que el borrador clonado
                        // pueda guardarse sin perder el vínculo.
                        const packJurisdictionId = detailQuery.data?.regime.jurisdiction.id;
                        const options = (activitiesQuery.data ?? []).filter(
                          (activity) =>
                            !packJurisdictionId ||
                            activity.jurisdictionId === packJurisdictionId,
                        );
                        const currentCode = normalizeActivityCode(row.activityCode ?? "");
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
                                <option value={row.activityCode ?? ""}>
                                  {row.activityCode} — código histórico (desactivado o fuera de la
                                  jurisdicción del paquete)
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
                    <Button
                      variant="secondary"
                      onClick={() => submitMutation.mutate()}
                      loading={submitMutation.isPending}
                    >
                      Enviar a revisión
                    </Button>
                  </div>
                ) : null}
              </section>

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

              <section id="rule-approval" className="study-panel fiscal-rule-approval">
                <div>
                  <h2>Control profesional</h2>
                  <p>
                    Las versiones aprobadas y activas quedan inmutables; un cambio posterior siempre
                    crea una nueva versión.
                  </p>
                </div>
                <div className="fiscal-rule-approval__actions">
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
                    </>
                  ) : null}
                  {selectedVersion.status === "APPROVED" &&
                  capabilities.has("tax.rules.activate") ? (
                    <Button
                      onClick={() => activateMutation.mutate()}
                      loading={activateMutation.isPending}
                    >
                      Activar versión
                    </Button>
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
            </>
          ) : null}
        </div>
      </div>
      {mutationError ? (
        <p className="form-error" role="alert">
          {mutationError.message}
        </p>
      ) : null}
    </section>
  );
}
