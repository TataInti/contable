import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { Button, Table } from "@contable/design-system";
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
  periodId: string | null;
  setShowClose: (abrir: boolean) => void;
}

export function SeccionCierres({
  closes,
  openCloses,
  capabilities,
  completeCloseItem,
  finalizeClose,
  confirm,
  activeFiscalYear,
  periodId,
  setShowClose,
}: SeccionCierresProps) {
  const puedeIniciar = capabilities.has("period.soft_close");
  const iniciar = (
    <Button
      size="sm"
      variant="ghost"
      disabled={!periodId || !activeFiscalYear}
      title={
        !activeFiscalYear ? "Seleccioná un período contable para abrir el cierre" : undefined
      }
      onClick={() => setShowClose(true)}
    >
      Iniciar cierre
    </Button>
  );
  return (
    <>
      <>
        <section className="study-panel" id="work-closes-section">
          <div className="study-panel__heading">
            <div>
              <h2>Cierres del período</h2>
            </div>
            <span className="section-count">{openCloses.length}</span>
            {puedeIniciar && openCloses.length > 0 ? iniciar : null}
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
            <p className="empty-line">
              <span>Sin cierres en curso</span>
              {puedeIniciar ? (
                <>
                  <span aria-hidden="true"> · </span>
                  {iniciar}
                </>
              ) : null}
            </p>

          )}
        </section>
      </>
    </>
  );
}
