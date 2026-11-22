import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button, EmptyState, Table } from "@contable/design-system";
import type { ClientActivityLink, ConfirmApi, FiscalStep, MutacionConValor } from "../utilidades";
import { lineaDeTiempoActividades } from "../historialActividades";

type Props = {
  canWrite: boolean;
  openStepForm: (paso: FiscalStep) => void;
  clientActivitiesQuery: UseQueryResult<ClientActivityLink[]>;
  endActivity: MutacionConValor;
  /** Abre el cajón para corregir el mes de un cambio de actividad registrado (brief 4L). */
  corregirFecha: (row: ClientActivityLink) => void;
  /** Abre el cajón «Registrar cambio de actividad» (brief 4L). */
  registrarCambio: () => void;
  confirm: ConfirmApi;
  renderEstado: (row: ClientActivityLink) => ReactNode;
};

export function PestanaActividades({ canWrite, openStepForm, clientActivitiesQuery, endActivity, corregirFecha, registrarCambio, confirm, renderEstado }: Props) {
  const vinculos = clientActivitiesQuery.data ?? [];
  const hayVigentes = vinculos.some((row) => !row.validTo);
  const lineaDeTiempo = lineaDeTiempoActividades(vinculos);
  return (
    <section className="fiscal-section" aria-labelledby="fiscal-activities-title">
      <div className="fiscal-client-overview__heading">
        <h3 id="fiscal-activities-title">Actividades</h3>
        {canWrite ? (
          <span>
            {hayVigentes ? <Button size="sm" variant="secondary" onClick={registrarCambio}>Registrar cambio de actividad</Button> : null}{" "}
            <Button size="sm" variant="secondary" onClick={() => openStepForm("actividades")}>Agregar</Button>
          </span>
        ) : null}
      </div>
      {clientActivitiesQuery.isLoading ? <p className="muted-copy">Cargando actividades…</p> : vinculos.length === 0 ? <EmptyState size="compact" title="Sin actividades vinculadas" description="Vinculá la actividad económica principal del contribuyente." action={canWrite ? <Button size="sm" variant="secondary" onClick={() => openStepForm("actividades")}>Vincular actividad</Button> : undefined} /> : <>
        <Table<ClientActivityLink> rows={vinculos} rowKey={(row) => row.id} columns={[
          { key: "code", header: "Código", render: (row) => <strong>{row.activity.code}{!row.activity.isActive ? " (oculto)" : ""}</strong> },
          { key: "activity", header: "Actividad", render: (row) => <>{row.activity.name}</> },
          { key: "jurisdiction", header: "Jurisdicción", render: (row) => <>{row.activity.jurisdiction.name}{!row.activity.jurisdiction.isActive ? " (oculto)" : ""}</> },
          { key: "status", header: "Estado", render: renderEstado },
          { key: "actions", header: "", align: "right", render: (row) => canWrite && !row.validTo ? <>{row.isChange ? <Button size="sm" variant="ghost" onClick={() => corregirFecha(row)}>Corregir mes</Button> : null}<Button size="sm" variant="ghost" loading={endActivity.isPending} onClick={() => confirm.ask({ title: `¿Finalizar ${row.activity.name}?`, description: "La actividad quedará finalizada desde hoy. Esta acción queda registrada en la auditoría.", confirmLabel: "Finalizar", tone: "danger", onConfirm: () => endActivity.mutate(row.id) })}>Finalizar</Button></> : null },
        ]} />
        <section aria-labelledby="fiscal-activities-history-title" className="fiscal-activities-history">
          <h4 id="fiscal-activities-history-title">Historial de actividades</h4>
          <ol className="muted-copy">
            {lineaDeTiempo.map((entrada, indice) => <li key={`${entrada.fecha}-${indice}`}>{entrada.texto}</li>)}
          </ol>
        </section>
      </>}
    </section>
  );
}
