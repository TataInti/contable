import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button, EmptyState, Field, Notice, Table, useNotify } from "@contable/design-system";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { ActionDrawer } from "../ui/ActionDrawer";
import { Icon } from "../ui/Icon";
import { StatusBadge } from "../ui/StatusBadge";
import {
  DenseHeader,
  DensePage,
  StatStrip,
  useDensity,
} from "../ui/Dense";
import { actionErrorMessage } from "../ui/actionError";
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
    isActive: boolean;
    taxType: { code: string; name: string; isActive: boolean };
    jurisdiction: { name: string; isActive: boolean };
  };
}
interface TaxPeriod {
  id: string;
  taxTypeId: string;
  startDate: string;
  endDate: string;
  label: string | null;
  taxType: { name: string; code: string; isActive: boolean };
}
interface TaxRegime {
  id: string;
  name: string;
  isActive: boolean;
  taxTypeId: string;
  jurisdictionId: string;
  taxType: { name: string; isActive: boolean };
  jurisdiction: { name: string; isActive: boolean };
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
  const [density] = useDensity();
  const { firmId, clientId, capabilities } = useClientContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const notify = useNotify();
  const [showCalculator, setShowCalculator] = useState(false);
  const [calculation, setCalculation] = useState({ periodId: "", regimeId: "", cutoff: today });
  const canCalculate = capabilities.has("tax.settlements.calculate");

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

