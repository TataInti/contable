import type { Dispatch, SetStateAction } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button, EmptyState, Notice, Table } from "@contable/design-system";
import { formatearFecha } from "../../../lib/formatoFechas";
import { inscripcionesSinCobertura, mesLegible } from "../fechas";
import { nombreRegimen } from "../etiquetaRegimen";
import { StatusBadge } from "../../../ui/StatusBadge";
import { periodName, type FiscalStep, type Mutacion, type ObligacionForm, type TaxObligation, type TaxPeriod, type TaxRegistration } from "../utilidades";

type Props = {
  canWrite: boolean;
  monthToOpen: string;
  setMonthToOpen: Dispatch<SetStateAction<string>>;
  openMonth: Mutacion;
  periodsQuery: UseQueryResult<TaxPeriod[]>;
  openStepForm: (paso: FiscalStep) => void;
  obligationByPeriod: Map<string, TaxObligation>;
  setObligationForm: Dispatch<SetStateAction<ObligacionForm>>;
  /** Inscripciones del cliente: con ellas se avisa si el mes a abrir no está cubierto. */
  registrations: TaxRegistration[];
  corregirInscripcion: (registration: TaxRegistration) => void;
  corregirPeriodo: (period: TaxPeriod) => void;
  anularPeriodo: (period: TaxPeriod) => void;
};

export function PestanaPeriodos({ canWrite, monthToOpen, setMonthToOpen, openMonth, periodsQuery, openStepForm, obligationByPeriod, setObligationForm, registrations, corregirInscripcion, corregirPeriodo, anularPeriodo }: Props) {
  const sinCobertura = canWrite ? inscripcionesSinCobertura(registrations, monthToOpen) : [];
  return (
    <section className="fiscal-section" aria-labelledby="fiscal-periods-title">
      <div className="fiscal-client-overview__heading"><h3 id="fiscal-periods-title">Períodos fiscales</h3>{canWrite ? <Button size="sm" variant="ghost" onClick={() => openStepForm("periodos")}>Agregar</Button> : null}</div>
      {canWrite ? (
        <form
          className="fiscal-open-month"
          onSubmit={(event) => { event.preventDefault(); openMonth.mutate(); }}
        >
          <div className="fiscal-open-month__field">
            <label htmlFor="fiscal-open-month-input">Mes a liquidar</label>
            <div className="fiscal-open-month__control">
              <input
                id="fiscal-open-month-input"
                className="ds-field__input"
                type="month"
                value={monthToOpen}
                onChange={(event) => setMonthToOpen(event.target.value)}
                required
              />
              <Button type="submit" size="sm" variant="secondary" loading={openMonth.isPending} disabled={!monthToOpen}>
                Abrir mes
              </Button>
            </div>
            {monthToOpen ? <span aria-live="polite">{mesLegible(monthToOpen)}</span> : null}
          </div>
          <small className="muted-copy">
            Crea el período y la obligación de cada régimen del cliente, con su vencimiento.
          </small>
        </form>
      ) : null}
      {sinCobertura.length > 0 ? (
        <Notice tone="info" title={`${mesLegible(monthToOpen)} no está cubierto por la inscripción`}>
          <p className="muted-copy">La fecha «Desde» de la inscripción no impide abrir ni liquidar el mes: solo indica cuándo empezó. Si no es la real, podés corregirla:</p>
          <ul className="fiscal-open-month__uncovered">
            {sinCobertura.map((registration) => (
              <li key={registration.id}>
                <span>{nombreRegimen(registration.regime)} · desde {formatearFecha(registration.validFrom)}</span>{" "}
                <Button size="sm" variant="secondary" aria-label={`Corregir fecha de inscripción de ${nombreRegimen(registration.regime)}`} onClick={() => corregirInscripcion(registration)}>Corregir fecha de inscripción</Button>
              </li>
            ))}
          </ul>
        </Notice>
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
        { key: "actions", header: "", align: "right", render: (row) => canWrite && !obligationByPeriod.has(row.id) ? <div className="table-actions"><Button size="sm" variant="ghost" onClick={() => { setObligationForm({ regimeId: "", periodId: row.id, dueDate: "" }); openStepForm("obligaciones"); }}>Crear obligación</Button><Button size="sm" variant="ghost" onClick={() => corregirPeriodo(row)}>Corregir</Button><Button size="sm" variant="ghost" onClick={() => anularPeriodo(row)}>Anular</Button></div> : null },
      ]} />}
    </section>
  );
}
