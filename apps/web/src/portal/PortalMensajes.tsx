import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState } from "@contable/design-system";
import { api, type DocumentRequest, type RequestMessage } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { useSession } from "../session/SessionContext";
import { Icon } from "../ui/Icon";
import { formatPortalDate, PortalLoading, PortalPageHeader } from "./PortalUI";
import "./portal.css";

interface Thread {
  id: string;
  messages: RequestMessage[];
}
interface RequestWithThreads extends DocumentRequest {
  threads: Thread[];
}

export function PortalMensajes() {
  const { clientId } = useClientContext();
  const { me } = useSession();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const query = useQuery({
    queryKey: ["portal-messages", clientId],
    queryFn: () => api.get<RequestWithThreads[]>(`/portal/clients/${clientId}/document-requests`),
    enabled: Boolean(clientId),
  });
  const send = useMutation({
    mutationFn: ({ threadId, body }: { threadId: string; body: string }) =>
      api.post(`/portal/clients/${clientId}/threads/${threadId}/messages`, { body }),
    onSuccess: (_data, variables) => {
      setDrafts((current) => ({ ...current, [variables.threadId]: "" }));
      void queryClient.invalidateQueries({ queryKey: ["portal-messages", clientId] });
    },
  });
  const threads = (query.data ?? []).flatMap((request) =>
    request.threads.map((thread) => ({ ...thread, requestTitle: request.title })),
  );

  return (
    <div className="portal-page portal-page--messages">
      <PortalPageHeader
        eyebrow="Ayuda"
        title="Mensajes"
        description="Conversaciones con tu estudio vinculadas a pedidos de documentación."
      />

      {!clientId ? (
        <EmptyState
          title="Sin empresa seleccionada"
          description="Elegí una empresa para consultar sus conversaciones."
        />
      ) : query.isLoading ? (
        <PortalLoading label="Cargando conversaciones…" />
      ) : query.isError ? (
        <EmptyState
          title="No pudimos cargar los mensajes"
          description="Reintentá en unos minutos."
        />
      ) : threads.length === 0 ? (
        <EmptyState
          title="Todavía no hay conversaciones"
          description="Cuando tu estudio comparta un mensaje sobre un pedido, aparecerá acá."
        />
      ) : (
        <div className="portal-threads">
          {threads.map((thread) => {
            const draft = drafts[thread.id] ?? "";
            const sendingThisThread = send.isPending && send.variables?.threadId === thread.id;
            const failedThisThread = send.isError && send.variables?.threadId === thread.id;
            return (
              <section
                key={thread.id}
                className="portal-thread"
                aria-labelledby={`thread-${thread.id}`}
              >
                <header className="portal-thread__header">
                  <span className="portal-thread__icon" aria-hidden="true">
                    <Icon name="message" size={20} />
                  </span>
                  <div>
                    <p>Pedido de documentación</p>
                    <h2 id={`thread-${thread.id}`}>{thread.requestTitle}</h2>
                  </div>
                </header>

                <div className="portal-thread__messages" aria-live="polite">
                  {thread.messages.length === 0 ? (
                    <p className="portal-thread__empty">
                      Todavía no hay mensajes en esta conversación.
                    </p>
                  ) : (
                    thread.messages.map((message) => {
                      const ownMessage = Boolean(me?.userId) && message.authorUserId === me?.userId;
                      return (
                        <article
                          className={`portal-message${ownMessage ? " portal-message--own" : ""}`}
                          key={message.id}
                        >
                          <div className="portal-message__meta">
                            <strong>{ownMessage ? "Vos" : "Tu estudio"}</strong>
                            <time dateTime={message.createdAt}>
                              {formatPortalDate(message.createdAt, {
                                day: "2-digit",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </time>
                          </div>
                          <p>{message.body}</p>
                        </article>
                      );
                    })
                  )}
                </div>

                <form
                  className="portal-reply"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const body = draft.trim();
                    if (body) send.mutate({ threadId: thread.id, body });
                  }}
                >
                  <label htmlFor={`reply-${thread.id}`}>Responder</label>
                  <textarea
                    id={`reply-${thread.id}`}
                    className="ds-field__input portal-reply__input"
                    rows={3}
                    maxLength={5000}
                    placeholder="Escribí tu mensaje…"
                    value={draft}
                    onChange={(event) => {
                      if (failedThisThread) send.reset();
                      setDrafts((current) => ({ ...current, [thread.id]: event.target.value }));
                    }}
                  />
                  <div className="portal-reply__footer">
                    <span>{draft.length.toLocaleString("es-AR")} / 5.000</span>
                    <Button
                      type="submit"
                      size="sm"
                      loading={sendingThisThread}
                      disabled={!draft.trim() || send.isPending}
                    >
                      Enviar mensaje
                    </Button>
                  </div>
                  {failedThisThread ? (
                    <p className="portal-inline-alert portal-inline-alert--error" role="alert">
                      No pudimos enviar el mensaje. Reintentá.
                    </p>
                  ) : null}
                </form>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