  const selectableTaxPeriods = useMemo(
    () => (taxPeriodsQuery.data ?? []).filter((period) => period.taxType.isActive),
    [taxPeriodsQuery.data],
  );
  const selectedTaxPeriod = useMemo(
    () => selectableTaxPeriods.find((period) => period.id === calculation.periodId),
    [calculation.periodId, selectableTaxPeriods],
  );
  useEffect(() => {
    if (!taxPeriodsQuery.data) return;
    setCalculation((current) => {
      if (selectableTaxPeriods.some((period) => period.id === current.periodId)) return current;
      return { ...current, periodId: selectableTaxPeriods[0]?.id ?? "", regimeId: "" };
    });
  }, [selectableTaxPeriods, taxPeriodsQuery.data]);
  const listQuery = useQuery({
    queryKey: ["tax-settlements", firmId, clientId, calculation.periodId],
    queryFn: () =>
      api.get<TaxSettlement[]>(
        `/firms/${firmId}/clients/${clientId}/tax-settlements?periodId=${encodeURIComponent(calculation.periodId)}`,
      ),
    enabled: Boolean(firmId && clientId && calculation.periodId),
  });
  const availableRegimes = (regimesQuery.data ?? []).filter(
    (regime) => regime.isActive && (!selectedTaxPeriod || regime.taxTypeId === selectedTaxPeriod.taxTypeId),
  );
  const selectedRegime = availableRegimes.find((regime) => regime.id === calculation.regimeId);
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["tax-settlements", firmId, clientId] });
    void queryClient.invalidateQueries({ queryKey: ["tax-position", firmId, clientId] });
  };

  // Una acción que falla se avisa donde se avisa todo: en la notificación.
  const failed = (error: unknown) =>
    notify.error(actionErrorMessage(error, "No se pudo completar la acción sobre la liquidación."));
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
      setCalculation((current) => ({ ...current, regimeId: "", cutoff: today }));
      notify.success("La liquidación fue calculada con los comprobantes aprobados al corte indicado.");
    },
    onError: failed,
  });
  const submitMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/tax-settlements/${id}/submit-review`),
    onSuccess: () => {
      invalidate();
      notify.success("La liquidación fue enviada a revisión.");
    },
    onError: failed,
  });
  const reviewMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/tax-settlements/${id}/review`),
    onSuccess: () => {
      invalidate();
      notify.success("La liquidación quedó revisada.");
    },
    onError: failed,
  });
  const finalizeMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/tax-settlements/${id}/finalize`),
    onSuccess: () => {
      invalidate();
      notify.success("La liquidación fue finalizada y quedó inmutable.");
    },
    onError: failed,
  });
  const rectifyMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/firms/${firmId}/clients/${clientId}/tax-settlements/${id}/rectify`, {
        reason: "Rectificación iniciada desde la cartera",
      }),
    onSuccess: () => {
      invalidate();
      notify.success("Se inició una rectificación de la liquidación.");
    },
    onError: failed,
  });
  const artifactMutation = useMutation({
    mutationFn: ({ id, format }: { id: string; format: "csv" | "pdf" }) =>
      api.post(`/firms/${firmId}/clients/${clientId}/tax-settlements/${id}/artifacts`, { format }),
    onSuccess: (_, variables) =>
      notify.success(`Se generó el papel de trabajo en ${variables.format.toUpperCase()}.`),
    onError: failed,
  });

  if (!firmId || !clientId) {
    return (
      <EmptyState
        title="Elegí un cliente"
        description="La cartera fiscal se organiza dentro de un cliente explícito."
      />
    );
  }

  const data = listQuery.data ?? [];
  return (
    <DensePage density={density} flow>
      <DenseHeader
        title="Liquidaciones"
        description="Cada liquidación conserva su versión, las reglas aplicadas y la evidencia del corte de cálculo."
        actions={
          <>
          {canCalculate ? (
            <Button
              onClick={() => setShowCalculator((visible) => !visible)}
              variant={showCalculator ? "secondary" : "primary"}
              disabled={!selectableTaxPeriods.length}
            >
              <Icon name={showCalculator ? "close" : "plus"} size={16} />{" "}
              {showCalculator ? "Cerrar cálculo" : "Calcular liquidación"}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => navigate("/expediente-mensual")}>
            Ver legajo
          </Button>
        
          </>
        }
      />

      <StatStrip
        label="Estado del período"
        items={[
          { key: "settlements", label: "Liquidaciones", value: data.length },
          { key: "periods", label: "Períodos fiscales", value: taxPeriodsQuery.data?.length ?? "—" },
          { key: "regimes", label: "Regímenes disponibles", value: availableRegimes.length },
        ]}
      />

      {taxPeriodsQuery.isLoading ? (
        <div className="study-state" role="status">
          Cargando períodos fiscales…
        </div>
      ) : taxPeriodsQuery.isError ? (
        <Notice
          tone="error"
          title="No se pudieron cargar los períodos fiscales"
          action={
            <Button variant="secondary" onClick={() => void taxPeriodsQuery.refetch()}>
              Reintentar
            </Button>
          }
        >
          Reintentá la consulta para volver a cargar los períodos del cliente.
        </Notice>
      ) : selectableTaxPeriods.length === 0 ? (
        <EmptyState
          title="Configurá un período fiscal"
          description="Seleccioná un período fiscal para consultar o calcular liquidaciones."
          action={
            <Button variant="secondary" onClick={() => navigate("/configuracion-fiscal")}>
              Abrir configuración fiscal
            </Button>
          }
        />
      ) : null}




      <ActionDrawer
        isOpen={showCalculator}
        onClose={() => setShowCalculator(false)}
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
              {selectableTaxPeriods.map((period) => (
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
                  {regime.name} · {regime.jurisdiction.name}{!regime.jurisdiction.isActive ? " (oculto)" : ""}
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


      <section className="study-page__section" aria-labelledby="settlements-list-title">
      <div className="study-panel__heading">
        <div>
          <h2 id="settlements-list-title">Liquidaciones registradas</h2>
          <p>
            {selectedTaxPeriod
              ? `Período fiscal: ${selectedTaxPeriod.taxType.name} · ${taxPeriodLabel(selectedTaxPeriod)}. `
              : "Seleccioná un período fiscal. "}
            Consultá versiones, estados y acciones disponibles para cada liquidación.
          </p>
        </div>
        <span className="section-count">{data.length}</span>
      </div>
      {listQuery.isLoading ? (
        <div className="study-state" role="status">
          Cargando liquidaciones…
        </div>
      ) : listQuery.isError ? (
        <Notice
          tone="error"
          title="No se pudieron cargar las liquidaciones"
          action={
            <Button variant="secondary" onClick={() => void listQuery.refetch()}>
              Reintentar
            </Button>
          }
        >
          Reintentá en unos minutos para volver a cargar la cartera.
        </Notice>
      ) : !selectedTaxPeriod ? null : data.length === 0 ? (
        <EmptyState
          title="Todavía no hay liquidaciones"
          description="Iniciá el cálculo para un régimen configurado o prepará la evidencia desde el legajo."
          action={
            canCalculate ? (
              <Button onClick={() => setShowCalculator(true)} disabled={!selectableTaxPeriods.length}>
                Calcular liquidación
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => navigate("/expediente-mensual")}>
                Abrir legajo
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
                  <strong>{row.regime.taxType.name}{!row.regime.taxType.isActive ? " (oculto)" : ""}</strong>
                  <br />
                  <small>
                    {row.regime.name}{!row.regime.isActive ? " (oculto)" : ""} · {row.regime.jurisdiction.name}{!row.regime.jurisdiction.isActive ? " (oculto)" : ""}
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
                    Legajo
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
          empty={
            <EmptyState
              size="compact"
              kind="no-data"
              title="Todavía no hay liquidaciones"
              description="Las liquidaciones del período aparecerán acá cuando estén disponibles."
            />
          }
        />
      )}
      </section>
    </DensePage>
  );
}
