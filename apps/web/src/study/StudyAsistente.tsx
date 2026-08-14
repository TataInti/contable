import { useRef, useState } from "react";
import { Button, EmptyState } from "@contable/design-system";
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
}

const SUGGESTIONS = [
  "¿Cuál es el saldo de caja del período?",
  "¿Qué asientos siguen pendientes de revisión?",
  "Resumí las obligaciones próximas.",
];

export function StudyAsistente() {
  const { firmId, clientId, periodId } = useClientContext();
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conversation = useRef<{ contextKey: string; id: string } | null>(null);

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
        },
      ]);
    } catch (err) {
      setMensajes((prev) => prev.filter((message) => message.id !== optimisticId));
      setInput(pregunta);
      setError(err instanceof ApiError ? err.message : "Error al consultar el asistente");
    } finally {
      setLoading(false);
    }
  };

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
          <span className="assistant-context-ok">
            <Icon name="shield" size={16} /> Contexto verificado
          </span>
        ) : null}
      </div>

      {!firmId || !clientId || !periodId ? (
        <EmptyState
          title="Completá el contexto"
          description="Seleccioná estudio, cliente y período para consultar únicamente cifras canónicas."
        />
      ) : (
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
                    <button type="button" key={suggestion} onClick={() => setInput(suggestion)}>
                      {suggestion}
                      <Icon name="arrow-right" size={14} />
                    </button>
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
                        {message.abstained ? "Sin evidencia suficiente" : "Respuesta verificada"}
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
              <p className="form-error" role="alert">
                {error} Tu consulta quedó restaurada para que puedas reintentar.
              </p>
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
      )}
    </div>
  );
}
