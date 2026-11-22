import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, MoneyField, Notice, Table } from "@contable/design-system";
import { api } from "../lib/api";
import { DenseSection } from "../ui/Dense";
import "./RuleSimulator.css";

/**
 * Probar liquidación: corre el motor real con las reglas guardadas de una
 * versión sobre un caso cargado a mano. No guarda nada ni afecta a clientes.
 */

interface SimulatorRule {
  id: string;
  concept: string;
  activityCode: string | null;
  rate: string | null;
}

interface SimulationLine {
  concept: string;
  formula: string;
  inputs: Record<string, string>;
  result: string;
}

interface SimulationRun {
  versionId: string;
  version: number;
  status: string;
  lines: SimulationLine[];
  subtotals: Record<string, string>;
  totalDue: string;
  warnings: string[];
  blocks: string[];
}

interface SimulationResponse {
  engine: { key: string; label: string };
  period: { startDate: string; endDate: string };
  result: SimulationRun;
  comparison: SimulationRun | null;
  unmatchedInComparison: string[];
}

interface StepRow {
  concept: string;
  formula: string;
  result: string;
  compared: string | null;
}

const MONEY = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PERCENT = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4 });

function money(value: string | undefined | null): string {
  if (value === undefined || value === null || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? `$ ${MONEY.format(number)}` : value;
}

/** "TOTAL_A_INGRESAR" → "Total a ingresar". */
function readableConcept(concept: string): string {
  const names: Record<string, string> = {
    MINIMO: "Impuesto mínimo",
    MINIMO_NO_IMPONIBLE: "Mínimo no imponible",
  };
  if (names[concept]) return names[concept];
  const text = concept.replaceAll("_", " ").toLocaleLowerCase("es-AR");
  return text ? `${text.charAt(0).toLocaleUpperCase("es-AR")}${text.slice(1)}` : concept;
}

/** Mínimos del caso: solo Ingresos Brutos Tucumán, opcionales. */
interface MinimumsCase {
  nonTaxableMinimum: string;
  taxMinimum: string;
}

function ruleLabel(rule: SimulatorRule): string {
  const name = rule.activityCode && rule.activityCode !== rule.concept
    ? `${rule.concept} · ${rule.activityCode}`
    : rule.concept;
  return rule.rate !== null ? `${name} · ${PERCENT.format(Number(rule.rate))} %` : name;
}

export function RuleSimulator({
  versionId,
  versionNumber,
  isDraft,
  hasUnsavedChanges,
  rules,
}: {
  versionId: string;
  versionNumber: number;
  isDraft: boolean;
  hasUnsavedChanges: boolean;
  rules: SimulatorRule[];
}) {
  const rateRules = rules.filter((rule) => rule.rate !== null);
  const [incomes, setIncomes] = useState<Record<string, string>>({});
  const [credits, setCredits] = useState({ withholding: "", perception: "", collected: "", previousCredit: "" });
  const [minimums, setMinimums] = useState<MinimumsCase>({ nonTaxableMinimum: "", taxMinimum: "" });

  const simulation = useMutation({
    mutationFn: (extras: MinimumsCase) =>
      api.post<SimulationResponse>(`/tax/rule-versions/${versionId}/simulate`, {
        incomes: rateRules
          .filter((rule) => incomes[rule.id])
          .map((rule) => ({ ruleId: rule.id, amount: incomes[rule.id] })),
        ...(credits.withholding ? { withholding: credits.withholding } : {}),
        ...(credits.perception ? { perception: credits.perception } : {}),
        ...(credits.collected ? { collected: credits.collected } : {}),
        ...(credits.previousCredit ? { previousCredit: credits.previousCredit } : {}),
        ...(extras.nonTaxableMinimum ? { nonTaxableMinimum: extras.nonTaxableMinimum } : {}),
        ...(extras.taxMinimum ? { taxMinimum: extras.taxMinimum } : {}),
      }),
  });

  const hasIncome = rateRules.some((rule) => incomes[rule.id]);
  const data = simulation.data;
  const sentTaxMinimum = simulation.variables?.taxMinimum;
  const minimumApplied = data?.result.subtotals["MINIMO_APLICADO"] !== undefined;
  const taxByActivity = data?.result.subtotals["IMPUESTO_POR_ACTIVIDAD"];
  const minimumComparison = sentTaxMinimum && taxByActivity !== undefined
    ? minimumApplied
      ? `Se paga el impuesto mínimo de ${money(sentTaxMinimum)}: el impuesto por actividad da ${money(taxByActivity)}.`
      : `El impuesto por actividad (${money(taxByActivity)}) es igual o mayor que el impuesto mínimo de ${money(sentTaxMinimum)}: se paga el impuesto por actividad.`
    : null;
  const comparedByConcept = new Map((data?.comparison?.lines ?? []).map((line) => [line.concept, line.result]));
  const steps: StepRow[] = (data?.result.lines ?? []).map((line) => ({
    concept: line.concept,
    formula: line.formula,
    result: line.result,
    compared: data?.comparison ? comparedByConcept.get(line.concept) ?? null : null,
  }));
  const total = data?.result.subtotals["TOTAL_A_INGRESAR"] ?? data?.result.totalDue;
  const comparedTotal = data?.comparison
    ? data.comparison.subtotals["TOTAL_A_INGRESAR"] ?? data.comparison.totalDue
    : null;
  const difference = total !== undefined && comparedTotal !== null && comparedTotal !== undefined
    ? Number(total) - Number(comparedTotal)
    : null;

  return (
    <DenseSection
      id="rule-simulator"
      title="Probar liquidación"
      description="Cargá un caso chico y mirá cómo lo calcula esta versión, paso a paso, con el mismo motor que liquida a los clientes. No guarda nada ni afecta a ningún cliente."
    >

      {hasUnsavedChanges ? (
        <Notice tone="warning">
          Hay cambios sin guardar en el borrador. La prueba usa las reglas guardadas: guardá el
          borrador para probar los valores nuevos.
        </Notice>
      ) : null}

      {rateRules.length === 0 ? (
        <p className="muted-copy">Esta versión todavía no tiene alícuotas para probar.</p>
      ) : (
        <form
          className="rule-simulator__form"
          onSubmit={(event) => {
            event.preventDefault();
            simulation.mutate(minimums);
          }}
        >
          <fieldset className="rule-simulator__group">
            <legend>Ingresos del caso, por alícuota</legend>
            {rateRules.map((rule) => (
              <MoneyField
                key={rule.id}
                id={`simulator-income-${rule.id}`}
                label={ruleLabel(rule)}
                value={incomes[rule.id] ?? ""}
                onChange={(value) => setIncomes((current) => ({ ...current, [rule.id]: value }))}
              />
            ))}
          </fieldset>
          <fieldset className="rule-simulator__group">
            <legend>Créditos y saldos (opcional)</legend>
            <MoneyField
              id="simulator-withholding"
              label="Retenciones"
              value={credits.withholding}
              onChange={(value) => setCredits((current) => ({ ...current, withholding: value }))}
            />
            <MoneyField
              id="simulator-perception"
              label="Percepciones"
              value={credits.perception}
              onChange={(value) => setCredits((current) => ({ ...current, perception: value }))}
            />
            <MoneyField
              id="simulator-collected"
              label="Recaudaciones bancarias"
              hint="Sólo Ingresos Brutos"
              value={credits.collected}
              onChange={(value) => setCredits((current) => ({ ...current, collected: value }))}
            />
            <MoneyField
              id="simulator-previous-credit"
              label="Saldo a favor anterior"
              value={credits.previousCredit}
              onChange={(value) => setCredits((current) => ({ ...current, previousCredit: value }))}
            />
          </fieldset>
          <fieldset className="rule-simulator__group">
            <legend>Mínimos del caso (opcional, solo Ingresos Brutos Tucumán)</legend>
            <MoneyField
              id="simulator-non-taxable-minimum"
              label="Mínimo no imponible"
              hint="Se resta de la base antes de aplicar la alícuota"
              value={minimums.nonTaxableMinimum}
              onChange={(value) => setMinimums((current) => ({ ...current, nonTaxableMinimum: value }))}
            />
            <MoneyField
              id="simulator-tax-minimum"
              label="Impuesto mínimo del mes"
              hint="Si el impuesto por actividad da menos, se paga este monto"
              value={minimums.taxMinimum}
              onChange={(value) => setMinimums((current) => ({ ...current, taxMinimum: value }))}
            />
          </fieldset>
          <div className="study-form__actions">
            <Button type="submit" variant="secondary" disabled={!hasIncome} loading={simulation.isPending}>
              Probar
            </Button>
            {!hasIncome ? (
              <span className="muted-copy">Cargá al menos un ingreso para probar.</span>
            ) : null}
          </div>
        </form>
      )}

      {simulation.isError ? (
        <Notice tone="error">
          {simulation.error instanceof Error ? simulation.error.message : "No se pudo probar la liquidación."}
        </Notice>
      ) : null}

      {data ? (
        <div className="rule-simulator__result" aria-live="polite">
          <h3>Resultado paso a paso</h3>
          <p className="muted-copy">
            Motor de cálculo {data.engine.label}. {isDraft ? `Borrador v${versionNumber}` : `Versión v${versionNumber}`}
            {data.comparison ? `, comparado con la versión vigente v${data.comparison.version}.` : "."}
          </p>
          {data.result.blocks.map((block) => (
            <Notice key={block} tone="error">{block}</Notice>
          ))}
          <Table<StepRow>
            rows={steps}
            rowKey={(row) => row.concept}
            empty="El motor no devolvió pasos para este caso."
            columns={[
              {
                key: "step",
                header: "Paso",
                render: (row) => (
                  <>
                    <strong>{readableConcept(row.concept)}</strong>
                    <small className="rule-simulator__formula">{row.formula}</small>
                  </>
                ),
              },
              ...(data.comparison
                ? [{
                    key: "active",
                    header: `Vigente v${data.comparison.version}`,
                    align: "right" as const,
                    render: (row: StepRow) => <span className="tabular-copy muted-copy">{money(row.compared)}</span>,
                  }]
                : []),
              {
                key: "result",
                header: isDraft ? `Borrador v${versionNumber}` : `Versión v${versionNumber}`,
                align: "right" as const,
                render: (row) => <span className="tabular-copy">{money(row.result)}</span>,
              },
            ]}
          />
          <p className="rule-simulator__total">
            <span>Total a ingresar</span>
            <strong className="tabular-copy">{money(total)}</strong>
          </p>
          {minimumComparison ? <p className="muted-copy">{minimumComparison}</p> : null}
          {difference !== null ? (
            <p className="muted-copy">
              {difference === 0
                ? "Con este borrador el caso da lo mismo que con la versión vigente."
                : `Con este borrador el caso cambia en ${difference > 0 ? "+" : "−"} ${money(String(Math.abs(difference)))} respecto de la versión vigente.`}
            </p>
          ) : null}
          {data.unmatchedInComparison.length > 0 ? (
            <p className="muted-copy">
              Sin equivalente en la versión vigente: {data.unmatchedInComparison.join(", ")}.
            </p>
          ) : null}
          {data.result.warnings.length > 0 ? (
            <ul className="rule-simulator__warnings">
              {data.result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </DenseSection>
  );
}
