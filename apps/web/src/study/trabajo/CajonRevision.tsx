import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import { Button } from "@contable/design-system";
import { ActionDrawer } from "../../ui/ActionDrawer";
import type { ClientContextValue } from "../../context/ClientContext";
import type { WorkDocumentRequest } from "./tipos";

interface CajonRevisionProps {
  reviewRequest: WorkDocumentRequest | undefined;
  setActiveReviewRequestId: Dispatch<SetStateAction<string | null>>;
  rejectReason: string;
  setRejectReason: Dispatch<SetStateAction<string>>;
  capabilities: ClientContextValue["capabilities"];
  acceptItem: UseMutationResult<unknown, Error, { requestId: string; itemId: string }>;
  waiveItem: UseMutationResult<unknown, Error, { requestId: string; itemId: string }>;
  rejectItem: UseMutationResult<
    unknown,
    Error,
    { requestId: string; itemId: string; reason: string }
  >;
}

export function CajonRevision({
  reviewRequest,
  setActiveReviewRequestId,
  rejectReason,
  setRejectReason,
  capabilities,
  acceptItem,
  waiveItem,
  rejectItem,
}: CajonRevisionProps) {
  return (
    <>
      <ActionDrawer
        isOpen={Boolean(reviewRequest)}
        onClose={() => {
          setActiveReviewRequestId(null);
          setRejectReason("");
        }}
        title="Revisión de ítems"
        description={reviewRequest?.title}
      >
        {reviewRequest ? (
          <div className="study-page__form">
            <p className="study-page__hint">
              Estado del pedido: <strong>{reviewRequest.status}</strong>. La completitud se deriva
              de los ítems aceptados o eximidos.
            </p>
            <div className="request-review-list">
              {reviewRequest.items.map((item) => {
                const canResolve = item.status === "ATTACHED";
                return (
                  <div key={item.id} className="request-review-list__item">
                    <div>
                      <strong>{item.description}</strong>
                      <small>
                        {item.required ? "Requerido" : "Opcional"} · {item.status}
                      </small>
                    </div>
                    {canResolve && capabilities.has("request.manage") ? (
                      <div className="table-actions">
                        <Button
                          size="sm"
                          loading={acceptItem.isPending}
                          onClick={() => acceptItem.mutate({ requestId: reviewRequest.id, itemId: item.id })}
                        >
                          Aceptar
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={waiveItem.isPending}
                          onClick={() => waiveItem.mutate({ requestId: reviewRequest.id, itemId: item.id })}
                        >
                          Eximir
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={rejectItem.isPending}
                          disabled={!rejectReason.trim()}
                          onClick={() =>
                            rejectItem.mutate({
                              requestId: reviewRequest.id,
                              itemId: item.id,
                              reason: rejectReason.trim(),
                            })
                          }
                        >
                          Rechazar
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {reviewRequest.items.some((item) => item.status === "ATTACHED") &&
            capabilities.has("request.manage") ? (
              <>
                <label className="ds-field" htmlFor="request-reject-reason">
                  <span className="ds-field__label">Motivo de rechazo</span>
                  <textarea
                    id="request-reject-reason"
                    className="study-textarea"
                    rows={2}
                    value={rejectReason}
                    onChange={(event) => setRejectReason(event.target.value)}
                    placeholder="Indicá qué debe corregir el cliente."
                  />
                </label>
                <p className="study-page__hint">
                  Para rechazar un ítem, elegí el motivo y usá la acción correspondiente en la
                  fila.
                </p>
              </>
            ) : null}
          </div>
        ) : null}
      </ActionDrawer>
    </>
  );
}
