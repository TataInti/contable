import { useEffect, useState, type CSSProperties } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@contable/design-system";
import { api } from "../lib/api";
import { useSession } from "../session/SessionContext";
import { Icon } from "../ui/Icon";
import { CommentThread } from "./CommentThread";

export const COMMENTS_SIDEBAR_WIDTH = 320;
const PREFERENCE_PREFIX = "contable:monthly-comments-sidebar:v1";

export function commentsSidebarStorageKey(userId: string) {
  return `${PREFERENCE_PREFIX}:${userId}`;
}

/** Sin preferencia guardada, la barra abre solo en pantallas anchas y cuando el mes ya tiene comentarios (09-7). */
export function defaultCommentsSidebarOpen(viewportWidth: number, commentCount = 0) {
  return viewportWidth >= 1200 && commentCount > 0;
}

/** Preferencia guardada de la persona: true (abierta), false (plegada) o null (sin elegir). */
function readPreference(key: string): boolean | null {
  try {
    const value = window.localStorage.getItem(key);
    if (value === "open") return true;
    if (value === "closed") return false;
  } catch {
    // El almacenamiento puede estar deshabilitado; la preferencia sigue en estado local.
  }
  return null;
}

export function CommentsSidebar({ firmId, clientId, periodLabel }: {
  firmId: string | null;
  clientId: string | null;
  periodLabel: string | null;
}) {
  const userId = useSession().me?.userId;
  const location = useLocation();
  const storageKey = userId ? commentsSidebarStorageKey(userId) : null;
  // Solo se guarda lo que la persona elige: el estado por defecto depende de la cantidad de comentarios.
  const [preference, setPreference] = useState<boolean | null>(() => (storageKey ? readPreference(storageKey) : null));
  const [focusOnOpen, setFocusOnOpen] = useState(false);
  const commentsQuery = useQuery({
    queryKey: ["comments", firmId, clientId],
    queryFn: () => api.get<Array<{ id: string }>>(`/firms/${firmId}/clients/${clientId}/comments`),
    enabled: Boolean(firmId && clientId),
  });
  const count = Array.isArray(commentsQuery.data) ? commentsQuery.data.length : 0;
  // Un enlace a un comentario concreto (desde «Pendientes para mí») deja la barra abierta.
  const linkedComment = new URLSearchParams(location.search).has("comentario");
  const open = preference ?? (linkedComment || defaultCommentsSidebarOpen(window.innerWidth, count));

  useEffect(() => {
    setPreference(storageKey ? readPreference(storageKey) : null);
  }, [storageKey]);

  const choose = (next: boolean) => {
    setPreference(next);
    setFocusOnOpen(next);
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, next ? "open" : "closed");
    } catch {
      // La barra conserva su estado durante esta visita aunque no se pueda persistir.
    }
  };

  return (
    <aside style={{ "--comments-sidebar-width": `${COMMENTS_SIDEBAR_WIDTH}px` } as CSSProperties} className={`comments-sidebar${open ? " comments-sidebar--open" : " comments-sidebar--closed"}`} aria-label="Comentarios del mes">
      {open ? (
        <>
          <header className="comments-sidebar__header">
            <h2>Comentarios del mes ({count})</h2>
            <Button type="button" variant="text" size="row" onClick={() => choose(false)} aria-label="Plegar comentarios">
              <span aria-hidden="true">−</span>
            </Button>
          </header>
          <div className="comments-sidebar__thread">
            <CommentThread firmId={firmId} clientId={clientId} periodLabel={periodLabel} compact autoFocusInput={focusOnOpen} />
          </div>
        </>
      ) : (
        <Button type="button" className="comments-sidebar__collapsed" variant="text" onClick={() => choose(true)} aria-label={`Comentarios · ${count}`}>
          <Icon name="message" />
          <span>Comentarios · {count}</span>
        </Button>
      )}
    </aside>
  );
}
