import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { Button, EmptyState, Table } from "@contable/design-system";
import { StatusBadge } from "../../ui/StatusBadge";
import type { useConfirmAction } from "../../ui/ConfirmAction";
import type { ClientContextValue } from "../../context/ClientContext";
import type { FiscalYear } from "../../lib/api";
import type { CloseCycle } from "./tipos";

interface SeccionCierresProps {
  closes: UseQueryResult<CloseCycle[], Error>;
  openCloses: CloseCycle[];
  capabilities: ClientContextValue["capabilities"];
  completeCloseItem: UseMutationResult<unknown, Error, { cycleId: string; workItemId: string }>;
  finalizeClose: UseMutationResult<unknown, Error, string>;
  confirm: ReturnType<typeof useConfirmAction>;
  activeFiscalYear: FiscalYear | undefined;
  setShowClose: Dispatch<SetStateAction<boolean>>;
}

export function SeccionCierres({
  closes,
  openCloses,
  capabilities,
  completeCloseItem,
  finalizeClose,
  confirm,
  activeFiscalYear,
  setShowClose,
}: SeccionCierresProps) {
  // Sin cierres, la sección es una línea («Cierres · 0 · Iniciar cierre»), no una caja vacía.
  if (!closes.isLoading && !closes.isError && openCloses.length === 0) {
    return (
      <section className="work-line" id="work-closes-section">
        <h2>Cierres</h2>
        <span className="section-count">0</span>
        {capabilities.has("period.soft_close") ? (
          <Button size="sm" variant="ghost" onClick={() => setShowClose(true)}>
            Iniciar cierre
          </Button>
        ) : null}
      </section>
    );
  }
  return (
    <>
      <>
        <section className="study-panel" id="work-closes-section">
          <div className="study-panel__heading">
            <div>
              <h2>Cierres</h2>
            </div>
            <span className="section-count">{openCloses.length}</span>
          </div>
          {closes.isLoading ? (
            <div className="query-state query-state--compact">
              <span className="loading-copy">Cargando cierres…</span>
            </div>
          ) : openCloses.length ? (
            <Table
              rows={openCloses}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: "status",
                  header: "Estado",
                  render: (row) => <StatusBadge status={row.status} />,
                },
                {
                  key: "progress",
                  header: "Avance",
                  render: (row) => {
                    const done = row.workItems.filter((item) => item.status === "DONE").length;
                    return (
                      <div className="progress-cell">
                        <progress
                          value={done}
                          max={Math.max(row.workItems.length, 1)}
                          aria-label={`${done} de ${row.workItems.length} tareas completas`}
                        />
                        <small>
                          {done} de {row.workItems.length}
                        </small>
                      </div>
                    );
                  },
                },
                {
                  key: "actions",
                  header: "Acciones",
                  align: "right",
                  render: (row) => {
                    const next = row.workItems.find((item) => item.status !== "DONE");
                    const ready = row.workItems.length > 0 && !next;
                    if (!capabilities.has("period.soft_close"))
                      return <span className="muted-copy">—</span>;
                    return (
                      <div className="table-actions">
                        {next ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={completeCloseItem.isPending}
                            onClick={() =>
                              completeCloseItem.mutate({ cycleId: row.id, workItemId: next.id })
                            }
                          >
                            Completar: {next.title}
                          </Button>
                        ) : ready ? (
                          <Button
                            size="sm"
                            loading={finalizeClose.isPending}
                            onClick={() =>
                              confirm.ask({
                                title: "¿Finalizar este cierre?",
                                description:
                                  "El ciclo quedará bloqueado para auditoría y no podrá volver a un estado anterior.",
                                confirmLabel: "Finalizar cierre",
                                onConfirm: () => finalizeClose.mutate(row.id),
                              })
                            }
                          >
                            Finalizar cierre
                          </Button>
                        ) : null}
                      </div>
                    );
                  },
                },
              ]}
            />
          ) : (
            <EmptyState
              size="compact"
              title="Sin ciclos de cierre"
              description="Cuando se abra un cierre vas a ver su avance acá."
              action={
                capabilities.has("period.soft_close") && activeFiscalYear ? (
                  <Button size="sm" variant="secondary" onClick={() => setShowClose(true)}>
                    Iniciar cierre
                  </Button>
                ) : undefined
              }
            />
          )}
        </section>
      </>
    </>
  );
}
