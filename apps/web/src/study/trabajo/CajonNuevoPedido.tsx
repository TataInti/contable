import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import { Button, Field, Notice } from "@contable/design-system";
import { ActionDrawer } from "../../ui/ActionDrawer";

export interface BorradorPedido {
  title: string;
  description: string;
  item: string;
  dueDate: string;
}

interface CajonNuevoPedidoProps {
  showRequest: boolean;
  setShowRequest: Dispatch<SetStateAction<boolean>>;
  request: BorradorPedido;
  setRequest: Dispatch<SetStateAction<BorradorPedido>>;
  createRequest: UseMutationResult<unknown, Error, void>;
}

export function CajonNuevoPedido({
  showRequest,
  setShowRequest,
  request,
  setRequest,
  createRequest,
}: CajonNuevoPedidoProps) {
  return (
    <>
      <ActionDrawer
        isOpen={showRequest}
        onClose={() => setShowRequest(false)}
        title="Nuevo pedido"
        description="Describí exactamente qué necesitás y, si corresponde, cuándo debe entregarse."
      >
        <form
          className="study-inline-form study-inline-form--request"
          onSubmit={(event) => {
            event.preventDefault();
            createRequest.mutate();
          }}
        >
          <Field
            id="request-title"
            label="Asunto"
            value={request.title}
            onChange={(event) => setRequest({ ...request, title: event.target.value })}
            maxLength={200}
            required
          />
          <Field
            id="request-item"
            label="Documento solicitado"
            value={request.item}
            onChange={(event) => setRequest({ ...request, item: event.target.value })}
            maxLength={500}
            required
          />
          <label className="ds-field" htmlFor="request-description">
            <span className="ds-field__label">Instrucciones para el cliente</span>
            <textarea
              id="request-description"
              className="study-textarea"
              rows={2}
              value={request.description}
              onChange={(event) => setRequest({ ...request, description: event.target.value })}
              maxLength={4000}
              placeholder="Indicá el período, formato o detalle que necesitás."
            />
          </label>
          <Field
            id="request-due"
            label="Fecha límite"
            type="date"
            value={request.dueDate}
            onChange={(event) => setRequest({ ...request, dueDate: event.target.value })}
          />
          {createRequest.isError ? (
            <Notice tone="error" className="study-inline-form__feedback">
              No se pudo crear el pedido. Revisá los datos e intentá nuevamente.
            </Notice>
          ) : null}
          <div className="study-inline-form__actions">
            <Button
              type="submit"
              loading={createRequest.isPending}
              disabled={!request.title.trim() || !request.item.trim()}
            >
              Crear pedido
            </Button>
          </div>
        </form>
      </ActionDrawer>
    </>
  );
}
