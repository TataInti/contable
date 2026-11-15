import type { ReactNode } from "react";
import { EmptyState } from "@contable/design-system";

export function SummaryFact({
  label,
  value,
  detail,
  wrap = false,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  wrap?: boolean;
}) {
  return (
    <div className={`client-summary__fact${wrap ? " client-summary__fact--wrap" : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

export function SummarySectionEmpty({
  title,
  description,
  kind = "no-data",
}: {
  title: string;
  description: string;
  kind?: "no-data" | "no-results";
}) {
  return <EmptyState size="compact" kind={kind} title={title} description={description} />;
}
