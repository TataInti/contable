import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field, Table } from "@contable/design-system";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
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
  sources: Array<{ id: string; title: string; reference: string | null; consultedAt: string }>;
}

interface RulePack {
  id: string;
  code: string;
  name: string;
  regime: { name: string; code: string; taxType: { name: string }; jurisdiction: { name: string } };
  versions: RuleVersion[];
}

interface RulePackDetail extends RulePack {
  regime: RulePack["regime"] & { authority: { name: string } };
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

  const selectedVersion = useMemo(
    () => detailQuery.data?.versions.find((version) => version.status === "DRAFT") ?? detailQuery.data?.versions[0],
    [detailQuery.data],
  );

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
      setReceipt("Se creó un borrador independiente a partir de la versión vigente.");
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
      setReceipt("Las reglas del borrador quedaron guardadas.");
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
    mutationFn: () => api.post(`/tax/rule-versions/${selectedVersion?.id}/approve`, { credentialId }),
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

  if (!capabilities.has("tax.rules.read")) {
    return <EmptyState title="Acceso restringido" description="No tenés permiso para consultar reglas fiscales." />;
  }

  const editable = selectedVersion?.status === "DRAFT" && capabilities.has("tax.rules.propose");
  const mutationError = cloneMutation.error ?? saveMutation.error ?? submitMutation.error ?? approveMutation.error ?? activateMutation.error;

