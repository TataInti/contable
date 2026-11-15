import type { Dispatch, SetStateAction } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button, EmptyState, Table } from "@contable/design-system";
import { formatearFecha } from "../../../lib/formatoFechas";
import { StatusBadge } from "../../../ui/StatusBadge";
import { periodName, type FiscalStep, type Mutacion, type ObligacionForm, type TaxObligation, type TaxPeriod } from "../utilidades";

type Props = {
  canWrite: boolean;
  monthToOpen: string;
  setMonthToOpen: Dispatch<SetStateAction<string>>;
  openMonth: Mutacion;
  periodsQuery: UseQueryResult<TaxPeriod[]>;
  openStepForm: (paso: FiscalStep) => void;
  obligationByPeriod: Map<string, TaxObligation>;
  setObligationForm: Dispatch<SetStateAction<ObligacionForm>>;
};

export function PestanaPeriodos({ canWrite, monthToOpen, setMonthToOpen, openMonth, periodsQuery, openStepForm, obligationByPeriod, setObligationForm }: Props) {
  return (
    <section className="fiscal-section" aria-labelledby="fiscal-periods-title">
      <div className="fiscal-client-overview__heading"><h3 id="fiscal-periods-title">Períodos fiscales</h3>{canWrite ? <Button size="sm" variant="ghost" onClick={() => openStepForm("periodos")}>Agregar</Button> : null}</div>
      {canWrite ? (
        <form
          className="fiscal-open-month"
          onSubmit={(event) => { event.preventDefault(); openMonth.mutate(); }}
        >
          <label className="fiscal-open-month__field">
            <span>Mes a liquidar</span>
            <input
              className="ds-field__input"
              type="month"
              value={monthToOpen}
              onChange={(event) => setMonthToOpen(event.target.value)}
              required
            />
          </label>
          <Button type="submit" size="sm" variant="secondary" loading={openMonth.isPending} disabled={!monthToOpen}>
            Abrir mes
          </Button>
          <small className="muted-copy">
            Crea el período y la obligación de cada régimen del cliente, con su vencimiento.
          </small>
        </form>
      ) : null}
      {periodsQuery.isLoading ? <p className="muted-copy">Cargando períodos…</p> : (periodsQuery.data?.length ?? 0) === 0 ? <EmptyState size="compact" title="Todavía no hay períodos fiscales" description="Creá el período de cada impuesto para poder abrir su obligación." /> : <Table<TaxPeriod> rows={periodsQuery.data ?? []} rowKey={(row) => row.id} columns={[
        { key: "tax", header: "Impuesto", render: (row) => <strong>{row.taxType.name}{!row.taxType.isActive ? " (oculto)" : ""}</strong> },
        { key: "period", header: "Período", render: (row) => <>{periodName(row)}</> },
        {
          key: "obligation",
          header: "Obligación",
          render: (row) => {
            const obligation = obligationByPeriod.get(row.id);
            return obligation
              ? <>{obligation.regime.name} <StatusBadge status={obligation.status} /></>
              : <span className="muted-copy">Sin obligación</span>;
          },
        },
        {
          key: "due",
          header: "Vencimiento",
          render: (row) => {
            const dueDate = obligationByPeriod.get(row.id)?.dueDate;
            return dueDate ? <span className="tabular-copy">{formatearFecha(dueDate)}</span> : <span className="muted-copy">—</span>;
          },
        },
        { key: "actions", header: "", align: "right", render: (row) => canWrite && !obligationByPeriod.has(row.id) ? <Button size="sm" variant="ghost" onClick={() => { setObligationForm({ regimeId: "", periodId: row.id, dueDate: "" }); openStepForm("obligaciones"); }}>Crear obligación</Button> : null },
      ]} />}
    </section>
  );
}
