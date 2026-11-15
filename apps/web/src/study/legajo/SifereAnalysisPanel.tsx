import { formatMoney } from "./formato";
import type { SifereAnalysis } from "./tipos";

export function SifereAnalysisPanel({ analysis }: { analysis: SifereAnalysis }) {
  return (
    <div className="sifere-analysis">
      <div className="sifere-analysis__totals">
        <span>
          <strong>{formatMoney(analysis.totals.importeTotal)}</strong>
          <small>Importe total</small>
        </span>
        <span>
          <strong>{formatMoney(analysis.totals.netoGravado)}</strong>
          <small>Neto gravado</small>
        </span>
        <span>
          <strong>{formatMoney(analysis.totals.iva)}</strong>
          <small>IVA</small>
        </span>
      </div>
      {analysis.rates.length > 0 ? (
        <table className="sifere-analysis__table">
          <thead>
            <tr>
              <th>Alícuota</th>
              <th className="num">Base</th>
              <th className="num">IVA</th>
              <th className="num">Comp.</th>
            </tr>
          </thead>
          <tbody>
            {analysis.rates.map((rate) => (
              <tr key={rate.rate}>
                <td>{rate.label}</td>
                <td className="num">{formatMoney(rate.net)}</td>
                <td className="num">{formatMoney(rate.tax)}</td>
                <td className="num">{rate.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {analysis.taxes.length > 0 ? (
        <div className="sifere-analysis__taxes">
          <small>Tributos asociados</small>
          {analysis.taxes.map((tax) => (
            <span key={tax.code}>
              {tax.label} · <strong>{formatMoney(tax.amount)}</strong>
            </span>
          ))}
        </div>
      ) : null}
      <small className="muted-copy">
        {analysis.detailRows} comprobantes · {analysis.validRows} válidos
        {analysis.errorRows > 0 ? ` · ${analysis.errorRows} con observaciones` : ""}
      </small>
    </div>
  );
}
