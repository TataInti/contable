import type { ReactElement, ReactNode } from "react";
import { Button, EmptyState } from "@contable/design-system";
import { useNavigate } from "react-router-dom";

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

/** Ausencia de una sección: en línea, sin caja. La salida (si la hay) se pasa como acción. */
export function SummarySectionEmpty({
  title,
  description,
  kind = "no-data",
  action,
}: {
  title: string;
  description: string;
  kind?: "no-data" | "no-results";
  action?: ReactElement;
}) {
  return <EmptyState size="inline" kind={kind} title={title} description={description} action={action} />;
}

/** Salida de un vacío hacia Configuración fiscal: dice dónde se resuelve (P1). */
export function SalidaConfiguracionFiscal() {
  const navigate = useNavigate();
  return (
    <Button type="button" variant="text" size="row" onClick={() => navigate("/configuracion-fiscal")}>
      Ir a Configuración fiscal
    </Button>
  );
}
