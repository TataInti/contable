import type { ClientSummary } from "../../../lib/api";
import { formatearMes, formatearRango } from "../../../lib/formatoFechas";
import { StatusBadge } from "../../../ui/StatusBadge";
import { SummarySectionEmpty } from "../Piezas";

type Props = {
  accounting: ClientSummary["accounting"];
  accountingPeriodCount: number;
};

export function SeccionPeriodosContables({ accounting, accountingPeriodCount }: Props) {
  return (
    <section className="client-summary__detail-section" aria-labelledby="accounting-periods-title">
      <div className="client-summary__detail-heading">
        <div>
          <h2 id="accounting-periods-title">Períodos contables</h2>
          <p>Cada ejercicio con el detalle de sus períodos y estado de cierre.</p>
        </div>
        <span className="section-count">{accountingPeriodCount}</span>
      </div>
      {accounting.fiscalYears.length === 0 ? (
        <SummarySectionEmpty
          title="Sin ejercicios contables"
          description="Todavía no hay ejercicios creados para este cliente."
        />
      ) : (
        <div className="client-summary__year-list">
          {accounting.fiscalYears.map((year) => (
            <section className="client-summary__year" key={year.id}>
              <div className="client-summary__year-heading">
                <div>
                  <h3>{year.label}</h3>
                  <p>{formatearRango(year.startDate, year.endDate)}</p>
                </div>
                <StatusBadge status={year.status} />
              </div>
              {year.periods.length === 0 ? (
                <p className="muted-copy">Sin períodos mensuales generados.</p>
              ) : (
                <div className="client-summary__period-list">
                  {year.periods.map((period) => (
                    <div className="client-summary__period-row" key={period.id}>
                      <span className="client-summary__period-number">{period.ordinal}</span>
                      <span>
                        <strong>{formatearMes(period.startDate)}</strong>
                        <small>{formatearRango(period.startDate, period.endDate)}</small>
                      </span>
                      <StatusBadge status={period.status} />
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
