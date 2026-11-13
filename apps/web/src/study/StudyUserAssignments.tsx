import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState } from "@contable/design-system";
import { ActionDrawer } from "../ui/ActionDrawer";
import { api, type Client } from "../lib/api";

interface ClientAssignment {
  id: string;
  userId: string;
  clientId: string;
  capabilities: string[];
  createdAt: string;
  assignedBy: string;
}

interface StudyUserAssignmentsProps {
  firmId: string;
  userId: string;
  userName: string;
  isOpen: boolean;
  onClose: () => void;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function StudyUserAssignments({
  firmId,
  userId,
  userName,
  isOpen,
  onClose,
}: StudyUserAssignmentsProps) {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const clients = useQuery({
    queryKey: ["clients", firmId],
    queryFn: () => api.get<Client[]>(`/firms/${firmId}/clients`),
    enabled: Boolean(firmId && isOpen),
  });
  const clientIds = useMemo(() => (clients.data ?? []).map((client) => client.id), [clients.data]);
  const assignments = useQuery({
    queryKey: ["user-client-assignments", firmId, userId, clientIds],
    queryFn: async () => {
      const perClient = await Promise.all(
        clientIds.map((id) =>
          api.get<ClientAssignment[]>(`/firms/${firmId}/clients/${id}/assignments`),
        ),
      );
      return perClient.flat().filter((assignment) => assignment.userId === userId);
    },
    enabled: Boolean(firmId && userId && isOpen && clients.data),
  });
  const invalidateAssignments = () =>
    void queryClient.invalidateQueries({ queryKey: ["user-client-assignments", firmId, userId] });
  const addAssignment = useMutation({
    mutationFn: (nextClientId: string) =>
      api.post(`/firms/${firmId}/clients/${nextClientId}/assignments`, {
        userId,
        clientId: nextClientId,
      }),
    onSuccess: () => {
      setActionError(null);
      setNotice("El cliente quedó asignado a este usuario.");
      setClientId("");
      invalidateAssignments();
    },
    onError: (error) => {
      setActionError(errorMessage(error, "No se pudo asignar el cliente."));
      setNotice(null);
    },
  });
  const removeAssignment = useMutation({
    mutationFn: (assignment: ClientAssignment) =>
      api.del(`/firms/${firmId}/clients/${assignment.clientId}/assignments/${userId}`),
    onSuccess: () => {
      setActionError(null);
      setNotice("Se quitó la asignación del cliente.");
      invalidateAssignments();
    },
    onError: (error) => {
      setActionError(errorMessage(error, "No se pudo quitar la asignación."));
      setNotice(null);
    },
  });
  const assignedClientIds = new Set((assignments.data ?? []).map((assignment) => assignment.clientId));
  const assignedClients = (clients.data ?? []).filter((client) => assignedClientIds.has(client.id));
  const availableClients = (clients.data ?? []).filter((client) => !assignedClientIds.has(client.id));
  const isLoading = clients.isLoading || (Boolean(clients.data?.length) && assignments.isLoading);
  const isError = clients.isError || assignments.isError;

  return (
    <ActionDrawer
      isOpen={isOpen}
      onClose={onClose}
      eyebrow="Usuarios y accesos"
      title={`Clientes de ${userName}`}
      description="Consultá y actualizá los clientes asignados a este usuario."
    >
      <div className="dense-stack">
        {notice ? <p role="status">{notice}</p> : null}
        {actionError ? (
          <p className="form-error" role="alert">
            {actionError}
          </p>
        ) : null}
        {isLoading ? (
          <div className="query-state" role="status">
            <span className="loading-copy">Cargando clientes y asignaciones…</span>
          </div>
        ) : isError ? (
          <EmptyState
            size="compact"
            title="No se pudieron cargar los clientes"
            description="Reintentá para consultar la lista y sus asignaciones."
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void clients.refetch();
                  void assignments.refetch();
                }}
              >
                Reintentar
              </Button>
            }
          />
        ) : (
          <>
            <label className="ds-field">
              <span className="ds-field__label">Cliente</span>
              <select
                className="ds-field__input"
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                disabled={availableClients.length === 0 || addAssignment.isPending}
              >
                <option value="">Seleccioná un cliente</option>
                {availableClients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.legalName}
                  </option>
                ))}
              </select>
            </label>
            <div className="study-form__actions">
              <Button
                type="button"
                loading={addAssignment.isPending}
                disabled={!clientId}
                onClick={() => {
                  setActionError(null);
                  setNotice(null);
                  addAssignment.mutate(clientId);
                }}
              >
                Asignar cliente
              </Button>
            </div>
            {assignedClients.length > 0 ? (
              <ul className="dense-stack" aria-label="Clientes asignados">
                {assignedClients.map((client) => {
                  const assignment = assignments.data?.find((item) => item.clientId === client.id);
                  if (!assignment) return null;
                  return (
                    <li className="dense-row-actions" key={assignment.id}>
                      <strong>{client.legalName}</strong>
                      <Button
                        type="button"
                        size="row"
                        variant="ghost"
                        loading={
                          removeAssignment.isPending &&
                          removeAssignment.variables?.id === assignment.id
                        }
                        onClick={() => {
                          setActionError(null);
                          setNotice(null);
                          removeAssignment.mutate(assignment);
                        }}
                      >
                        Quitar
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                size="compact"
                title={clients.data?.length ? "Todavía no hay clientes asignados" : "Todavía no hay clientes"}
                description={
                  clients.data?.length
                    ? "Elegí un cliente para agregarlo a la lista de este usuario."
                    : "Los clientes del estudio aparecerán acá cuando estén disponibles."
                }
              />
            )}
          </>
        )}
      </div>
    </ActionDrawer>
  );
}
