import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@contable/design-system";
import { ApiError, api } from "../lib/api";
import { ActionDrawer } from "./ActionDrawer";
import "./DeletionDrawer.css";

export interface DeletionPreview {
  entity: { id: string; kind: string; label: string; secondary?: string };
  confirmation: { expected: string; label: string };
  totals: { rows: number; affectedClients?: number };
  groups: Array<{ key: string; label: string; count: number }>;
  items: Array<{ key: string; label: string; count: number }>;
  blockers: Array<{ key: string; label: string; count: number }>;
  canDelete: boolean;
  notes: string[];
}

export interface DeletionResult {
  storage?: { total: number; deleted: number; failed: number };
}

interface DeletionDrawerProps {
  isOpen: boolean;
  path: string;
  onClose: () => void;
  onDeleted: (result: DeletionResult) => void | Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError || error instanceof Error
    ? error.message
    : "No se pudo completar la eliminación. Intentá nuevamente.";
}

export function DeletionDrawer({ isOpen, path, onClose, onDeleted }: DeletionDrawerProps) {
  const [confirmation, setConfirmation] = useState("");
  const previewQuery = useQuery({
    queryKey: ["deletion-preview", path],
    queryFn: () => api.get<DeletionPreview>(`${path}/deletion-preview`),
    enabled: isOpen && Boolean(path),
    retry: false,
  });
  const deletion = useMutation({
    mutationFn: (confirmation: string) => api.del<DeletionResult>(path, { confirmation }),
    onSuccess: async (result) => {
      await onDeleted(result);
      setConfirmation("");
      onClose();
    },
  });
  const close = () => {
    setConfirmation("");
    deletion.reset();
    onClose();
  };
  const preview = previewQuery.data;
  const canConfirm =
    Boolean(preview?.canDelete) &&
    confirmation.trim() === preview?.confirmation.expected &&
    !deletion.isPending;

  return (
    <ActionDrawer
      isOpen={isOpen}
      onClose={close}
      eyebrow="Eliminación definitiva"
      title={preview?.entity.label ?? "Revisar eliminación"}
      description={preview?.entity.secondary}
      size="wide"
    >
      {previewQuery.isLoading ? <p role="status">Calculando el impacto…</p> : null}
      {previewQuery.isError ? (
        <div className="form-error" role="alert">
          <p>{errorMessage(previewQuery.error)}</p>
          <Button type="button" variant="secondary" onClick={() => void previewQuery.refetch()}>
            Reintentar
          </Button>
        </div>
      ) : null}
      {preview ? (
        <div className="deletion-preview">
          <section className="deletion-preview__summary" aria-label="Impacto de la eliminación">
            <h3>Impacto de la eliminación</h3>
            <p>
              Se revisaron <span className="deletion-preview__count">{preview.totals.rows}</span>{" "}
              registros dependientes.
            </p>
            {preview.totals.affectedClients !== undefined ? (
              <p>
                Clientes afectados: <span className="deletion-preview__count">{preview.totals.affectedClients}</span>
              </p>
            ) : null}
            {preview.items.length > 0 ? (
              <ul className="deletion-preview__list">
                {preview.items.map((item) => (
                  <li key={item.key}>
                    {item.label}: <span className="deletion-preview__count">{item.count}</span>
                  </li>
                ))}
              </ul>
            ) : <p>No hay registros dependientes.</p>}
          </section>

          {preview.blockers.length > 0 ? (
            <section className="deletion-preview__blockers" aria-label="Bloqueos">
              <h3>Bloqueos</h3>
              <ul className="deletion-preview__list">
                {preview.blockers.map((item) => (
                  <li key={item.key}>
                    {item.label}: <span className="deletion-preview__count">{item.count}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {preview.notes.length > 0 ? (
            <ul className="deletion-preview__notes">
              {preview.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          ) : null}

          <label className="deletion-preview__confirmation">
            <span>{preview.confirmation.label}</span>
            <input
              className="ds-field__input"
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              aria-label={preview.confirmation.label}
              placeholder={preview.confirmation.expected}
            />
          </label>
          {deletion.isError ? <p className="form-error" role="alert">{errorMessage(deletion.error)}</p> : null}
          {!preview.canDelete ? (
            <p className="form-error" role="status">Resolvé las dependencias indicadas antes de eliminar.</p>
          ) : null}
          <div className="deletion-preview__actions">
            <Button type="button" variant="ghost" onClick={close}>Cancelar</Button>
            <Button
              type="button"
              variant="danger"
              loading={deletion.isPending}
              loadingLabel="Eliminando"
              disabled={!canConfirm}
              onClick={() => {
                if (confirmation) deletion.mutate(confirmation);
              }}
            >
              Eliminar definitivamente
            </Button>
          </div>
        </div>
      ) : null}
    </ActionDrawer>
  );
}
