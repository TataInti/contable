import type { UseQueryResult } from "@tanstack/react-query";
import { Button, EmptyState, Table } from "@contable/design-system";
import { formatearFecha } from "../../../lib/formatoFechas";
import { StatusBadge } from "../../../ui/StatusBadge";
import type { ConfirmApi, FiscalStep, MutacionConValor, TaxRegistration } from "../utilidades";

type Props = {
  canWrite: boolean;
  openStepForm: (paso: FiscalStep) => void;
  registrationsQuery: UseQueryResult<TaxRegistration[]>;
  cancelRegistration: MutacionConValor;
  confirm: ConfirmApi;
};

export function PestanaRegimenes({ canWrite, openStepForm, registrationsQuery, cancelRegistration, confirm }: Props) {
  return (
    <section className="fiscal-section" aria-labelledby="fiscal-regimes-title">
      <div className="fiscal-client-overview__heading"><h3 id="fiscal-regimes-title">Regímenes adheridos</h3>{canWrite ? <Button size="sm" variant="secondary" onClick={() => openStepForm("inscripcion")}>Agregar</Button> : null}</div>
      {registrationsQuery.isLoading ? <p className="muted-copy">Cargando adhesiones…</p> : (registrationsQuery.data?.length ?? 0) === 0 ? <EmptyState size="compact" title="Sin regímenes adheridos" description="Registrá el régimen fiscal que aplica al contribuyente." action={canWrite ? <Button size="sm" variant="secondary" onClick={() => openStepForm("inscripcion")}>Registrar inscripción</Button> : undefined} /> : <Table<TaxRegistration> rows={registrationsQuery.data ?? []} rowKey={(row) => row.id} columns={[
        { key: "regime", header: "Régimen", render: (row) => <strong>{row.regime.name}{!row.regime.isActive ? " (oculto)" : ""}</strong> },
        { key: "tax", header: "Impuesto", render: (row) => <>{row.regime.taxType.name}{!row.regime.taxType.isActive ? " (oculto)" : ""}</> },
        { key: "jurisdiction", header: "Jurisdicción", render: (row) => <>{row.regime.jurisdiction.name}{!row.regime.jurisdiction.isActive ? " (oculto)" : ""}</> },
        { key: "from", header: "Desde", render: (row) => <span className="tabular-copy">{formatearFecha(row.validFrom)}</span> },
        { key: "status", header: "Estado", render: (row) => <StatusBadge status={row.status} /> },
        { key: "actions", header: "", align: "right", render: (row) => canWrite && row.status === "ACTIVE" ? <Button size="sm" variant="ghost" loading={cancelRegistration.isPending} onClick={() => confirm.ask({ title: `¿Dar de baja ${row.regime.name}?`, description: "La adhesión al régimen quedará cancelada desde hoy. Esta acción queda registrada en la auditoría.", confirmLabel: "Dar de baja", tone: "danger", onConfirm: () => cancelRegistration.mutate(row.id) })}>Dar de baja</Button> : null },
      ]} />}
    </section>
  );
}
