import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import { Button, EmptyState, Notice } from "@contable/design-system";
import { ActionDrawer } from "../../ui/ActionDrawer";
import { formatearFecha } from "../../lib/formatoFechas";
import type { ClientContextValue } from "../../context/ClientContext";
import type { RequestThread } from "./tipos";

export interface ConversacionActiva {
  requestId: string;
  threadId: string;
  title: string;
}

interface CajonConversacionProps {
  activeConversation: ConversacionActiva | null;
  setActiveConversation: Dispatch<SetStateAction<ConversacionActiva | null>>;
  conversationThread: RequestThread | undefined;
  capabilities: ClientContextValue["capabilities"];
  messageBody: string;
  setMessageBody: Dispatch<SetStateAction<string>>;
  sendMessage: UseMutationResult<unknown, Error, void>;
}

export function CajonConversacion({
  activeConversation,
  setActiveConversation,
  conversationThread,
  capabilities,
  messageBody,
  setMessageBody,
  sendMessage,
}: CajonConversacionProps) {
  return (
    <>
      <ActionDrawer
        isOpen={Boolean(activeConversation)}
        onClose={() => setActiveConversation(null)}
        title="Conversación"
        description={activeConversation?.title}
      >
        {activeConversation ? (
          <>
            {conversationThread?.messages.length ? (
              <div className="request-message-list" aria-live="polite">
                {conversationThread.messages.map((message) => (
                  <div key={message.id} className="request-message-list__item">
                    <strong>{message.visibility === "SHARED" ? "Compartido" : "Interno"}</strong>
                    <p>{message.body}</p>
                    <small>{formatearFecha(message.createdAt)}</small>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                size="compact"
                title="Todavía no hay mensajes"
                description="Dejá una instrucción o consulta para el cliente."
              />
            )}
            {capabilities.has("message.shared") ? (
              <form
                className="study-page__form"
                onSubmit={(event) => {
                  event.preventDefault();
                  sendMessage.mutate();
                }}
              >
                <label className="ds-field" htmlFor="request-message">
                  <span className="ds-field__label">Mensaje compartido</span>
                  <textarea
                    id="request-message"
                    className="study-textarea"
                    rows={3}
                    value={messageBody}
                    onChange={(event) => setMessageBody(event.target.value)}
                    maxLength={5000}
                    placeholder="Escribí una instrucción clara para el cliente."
                  />
                </label>
                {sendMessage.isError ? (
                  <Notice tone="error">{sendMessage.error.message}</Notice>
                ) : null}
                <div className="study-inline-form__actions">
                  <Button
                    type="submit"
                    loading={sendMessage.isPending}
                    disabled={!messageBody.trim()}
                  >
                    Enviar mensaje
                  </Button>
                </div>
              </form>
            ) : null}
          </>
        ) : null}
      </ActionDrawer>
    </>
  );
}
