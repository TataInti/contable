import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Notice } from "@contable/design-system";
import { useNavigate } from "react-router-dom";
import { api, ApiError, type AssistantTurn } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { Icon } from "../ui/Icon";
import "./study.css";

interface Mensaje {
  id: string;
  autor: "Tú" | "Asistente";
  cuerpo: string;
  abstained?: boolean;
  evidence?: AssistantTurn["evidence"];
  canRate?: boolean;
}

interface ConversationTurn {
  id: string;
  role: "USER" | "ASSISTANT" | string;
  content: string;
  abstained: boolean;
  createdAt: string;
}

interface AssistantConversation {
  id: string;
  periodId: string | null;
  title: string | null;
  status: string;
  updatedAt: string;
  turns: ConversationTurn[];
}

const SUGGESTIONS = [
  "¿Cuál es el saldo de caja del período?",
  "¿Qué asientos siguen pendientes de revisión?",
  "Resumí las obligaciones próximas.",
];

export function StudyAsistente() {
  const { firmId, clientId, periodId, capabilities } = useClientContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [feedbackByTurn, setFeedbackByTurn] = useState<Record<string, -1 | 1>>({});
  const [feedbackPending, setFeedbackPending] = useState<string | null>(null);
  const conversation = useRef<{ contextKey: string; id: string } | null>(null);
  const contextKey = `${firmId ?? ""}:${clientId ?? ""}:${periodId ?? ""}`;
  const conversationsQuery = useQuery({
    queryKey: ["assistant-conversations", firmId, clientId],
    queryFn: () =>
      api.get<AssistantConversation[]>(
        `/firms/${firmId}/clients/${clientId}/assistant/conversations`,
      ),
    enabled: Boolean(firmId && clientId && capabilities.has("ai.use")),
  });
  const periodConversations = useMemo(
    () => (conversationsQuery.data ?? []).filter((item) => item.periodId === periodId),
    [conversationsQuery.data, periodId],
  );

  useEffect(() => {
    conversation.current = null;
    setSelectedConversationId(null);
    setMensajes([]);
    setFeedbackByTurn({});
    setError(null);
  }, [contextKey]);

  const startNewConversation = () => {
    conversation.current = null;
    setSelectedConversationId(null);
    setMensajes([]);
    setFeedbackByTurn({});
    setInput("");
    setError(null);
  };

  const selectConversation = (nextId: string) => {
    if (!nextId) {
      startNewConversation();
      return;
    }
    const selected = periodConversations.find((item) => item.id === nextId);
    if (!selected) return;
    conversation.current = { contextKey, id: selected.id };
    setSelectedConversationId(selected.id);
    setFeedbackByTurn({});
    setMensajes(
      selected.turns.map((turn) => ({
        id: turn.id,
        autor: turn.role === "USER" ? "Tú" : "Asistente",
        cuerpo: turn.content,
        abstained: turn.abstained,
      })),
    );
    setError(null);
  };

  const recordFeedback = async (turnId: string, rating: -1 | 1) => {
    if (!firmId || !clientId || feedbackPending || feedbackByTurn[turnId] !== undefined) return;
    setFeedbackPending(turnId);
    setError(null);
    try {
      await api.post(`/firms/${firmId}/clients/${clientId}/assistant/turns/${turnId}/feedback`, {
        rating,
      });
      setFeedbackByTurn((current) => ({ ...current, [turnId]: rating }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo registrar tu valoración");
    } finally {
      setFeedbackPending(null);
    }
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const pregunta = input.trim();
    if (!pregunta || !firmId || !clientId || !periodId) return;
    const optimisticId = `user-${crypto.randomUUID()}`;
    setMensajes((prev) => [...prev, { id: optimisticId, autor: "Tú", cuerpo: pregunta }]);
    setInput("");
    setError(null);
    setLoading(true);

    try {
      const contextKey = `${firmId}:${clientId}:${periodId}`;
      let convId = conversation.current?.contextKey === contextKey ? conversation.current.id : null;
      if (!convId) {
        const conv = await api.post<{ id: string }>(
          `/firms/${firmId}/clients/${clientId}/assistant/conversations`,
          { periodId, title: pregunta.slice(0, 80) },
        );
        convId = conv.id;
        conversation.current = { contextKey, id: convId };
        setSelectedConversationId(convId);
      }
      const turn = await api.post<{ assistantTurn: AssistantTurn }>(
        `/firms/${firmId}/clients/${clientId}/assistant/conversations/${convId}/turns`,
        { query: pregunta },
      );
      setMensajes((prev) => [
        ...prev,
        {
          id: turn.assistantTurn.id,
          autor: "Asistente",
          cuerpo: turn.assistantTurn.content,
          abstained: turn.assistantTurn.abstained,
          evidence: turn.assistantTurn.evidence,
          canRate: true,
        },
      ]);
      void queryClient.invalidateQueries({
        queryKey: ["assistant-conversations", firmId, clientId],
      });
    } catch (err) {
      setMensajes((prev) => prev.filter((message) => message.id !== optimisticId));
      setInput(pregunta);
      setError(err instanceof ApiError ? err.message : "Error al consultar el asistente");
    } finally {
      setLoading(false);
    }
  };

  if (!capabilities.has("ai.use")) {
    return (
      <div className="study-page assistant-page">
        <EmptyState
          title="Asistente restringido"
          description="Tu rol no tiene permiso para consultar el asistente contable."
        />
      </div>
    );
  }

  return (
    <div className="study-page assistant-page">
      <div className="study-page__header">
        <div>
          <p className="study-page__eyebrow">Consulta con evidencia</p>
          <h1 className="study-page__title">Asistente contable</h1>
          <p className="study-page__subtitle">
            Preguntá sobre el cliente y período activos. Cada cifra debe poder rastrearse a su
            fuente.
          </p>
        </div>
        {firmId && clientId && periodId ? (
          <div className="study-page__actions">
            <label className="period-select">
              <span className="sr-only">Conversación</span>
              <select
                value={selectedConversationId ?? ""}
                onChange={(event) => selectConversation(event.target.value)}
                aria-label="Conversación del período"
              >
                <option value="">Nueva conversación</option>
                {periodConversations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title ?? "Consulta sin título"}
                  </option>
                ))}
              </select>
            </label>
            <Button type="button" variant="ghost" onClick={startNewConversation}>
              <Icon name="plus" size={16} /> Nueva
            </Button>
            <span className="assistant-context-ok">
              <Icon name="shield" size={16} /> Contexto verificado
            </span>
          </div>
        ) : null}
      </div>

      {!firmId || !clientId || !periodId ? (
        <EmptyState
          title="Completá el contexto"
          description="Seleccioná estudio, cliente y período para consultar únicamente cifras canónicas."
          action={
            !clientId && capabilities.has("client.read") ? (
              <Button onClick={() => navigate("/clientes")}>Elegir cliente</Button>
            ) : !periodId && capabilities.has("tax.profile.read") ? (
              <Button onClick={() => navigate("/configuracion-fiscal")}>Configurar período</Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {conversationsQuery.isError ? (
            <Notice
              tone="warning"
              action={
                <Button size="sm" variant="ghost" onClick={() => void conversationsQuery.refetch()}>
                  Reintentar
                </Button>
              }
            >
              No se pudo recuperar el historial. Podés iniciar una conversación nueva.
            </Notice>
          ) : null}
          <section className="assistant-workspace" aria-label="Conversación con el asistente">
            <div className="study-chat" aria-live="polite">
              {mensajes.length === 0 ? (
                <div className="assistant-welcome">
                  <span className="assistant-welcome__mark">
                    <Icon name="spark" size={24} />
                  </span>
                  <div>
                    <h2>¿Qué necesitás revisar?</h2>
                    <p>
                      Puedo leer información contable del contexto activo, explicar resultados y
                      señalar la evidencia utilizada.
                    </p>
                  </div>
                  <div className="assistant-suggestions" aria-label="Consultas sugeridas">
                    {SUGGESTIONS.map((suggestion) => (
                      <Button type="button" key={suggestion} variant="secondary" onClick={() => setInput(suggestion)}>
                        {suggestion}
                        <Icon name="arrow-right" size={14} />
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
              {mensajes.map((message) => (
                <article
                  key={message.id}
                  className={`study-chat__message ${message.autor === "Tú" ? "study-chat__message--user" : "study-chat__message--assistant"}`}
                >
                  <div className="study-chat__avatar" aria-hidden="true">
                    {message.autor === "Tú" ? "T" : <Icon name="spark" size={15} />}
                  </div>
                  <div className="study-chat__content">
                    <div className="study-chat__head">
                      <strong>{message.autor}</strong>
                      {message.autor === "Asistente" ? (
                        <span
                          className={
                            message.abstained
                              ? "assistant-verification assistant-verification--partial"
                              : "assistant-verification"
                          }
                        >
                          <Icon name={message.abstained ? "alert" : "shield"} size={13} />
                          {message.abstained
                            ? "Sin evidencia suficiente"
                            : message.evidence
                              ? "Respuesta verificada"
                              : "Respuesta anterior"}
                        </span>
                      ) : null}
                    </div>
                    <p className="study-chat__body">{message.cuerpo}</p>
                    {message.evidence?.length ? (
                      <details className="assistant-evidence">
                        <summary>
                          <Icon name="file" size={14} /> {message.evidence.length}{" "}
                          {message.evidence.length === 1
                            ? "fuente consultada"
                            : "fuentes consultadas"}
                        </summary>
                        <ul>
                          {message.evidence.map((source) => (
                            <li key={`${source.sourceType}-${source.sourceId}`}>
                              <span>{source.label ?? source.sourceId}</span>
                              <strong>{source.value ?? "Sin valor"}</strong>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    {message.autor === "Asistente" && message.canRate ? (
                      <div className="table-actions" aria-label="Valoración de la respuesta">
                        {feedbackByTurn[message.id] !== undefined ? (
                          <small className="muted-copy">
                            {feedbackByTurn[message.id] === 1
                              ? "Marcaste esta respuesta como útil."
                              : "Registramos que esta respuesta no resolvió la consulta."}
                          </small>
                        ) : (
                          <>
                            <small className="muted-copy">¿Te resultó útil?</small>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              loading={feedbackPending === message.id}
                              onClick={() => void recordFeedback(message.id, 1)}
                            >
                              Sí
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={feedbackPending !== null}
                              onClick={() => void recordFeedback(message.id, -1)}
                            >
                              No
                            </Button>
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
              {loading ? (
                <div
                  className="study-chat__message study-chat__message--assistant assistant-thinking"
                  role="status"
                >
                  <div className="study-chat__avatar">
                    <Icon name="spark" size={15} />
                  </div>
                  <div>
                    <span className="assistant-thinking__dots">
                      <i />
                      <i />
                      <i />
                    </span>
                    <small>Consultando fuentes canónicas…</small>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="assistant-composer">
              {error ? (
                <Notice tone="error">
                  {error}{" "}
                  {input
                    ? "Tu consulta quedó restaurada para que puedas reintentar."
                    : "Podés reintentar la acción."}
                </Notice>
              ) : null}
              <form onSubmit={enviar}>
                <label className="sr-only" htmlFor="assistant-query">
                  Consulta
                </label>
                <textarea
                  id="assistant-query"
                  rows={2}
                  maxLength={4000}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Preguntá sobre saldos, asientos, obligaciones o reportes…"
                />
                <div className="assistant-composer__footer">
                  <span>
                    <Icon name="shield" size={14} /> Sólo datos del contexto activo
                  </span>
                  <span className="assistant-composer__count">{input.length}/4000</span>
                  <Button
                    type="submit"
                    disabled={!input.trim() || loading || !firmId || !clientId || !periodId}
                  >
                    <Icon name="arrow-right" size={17} /> Consultar
                  </Button>
                </div>
              </form>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
