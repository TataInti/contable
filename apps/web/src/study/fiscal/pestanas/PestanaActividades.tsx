import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button, EmptyState, Table } from "@contable/design-system";
import type { ClientActivityLink, ConfirmApi, FiscalStep, MutacionConValor } from "../utilidades";

type Props = {
  canWrite: boolean;
  openStepForm: (paso: FiscalStep) => void;
  clientActivitiesQuery: UseQueryResult<ClientActivityLink[]>;
  endActivity: MutacionConValor;
  /** Abre el cajón para corregir la fecha «Desde» de la actividad vinculada (brief 4H). */
  corregirFecha: (row: ClientActivityLink) => void;
  confirm: ConfirmApi;
  renderEstado: (row: ClientActivityLink) => ReactNode;
};

export function PestanaActividades({ canWrite, openStepForm, clientActivitiesQuery, endActivity, corregirFecha, confirm, renderEstado }: Props) {
  return (
    <section className="fiscal-section" aria-labelledby="fiscal-activities-title">
      <div className="fiscal-client-overview__heading"><h3 id="fiscal-activities-title">Actividades</h3>{canWrite ? <Button size="sm" variant="secondary" onClick={() => openStepForm("actividades")}>Agregar</Button> : null}</div>
      {clientActivitiesQuery.isLoading ? <p className="muted-copy">Cargando actividades…</p> : (clientActivitiesQuery.data?.length ?? 0) === 0 ? <EmptyState size="compact" title="Sin actividades vinculadas" description="Vinculá la actividad económica principal del contribuyente." action={canWrite ? <Button size="sm" variant="secondary" onClick={() => openStepForm("actividades")}>Vincular actividad</Button> : undefined} /> : <Table<ClientActivityLink> rows={clientActivitiesQuery.data ?? []} rowKey={(row) => row.id} columns={[
        { key: "code", header: "Código", render: (row) => <strong>{row.activity.code}{!row.activity.isActive ? " (oculto)" : ""}</strong> },
        { key: "activity", header: "Actividad", render: (row) => <>{row.activity.name}</> },
        { key: "jurisdiction", header: "Jurisdicción", render: (row) => <>{row.activity.jurisdiction.name}{!row.activity.jurisdiction.isActive ? " (oculto)" : ""}</> },
        { key: "status", header: "Estado", render: renderEstado },
        { key: "actions", header: "", align: "right", render: (row) => canWrite && !row.validTo ? <><Button size="sm" variant="ghost" onClick={() => corregirFecha(row)}>Corregir fecha</Button><Button size="sm" variant="ghost" loading={endActivity.isPending} onClick={() => confirm.ask({ title: `¿Finalizar ${row.activity.name}?`, description: "La actividad quedará finalizada desde hoy. Esta acción queda registrada en la auditoría.", confirmLabel: "Finalizar", tone: "danger", onConfirm: () => endActivity.mutate(row.id) })}>Finalizar</Button></> : null },
      ]} />}
    </section>
  );
}
