import { Table } from "@contable/design-system";
import { StatStrip } from "../../ui/Dense";
import { formatMoney } from "./formato";
import type { SifereAnalysis } from "./tipos";

export function SifereAnalysisPanel({ analysis }: { analysis: SifereAnalysis }) {
  return (
    <div>
      <StatStrip
        label="Totales del libro"
        items={[
          {
            key: "importeTotal",
            label: "Importe total",
            value: formatMoney(analysis.totals.importeTotal),
          },
          {
            key: "netoGravado",
            label: "Neto gravado",
            value: formatMoney(analysis.totals.netoGravado),
          },
          { key: "iva", label: "IVA", value: formatMoney(analysis.totals.iva) },
        ]}
      />
      {analysis.rates.length > 0 ? (
        <Table
          aria-label="Alícuotas del libro"
          columns={[
            { key: "alicuota", header: "Alícuota", accessor: (rate) => rate.label },
            {
              key: "base",
              header: "Base",
              align: "right",
              accessor: (rate) => formatMoney(rate.net),
            },
            {
              key: "iva",
              header: "IVA",
              align: "right",
              accessor: (rate) => formatMoney(rate.tax),
            },
            {
              key: "comprobantes",
              header: "Comprobantes",
              align: "right",
              accessor: (rate) => rate.count,
            },
          ]}
          rows={analysis.rates}
          rowKey={(rate) => rate.rate}
        />
      ) : null}
      {analysis.taxes.length > 0 ? (
        <>
          <small>Tributos asociados</small>
          <StatStrip
            label="Tributos asociados"
            items={analysis.taxes.map((tax) => ({
              key: tax.code,
              label: tax.label,
              value: formatMoney(tax.amount),
            }))}
          />
        </>
      ) : null}
      <small className="muted-copy">
        {analysis.detailRows} comprobantes · {analysis.validRows} válidos
        {analysis.errorRows > 0 ? ` · ${analysis.errorRows} con observaciones` : ""}
      </small>
    </div>
  );
}
