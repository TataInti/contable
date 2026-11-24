import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { Button, Notice } from "@contable/design-system";
import { api } from "../lib/api";
import { useSession } from "../session/SessionContext";
import "./comments.css";

type CommentRow = {
  id: string; clientId: string; authorUserId: string; authorName: string; body: string;
  isPersonal: boolean; periodLabel: string | null; mentionedUserId: string | null; mentionedName: string | null;
  resolvedAt: string | null; archivedAt: string | null; createdAt: string; updatedAt: string; isEdited: boolean;
};
type Member = { id: string; name: string };

export function CommentThread({ firmId, clientId, periodLabel, compact = false, collapsible = false }: {
  firmId: string | null; clientId: string | null; periodLabel?: string | null; compact?: boolean; collapsible?: boolean;
}) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const userId = useSession().me?.userId;
  const [expanded, setExpanded] = useState(false);
  const [body, setBody] = useState("");
  const [search, setSearch] = useState("");
  const [mentionedUserId, setMentionedUserId] = useState<string | null>(null);
  const [isPersonal, setIsPersonal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  const base = `/firms/${firmId}/clients/${clientId}/comments`;
  const query = useQuery({ queryKey: ["comments", firmId, clientId], queryFn: () => api.get<CommentRow[]>(base), enabled: Boolean(firmId && clientId) });
  const members = useQuery({ queryKey: ["comment-members", firmId, clientId, search], queryFn: () => api.get<Member[]>(`${base}/members?search=${encodeURIComponent(search.slice(1))}`), enabled: Boolean(firmId && clientId && search.startsWith("@")) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["comments", firmId, clientId] });
  const create = useMutation({ mutationFn: () => api.post<CommentRow>(base, { body, isPersonal, mentionedUserId, periodLabel }), onSuccess: (created) => { queryClient.setQueryData<CommentRow[]>(["comments", firmId, clientId], (previous) => [created, ...(previous ?? []).filter((item) => item.id !== created.id)]); setPendingScrollId(created.id); setBody(""); setSearch(""); setMentionedUserId(null); setIsPersonal(false); void refresh(); } });
  const edit = useMutation({ mutationFn: ({ id, text }: { id: string; text: string }) => api.patch<CommentRow>(`/firms/${firmId}/comments/${id}`, { body: text }), onSuccess: () => { setEditingId(null); void refresh(); } });
  const archive = useMutation({ mutationFn: (id: string) => api.post(`/firms/${firmId}/comments/${id}/archive`, {}), onSuccess: refresh });
  useEffect(() => {
    if (collapsible) setExpanded(false);
  }, [collapsible, periodLabel]);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("comentario");
    if (id && location.pathname === "/expediente-mensual" && query.data && collapsible) setExpanded(true);
  }, [location.pathname, location.search, query.data, collapsible]);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("comentario");
    if (id && location.pathname === "/expediente-mensual" && query.data && (!collapsible || expanded)) {
      document.getElementById(`comentario-${id}`)?.scrollIntoView?.({ block: "center" });
    }
  }, [location.pathname, location.search, query.data, collapsible, expanded]);
  useEffect(() => {
    if (!pendingScrollId || !query.data) return;
    document.getElementById(`comentario-${pendingScrollId}`)?.scrollIntoView?.({ block: "nearest" });
    setPendingScrollId(null);
  }, [pendingScrollId, query.data]);
  const comments = Array.isArray(query.data) ? query.data : [];
  const orderedComments = [...comments].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const matchingMembers = Array.isArray(members.data) ? members.data : [];
  if (!firmId || !clientId) return null;
  if (collapsible && !expanded) return <section className="comment-thread comment-thread--collapsed" aria-label="Comentarios"><Button className="comment-thread__toggle" variant="text" onClick={() => setExpanded(true)}>Comentarios del mes ({comments.length}) · Abrir</Button></section>;
  return <section className="comment-thread" aria-label="Comentarios">
    {collapsible ? <Button className="comment-thread__toggle" variant="text" onClick={() => setExpanded(false)}>Comentarios del mes ({comments.length}) · Cerrar</Button> : <h2>{compact ? "Comentarios" : "Comentarios del mes"}</h2>}
    {query.isError ? <Notice tone="error">No se pudieron cargar los comentarios. Actualizá la pantalla para volver a intentar.</Notice> : null}
    {query.isPending ? <p role="status">Cargando comentarios…</p> : null}
    <ol className="comment-thread__list">
      {orderedComments.map((item) => <li key={item.id} id={`comentario-${item.id}`} className="comment-thread__item">
        <p className="comment-thread__meta"><strong>{item.authorName}</strong><span aria-hidden="true"> · </span><time className="comment-thread__date" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString("es-AR")}</time>
          {item.isEdited ? <span> · editado</span> : null}{item.periodLabel ? <span> · {item.periodLabel}</span> : null}</p>
        {item.archivedAt ? <p>Comentario archivado</p> : editingId === item.id ? <form onSubmit={(event) => { event.preventDefault(); edit.mutate({ id: item.id, text: editingBody }); }}>
          <label htmlFor={`edit-comment-${item.id}`}>Editar comentario</label>
          <textarea id={`edit-comment-${item.id}`} className="study-textarea" required maxLength={4000} value={editingBody} onChange={(event) => setEditingBody(event.target.value)} />
          {edit.isError ? <p role="alert">No se pudo guardar el cambio. Revisá el comentario e intentá nuevamente.</p> : null}
          <Button type="submit" loading={edit.isPending}>Guardar cambios</Button>
          <Button type="button" variant="ghost" onClick={() => setEditingId(null)}>Cancelar</Button>
        </form> : <p>{item.body}</p>}
        {item.mentionedName ? <p>Mención para {item.mentionedName}{item.resolvedAt ? " · resuelta" : ""}</p> : null}
        {item.authorUserId === userId && !item.archivedAt ? <div className="comment-thread__actions">
          <Button size="sm" variant="ghost" onClick={() => { setEditingId(item.id); setEditingBody(item.body); }}>Editar comentario</Button>
          <Button size="sm" variant="ghost" onClick={() => archive.mutate(item.id)}>Archivar</Button>
        </div> : null}
      </li>)}
    </ol>
    <form onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
      <label htmlFor="comment-text">Escribí un comentario</label><textarea id="comment-text" className="study-textarea" required value={body} maxLength={4000} aria-describedby="comment-length" onChange={(event) => { const value = event.target.value; setBody(value); const at = value.match(/(?:^|\s)(@[^\s]*)$/); setSearch(at?.[1] ?? ""); if (!at) setMentionedUserId(null); }} rows={compact ? 3 : 4} />
      <p id="comment-length">Hasta 4000 caracteres · {body.length}/4000</p>
      {search.startsWith("@") && !isPersonal ? <ul role="listbox" aria-label="Personas del estudio">
        {matchingMembers.map((member) => <li key={member.id} role="option" aria-selected={mentionedUserId === member.id}>
          <button type="button" onClick={() => { setMentionedUserId(member.id); setBody((value) => value.replace(/(?:^|\s)@[^\s]*$/, ` @${member.name} `)); setSearch(""); }}>{member.name}</button>
        </li>)}
      </ul> : null}
      {mentionedUserId ? <p>Se notificará en «Pendientes para mí».</p> : search.startsWith("@") ? <p role="status">Elegí una persona del estudio para completar la mención.</p> : null}
      <label><input type="checkbox" checked={isPersonal} onChange={(event) => { setIsPersonal(event.target.checked); if (event.target.checked) { setMentionedUserId(null); setSearch(""); } }} /> Solo para mí</label>
      {create.isError ? <p role="alert">No se pudo guardar el comentario. Revisá el texto y volvé a intentar.</p> : null}
      <Button type="submit" variant="secondary" loading={create.isPending}>Comentar</Button>
    </form>
  </section>;
}
