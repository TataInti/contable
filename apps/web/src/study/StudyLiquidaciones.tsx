import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button, EmptyState, Field, Table } from "@contable/design-system";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { ActionDrawer } from "../ui/ActionDrawer";
import { Icon } from "../ui/Icon";
import { SectionIndex } from "../ui/SectionIndex";
import { StatusBadge } from "../ui/StatusBadge";
import "./study.css";

interface TaxSettlement {
  id: string;
  version: number;
  status: string;
  cutoff: string;
  totals: Record<string, string> | null;
  period: { id: string; label: string | null; startDate: string; endDate: string };
  regime: {
    code: string;
    name: string;
    taxType: { code: string; name: string };
    jurisdiction: { name: string };
  };
}
interface TaxPeriod {
  id: string;
  taxTypeId: string;
  startDate: string;
  endDate: string;
  label: string | null;
  taxType: { name: string };
}
interface TaxRegime {
  id: string;
  name: string;
  taxTypeId: string;
  jurisdictionId: string;
  taxType: { name: string };
  jurisdiction: { name: string };
}

const today = new Date().toISOString().slice(0, 10);

function formatMoney(value: string | undefined | null): string {
  const num = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(num);
}

function taxPeriodLabel(period: TaxPeriod) {
  return period.label ?? `${period.startDate.slice(0, 10)} a ${period.endDate.slice(0, 10)}`;
}

