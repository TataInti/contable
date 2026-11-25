import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button } from "@contable/design-system";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { useState } from "react";
import "./comments.css";

type InboxItem = { id: string; clientId: string; clientName: string; periodLabel: string | null; body: string; authorName: string };
type NoteItem = { id: string; clientId: string; clientName: string; periodLabel: string | null; body: string; archivedAt: string | null };

export function StudyPendingComments() {
  const { firmId, setClientId } = useClientContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"pending" | "notes">("pending");
  const pending = useQuery({ queryKey: ["comments-inbox", firmId], queryFn: () => api.get<InboxItem[]>(`/firms/${firmId}/comments/inbox`), enabled: Boolean(firmId) });
  const notes = useQuery({ queryKey: ["comments-notes", firmId], queryFn: () => api.get<NoteItem[]>(`/firms/${firmId}/comments/notes`), enabled: Boolean(firmId) });
  const resolve = useMutation({
    mutationFn: (id: string) => api.post(`/firms/${firmId}/comments/${id}/resolve`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["comments-inbox", firmId] }),
  });
  const openThread = (clientId: string, commentId: string) => {
    setClientId(clientId);
    navigate(`/expediente-mensual?comentario=${encodeURIComponent(commentId)}`);
  };
  const items = tab === "pending" ? pending.data ?? [] : notes.data ?? [];
  return <div className="study-page study-comments-inbox">
    <header className="study-page__header"><div>
      <h1 className="study-page__title">Pendientes para mí</h1>
      <p className="study-page__subtitle">Menciones de tu equipo y notas personales, en un solo lugar.</p>
    </div></header>
    <div role="tablist" aria-label="Comentarios">
      <button role="tab" aria-selected={tab === "pending"} onClick={() => setTab("pending")}>Menciones{pending.data?.length ? ` (${pending.data.length})` : ""}</button>
      <button role="tab" aria-selected={tab === "notes"} onClick={() => setTab("notes")}>Mis notas{notes.data?.length ? ` (${notes.data.length})` : ""}</button>
    </div>
    {tab === "pending" && pending.isError ? <p role="alert">No se pudieron cargar tus pendientes.</p> : null}
    {tab === "pending" && pending.isError ? <Button variant="secondary" onClick={() => void pending.refetch()}>Volver a intentar</Button> : null}
    {tab === "notes" && notes.isError ? <p role="alert">No se pudieron cargar tus notas.</p> : null}
    {tab === "notes" && notes.isError ? <Button variant="secondary" onClick={() => void notes.refetch()}>Volver a intentar</Button> : null}
    {resolve.isError ? <p role="alert">No se pudo marcar como resuelto. Volvé a intentar.</p> : null}
    {!items.length && !(tab === "pending" ? pending.isPending : notes.isPending) ? <p>{tab === "pending" ? "No tenés menciones pendientes. Cuando alguien te escriba @tu-nombre en un comentario, aparece acá." : "Todavía no guardaste notas personales."}</p> : null}
    <ol>{items.map((item) => <li key={item.id}>
      <strong>{item.clientName}</strong>{item.periodLabel ? <span> · {item.periodLabel}</span> : null}
      <p>{item.body.length > 180 ? `${item.body.slice(0, 180)}…` : item.body}</p>
      {tab === "pending" ? <Button variant="secondary" loading={resolve.isPending} onClick={() => resolve.mutate(item.id)}>Marcar como resuelto</Button> : null}
      <Button variant="secondary" onClick={() => openThread(item.clientId, item.id)}>Abrir comentario</Button>
    </li>)}</ol>
  </div>;
}
