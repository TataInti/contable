import { useEffect, useState, type CSSProperties } from "react";
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

export function defaultCommentsSidebarOpen(viewportWidth: number) {
  return viewportWidth >= 1200;
}

function readPreference(key: string, viewportWidth: number) {
  try {
    const value = window.localStorage.getItem(key);
    if (value === "open") return true;
    if (value === "closed") return false;
  } catch {
    // El almacenamiento puede estar deshabilitado; la preferencia sigue en estado local.
  }
  return defaultCommentsSidebarOpen(viewportWidth);
}

export function CommentsSidebar({ firmId, clientId, periodLabel }: {
  firmId: string | null;
  clientId: string | null;
  periodLabel: string | null;
}) {
  const userId = useSession().me?.userId;
  const storageKey = userId ? commentsSidebarStorageKey(userId) : null;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [open, setOpen] = useState(() => storageKey ? readPreference(storageKey, window.innerWidth) : defaultCommentsSidebarOpen(window.innerWidth));
  const commentsQuery = useQuery({
    queryKey: ["comments", firmId, clientId],
    queryFn: () => api.get<Array<{ id: string }>>(`/firms/${firmId}/clients/${clientId}/comments`),
    enabled: Boolean(firmId && clientId),
  });
  const count = Array.isArray(commentsQuery.data) ? commentsQuery.data.length : 0;

  useEffect(() => {
    if (!storageKey) return;
    setOpen(readPreference(storageKey, window.innerWidth));
    setLoadedKey(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || loadedKey !== storageKey) return;
    try {
      window.localStorage.setItem(storageKey, open ? "open" : "closed");
    } catch {
      // La barra conserva su estado durante esta visita aunque no se pueda persistir.
    }
  }, [open, storageKey, loadedKey]);

  return (
    <aside style={{ "--comments-sidebar-width": `${COMMENTS_SIDEBAR_WIDTH}px` } as CSSProperties} className={`comments-sidebar${open ? " comments-sidebar--open" : " comments-sidebar--closed"}`} aria-label="Comentarios del mes">
      {open ? (
        <>
          <header className="comments-sidebar__header">
            <h2>Comentarios del mes ({count})</h2>
            <Button type="button" variant="text" size="row" onClick={() => setOpen(false)} aria-label="Plegar comentarios">
              <span aria-hidden="true">−</span>
            </Button>
          </header>
          <div className="comments-sidebar__thread">
            <CommentThread firmId={firmId} clientId={clientId} periodLabel={periodLabel} compact />
          </div>
        </>
      ) : (
        <Button type="button" className="comments-sidebar__collapsed" variant="text" onClick={() => setOpen(true)} aria-label={`Comentarios · ${count}`}>
          <Icon name="message" />
          <span>Comentarios · {count}</span>
        </Button>
      )}
    </aside>
  );
}