export function StudyLiquidaciones() {
  const { firmId, clientId, periodId, capabilities } = useClientContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [receipt, setReceipt] = useState<string | null>(null);
  const [showCalculator, setShowCalculator] = useState(false);
  const [calculation, setCalculation] = useState({ periodId: "", regimeId: "", cutoff: today });
  const canCalculate = capabilities.has("tax.settlements.calculate");

  const listQuery = useQuery({
    queryKey: ["tax-settlements", firmId, clientId, periodId],
    queryFn: () =>
      api.get<TaxSettlement[]>(
        `/firms/${firmId}/clients/${clientId}/tax-settlements?accountingPeriodId=${encodeURIComponent(periodId ?? "")}`,
      ),
    enabled: Boolean(firmId && clientId && periodId),
  });
  const taxPeriodsQuery = useQuery({
    queryKey: ["tax-periods", firmId, clientId],
    queryFn: () => api.get<TaxPeriod[]>(`/firms/${firmId}/clients/${clientId}/tax-periods`),
    enabled: Boolean(firmId && clientId),
  });
  const regimesQuery = useQuery({
    queryKey: ["tax-regimes"],
    queryFn: () => api.get<TaxRegime[]>("/tax/regimes"),
    enabled: Boolean(firmId),
  });

  const selectedTaxPeriod = useMemo(
    () => taxPeriodsQuery.data?.find((period) => period.id === calculation.periodId),
    [calculation.periodId, taxPeriodsQuery.data],
  );
  const availableRegimes = (regimesQuery.data ?? []).filter(
    (regime) => !selectedTaxPeriod || regime.taxTypeId === selectedTaxPeriod.taxTypeId,
  );
  const selectedRegime = availableRegimes.find((regime) => regime.id === calculation.regimeId);
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["tax-settlements", firmId, clientId] });
    void queryClient.invalidateQueries({ queryKey: ["tax-position", firmId, clientId] });
  };

  const calculateMutation = useMutation({
    mutationFn: () =>
      api.post(`/firms/${firmId}/clients/${clientId}/tax-settlements/calculate`, {
        taxTypeId: selectedTaxPeriod?.taxTypeId,
        regimeId: calculation.regimeId,
        jurisdictionId: selectedRegime?.jurisdictionId,
        periodId: calculation.periodId,
        cutoff: calculation.cutoff,
      }),
    onSuccess: () => {
      invalidate();
      setShowCalculator(false);
      setCalculation({ periodId: "", regimeId: "", cutoff: today });
      setReceipt("La liquidación fue calculada con los comprobantes aprobados al corte indicado.");
    },
  });
  const submitMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/tax-settlements/${id}/submit-review`),
    onSuccess: () => {
      invalidate();
      setReceipt("La liquidación fue enviada a revisión.");
    },
  });
  const reviewMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/tax-settlements/${id}/review`),
    onSuccess: () => {
      invalidate();
      setReceipt("La liquidación quedó revisada.");
    },
  });
  const finalizeMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/tax-settlements/${id}/finalize`),
    onSuccess: () => {
      invalidate();
      setReceipt("La liquidación fue finalizada y quedó inmutable.");
    },
  });
  const rectifyMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/tax-settlements/${id}/rectify`, {
        reason: "Rectificación iniciada desde la cartera",
      }),
    onSuccess: () => {
      invalidate();
      setReceipt("Se inició una rectificación de la liquidación.");
    },
  });
  const artifactMutation = useMutation({
    mutationFn: ({ id, format }: { id: string; format: "csv" | "pdf" }) =>
      api.post(`/firms/${firmId}/clients/${clientId}/tax-settlements/${id}/artifacts`, { format }),
    onSuccess: (_, variables) =>
      setReceipt(`Se generó el papel de trabajo en ${variables.format.toUpperCase()}.`),
  });

  if (!firmId || !clientId || !periodId) {
    return (
      <EmptyState
        title="Elegí un cliente y período"
        description="La cartera fiscal necesita un cliente y un período contable activos."
      />
    );
  }

  const data = listQuery.data ?? [];
  const mutationError =
    calculateMutation.error ??
    submitMutation.error ??
    reviewMutation.error ??
    finalizeMutation.error ??
    rectifyMutation.error ??
    artifactMutation.error;

  return (
    <section className="study-page" aria-labelledby="liquidaciones-title">
      <header className="study-page__header">
        <div>
          <p className="study-page__eyebrow">Impuestos</p>
          <h1 id="liquidaciones-title" className="study-page__title">
            Liquidaciones
          </h1>
        </div>
        <span className="study-page__actions">
          {canCalculate ? (
            <Button
              onClick={() => setShowCalculator((visible) => !visible)}
              variant={showCalculator ? "secondary" : "primary"}
            >
              <Icon name={showCalculator ? "close" : "plus"} size={16} />{" "}
              {showCalculator ? "Cerrar cálculo" : "Calcular liquidación"}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => navigate("/expediente-mensual")}>
            Ver expediente
          </Button>
        </span>
      </header>
      <p className="study-page__hint">
        Cada liquidación conserva su versión, las reglas aplicadas y la evidencia del corte de
        cálculo.
      </p>

      <SectionIndex
        items={[
          { id: "settlements-context-title", label: "Estado del período" },
          { id: "settlements-next-step-title", label: "Siguiente paso" },
          { id: "settlements-list-title", label: "Liquidaciones", meta: `${data.length}` },
        ]}
      />

      <section className="guided-context" aria-labelledby="settlements-context-title"><div className="guided-context__heading"><div><p className="study-page__eyebrow">Cartera fiscal</p><h2 id="settlements-context-title">Estado del período</h2><p>Calculá sólo sobre obligaciones configuradas y evidencia aprobada hasta la fecha de corte.</p></div><StatusBadge status={data.length ? "ACTIVE" : "PENDING"} /></div><dl className="guided-context__facts"><div><dt>Liquidaciones</dt><dd>{data.length}</dd></div><div><dt>Períodos fiscales</dt><dd>{taxPeriodsQuery.data?.length ?? "—"}</dd></div><div><dt>Regímenes disponibles</dt><dd>{availableRegimes.length}</dd></div></dl></section>
      <section className="guided-next-step" aria-labelledby="settlements-next-step-title"><div><p className="study-page__eyebrow">Flujo guiado</p><h2 id="settlements-next-step-title">Próximo paso</h2><p>{data.length ? "Revisá la cartera y avanzá la liquidación que requiere la próxima decisión." : canCalculate ? "Calculá una liquidación para un régimen y período fiscal configurados." : "Prepará la evidencia y el expediente antes de iniciar el cálculo."}</p></div>{canCalculate ? <Button onClick={() => setShowCalculator(true)}>Calcular liquidación</Button> : <Button variant="secondary" onClick={() => navigate("/expediente-mensual")}>Abrir expediente</Button>}</section>

      <ActionDrawer
        isOpen={showCalculator}
        onClose={() => setShowCalculator(false)}
        eyebrow="Impuestos"
        title="Calcular liquidación"
        description="Elegí el período fiscal y el régimen. El cálculo sólo toma documentación aprobada hasta la fecha de corte."
      >
        <form
          className="study-form study-form--compact fiscal-action-form"
          onSubmit={(event) => {
            event.preventDefault();
            calculateMutation.mutate();
          }}
        >
          <div className="ds-field">
            <label className="ds-field__label" htmlFor="settlement-tax-period">
              Período fiscal
            </label>
            <select
              id="settlement-tax-period"
              className="ds-field__input"
              value={calculation.periodId}
              onChange={(event) =>
                setCalculation({ ...calculation, periodId: event.target.value, regimeId: "" })
              }
              required
            >
              <option value="">Seleccioná un período…</option>
              {taxPeriodsQuery.data?.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.taxType.name} · {taxPeriodLabel(period)}
                </option>
              ))}
            </select>
          </div>
          <div className="ds-field">
            <label className="ds-field__label" htmlFor="settlement-regime">
              Régimen
            </label>
            <select
              id="settlement-regime"
              className="ds-field__input"
              value={calculation.regimeId}
              onChange={(event) => setCalculation({ ...calculation, regimeId: event.target.value })}
              required
              disabled={!calculation.periodId}
            >
              <option value="">Seleccioná un régimen…</option>
              {availableRegimes.map((regime) => (
                <option key={regime.id} value={regime.id}>
                  {regime.name} · {regime.jurisdiction.name}
                </option>
              ))}
            </select>
          </div>
          <Field
            label="Fecha de corte"
            id="settlement-cutoff"
            type="date"
            value={calculation.cutoff}
            onChange={(event) => setCalculation({ ...calculation, cutoff: event.target.value })}
            required
          />
          <div className="study-form__actions">
            <Button
              type="submit"
              loading={calculateMutation.isPending}
              disabled={!selectedTaxPeriod || !selectedRegime || !calculation.cutoff}
            >
              Calcular
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowCalculator(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      </ActionDrawer>

      {receipt ? (
        <div className="action-receipt action-receipt--page" role="status">
          <Icon name="check" size={19} />
          <span>
            <strong>Acción completada</strong>
            <small>{receipt}</small>
          </span>
          <button type="button" aria-label="Cerrar confirmación" onClick={() => setReceipt(null)}>
            <Icon name="close" size={15} />
          </button>
        </div>
      ) : null}

      <section className="study-page__section" aria-labelledby="settlements-list-title">
      <div className="study-panel__heading">
        <div>
          <p className="study-page__eyebrow">Seguimiento</p>
          <h2 id="settlements-list-title">Liquidaciones registradas</h2>
          <p>Consultá versiones, estados y acciones disponibles para cada liquidación.</p>
        </div>
        <span className="section-count">{data.length}</span>
      </div>
      {listQuery.isLoading ? (
        <div className="study-state" role="status">
          Cargando liquidaciones…
        </div>
      ) : listQuery.isError ? (
        <EmptyState
          title="No se pudieron cargar las liquidaciones"
          description="Reintentá en unos minutos. No interpretamos esta falla como una cartera vacía."
          action={
            <Button variant="secondary" onClick={() => void listQuery.refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : data.length === 0 ? (
        <EmptyState
          title="Todavía no hay liquidaciones"
          description="Iniciá el cálculo para un régimen configurado o prepará la evidencia desde el expediente mensual."
          action={
            canCalculate ? (
              <Button onClick={() => setShowCalculator(true)}>Calcular liquidación</Button>
            ) : (
              <Button variant="secondary" onClick={() => navigate("/expediente-mensual")}>
                Abrir expediente
              </Button>
            )
          }
        />
      ) : (
        <Table<TaxSettlement>
          columns={[
            {
              key: "period",
              header: "Período",
              render: (row) => row.period.label ?? row.period.startDate.slice(0, 10),
            },
            {
              key: "tax",
              header: "Impuesto",
              render: (row) => (
                <>
                  <strong>{row.regime.taxType.name}</strong>
                  <br />
                  <small>
                    {row.regime.name} · {row.regime.jurisdiction.name}
                  </small>
                </>
              ),
            },
            { key: "version", header: "Versión", render: (row) => `v${row.version}` },
            {
              key: "status",
              header: "Estado",
              render: (row) => <StatusBadge status={row.status} />,
            },
            {
              key: "total",
              header: "Total",
              align: "right",
              render: (row) =>
                formatMoney(row.totals?.["TOTAL_A_INGRESAR"] ?? row.totals?.totalDue),
            },
            {
              key: "actions",
              header: "Acciones",
              render: (row) => (
                <span className="study-table__actions">
                  <Button size="sm" variant="ghost" onClick={() => navigate("/expediente-mensual")}>
                    Expediente
                  </Button>
                  {row.status === "CALCULATED" &&
                  capabilities.has("tax.settlements.submit_review") ? (
                    <Button size="sm" onClick={() => submitMutation.mutate(row.id)}>
                      Enviar a revisión
                    </Button>
                  ) : null}
                  {row.status === "IN_REVIEW" && capabilities.has("tax.settlements.review") ? (
                    <Button size="sm" onClick={() => reviewMutation.mutate(row.id)}>
                      Revisar
                    </Button>
                  ) : null}
                  {row.status === "REVIEWED" && capabilities.has("tax.settlements.finalize") ? (
                    <Button size="sm" onClick={() => finalizeMutation.mutate(row.id)}>
                      Finalizar
                    </Button>
                  ) : null}
                  {row.status === "FINALIZED" && capabilities.has("tax.settlements.rectify") ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => rectifyMutation.mutate(row.id)}
                    >
                      Rectificar
                    </Button>
                  ) : null}
                  {row.status === "FINALIZED" && capabilities.has("tax.settlements.export") ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => artifactMutation.mutate({ id: row.id, format: "pdf" })}
                      >
                        PDF
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => artifactMutation.mutate({ id: row.id, format: "csv" })}
                      >
                        CSV
                      </Button>
                    </>
                  ) : null}
                </span>
              ),
            },
          ]}
          rows={data}
          rowKey={(row) => row.id}
          empty="Sin liquidaciones."
        />
      )}
      </section>
      {mutationError ? (
        <p className="form-error" role="alert">
          {mutationError.message}
        </p>
      ) : null}
    </section>
  );
}