  return (
    <section className="study-page study-page--wide" aria-labelledby="tax-rules-title">
      <header className="study-page__header">
        <div>
          <p className="study-page__eyebrow">Configuración del estudio</p>
          <h1 id="tax-rules-title" className="study-page__title">Reglas fiscales</h1>
          <p className="study-page__subtitle">Alícuotas, mínimos y porcentajes normativos con vigencia y aprobación profesional.</p>
        </div>
      </header>

      {receipt ? (
        <div className="action-receipt action-receipt--page" role="status">
          <Icon name="check" size={19} />
          <span><strong>Actualización registrada</strong><small>{receipt}</small></span>
          <button type="button" aria-label="Cerrar confirmación" onClick={() => setReceipt(null)}><Icon name="close" size={15} /></button>
        </div>
      ) : null}

      <div className="fiscal-rules-layout">
        <aside className="fiscal-rules-index" aria-label="Rule packs disponibles">
          <p className="fiscal-rules-index__label">Regímenes</p>
          {packsQuery.isLoading ? <p className="muted-copy">Cargando reglas…</p> : null}
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
                <span>{pack.regime.taxType.name} · {pack.regime.jurisdiction.name}</span>
                <small>{active ? `Vigente v${active.version}` : "Sin versión activa"}</small>
              </button>
            );
          })}
        </aside>

        <div className="fiscal-rules-detail">
          {detailQuery.isLoading ? <div className="query-state">Cargando detalle de reglas…</div> : null}
          {detailQuery.isError ? <EmptyState title="No se pudo cargar el paquete de reglas" /> : null}
          {detailQuery.data && selectedVersion ? (
            <>
              <section className="study-panel fiscal-rule-summary">
                <div className="study-panel__heading">
                  <div>
                    <p className="study-page__eyebrow">{detailQuery.data.regime.taxType.name} · {detailQuery.data.regime.jurisdiction.name}</p>
                    <h2>{detailQuery.data.name}</h2>
                    <p>{detailQuery.data.code} · Autoridad {detailQuery.data.regime.authority.name}</p>
                  </div>
                  <StatusBadge status={selectedVersion.status} />
                </div>
                <div className="fiscal-rule-summary__meta">
                  <span>Versión <strong>v{selectedVersion.version}</strong></span>
                  <span>Vigencia <strong>{shortDate(selectedVersion.validFrom)} — {shortDate(selectedVersion.validTo)}</strong></span>
                  <span>Motor <strong>{selectedVersion.engineVersion}</strong></span>
                </div>
                {selectedVersion.status !== "DRAFT" && capabilities.has("tax.rules.propose") ? (
                  <form className="fiscal-rule-summary__clone" onSubmit={(event) => { event.preventDefault(); cloneMutation.mutate(); }}>
                    <Field label="Nueva vigencia desde" id="rule-valid-from" type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} required />
                    <Button type="submit" variant="secondary" loading={cloneMutation.isPending}><Icon name="plus" size={16} /> Crear borrador</Button>
                  </form>
                ) : null}
              </section>

              <section className="study-panel" aria-labelledby="rule-rates-title">
                <div className="study-panel__heading">
                  <div>
                    <h2 id="rule-rates-title">Alícuotas y porcentajes</h2>
                    <p>Los valores se expresan en porcentaje; los importes mínimos se guardan en ARS.</p>
                  </div>
                  {editable ? <Button size="sm" onClick={() => setDraftRows((rows) => [...rows, { id: crypto.randomUUID(), concept: "", activityCode: null, jurisdictionId: null, rate: null, minAmount: null, validFrom, validTo: null }])}><Icon name="plus" size={15} /> Agregar regla</Button> : null}
                </div>
                <Table<RuleRow>
                  rows={editable ? draftRows : selectedVersion.rateRules}
                  rowKey={(row) => row.id}
                  empty="Esta versión no tiene alícuotas configuradas."
                  columns={[
                    { key: "concept", header: "Concepto", render: (row) => editable ? <input className="fiscal-rule-input fiscal-rule-input--concept" aria-label={`Concepto ${row.id}`} value={row.concept} onChange={(event) => setDraftRows((rows) => rows.map((item) => item.id === row.id ? { ...item, concept: event.target.value } : item))} /> : row.concept },
                    { key: "activity", header: "Actividad", render: (row) => editable ? <input className="fiscal-rule-input" aria-label={`Actividad ${row.id}`} value={row.activityCode ?? ""} placeholder="General" onChange={(event) => setDraftRows((rows) => rows.map((item) => item.id === row.id ? { ...item, activityCode: event.target.value || null } : item))} /> : row.activityCode ?? "General" },
                    { key: "rate", header: "Alícuota", align: "right", render: (row) => editable ? <input className="fiscal-rule-input fiscal-rule-input--number" aria-label={`Alícuota ${row.id}`} inputMode="decimal" value={row.rate ?? ""} placeholder="—" onChange={(event) => setDraftRows((rows) => rows.map((item) => item.id === row.id ? { ...item, rate: event.target.value || null } : item))} /> : row.rate ? `${row.rate}%` : "—" },
                    { key: "minimum", header: "Mínimo", align: "right", render: (row) => editable ? <input className="fiscal-rule-input fiscal-rule-input--number" aria-label={`Mínimo ${row.id}`} inputMode="decimal" value={row.minAmount ?? ""} placeholder="—" onChange={(event) => setDraftRows((rows) => rows.map((item) => item.id === row.id ? { ...item, minAmount: event.target.value || null } : item))} /> : row.minAmount ?? "—" },
                    { key: "actions", header: "", render: (row) => editable ? <Button size="sm" variant="ghost" onClick={() => setDraftRows((rows) => rows.filter((item) => item.id !== row.id))}>Quitar</Button> : null },
                  ]}
                />
                {editable ? <div className="study-page__actions fiscal-rule-actions"><Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending} disabled={draftRows.some((row) => !row.concept.trim() || (!row.rate && !row.minAmount))}>Guardar borrador</Button><Button variant="secondary" onClick={() => submitMutation.mutate()} loading={submitMutation.isPending}>Enviar a revisión</Button></div> : null}
              </section>

              <section className="study-panel fiscal-rule-approval">
                <div>
                  <h2>Control profesional</h2>
                  <p>Las versiones aprobadas y activas quedan inmutables; un cambio posterior siempre crea una nueva versión.</p>
                </div>
                <div className="fiscal-rule-approval__actions">
                  {selectedVersion.status === "IN_REVIEW" && capabilities.has("tax.rules.approve") ? <><select className="ds-field__input" aria-label="Matrícula para aprobar" value={credentialId} onChange={(event) => setCredentialId(event.target.value)}><option value="">Seleccioná matrícula…</option>{credentialQuery.data?.map((credential) => <option key={credential.id} value={credential.id}>{credential.registrationNumber} · {credential.jurisdiction.name}</option>)}</select><Button disabled={!credentialId} loading={approveMutation.isPending} onClick={() => approveMutation.mutate()}>Aprobar</Button></> : null}
                  {selectedVersion.status === "APPROVED" && capabilities.has("tax.rules.activate") ? <Button onClick={() => activateMutation.mutate()} loading={activateMutation.isPending}>Activar versión</Button> : null}
                </div>
                {selectedVersion.sources.length > 0 ? <p className="fiscal-rule-approval__sources">Fuentes: {selectedVersion.sources.map((source) => source.reference || source.title).join(" · ")}</p> : <p className="fiscal-rule-approval__sources">Sin fuente normativa cargada.</p>}
              </section>
            </>
          ) : null}
        </div>
      </div>
      {mutationError ? <p className="form-error" role="alert">{mutationError.message}</p> : null}
    </section>
  );
}
