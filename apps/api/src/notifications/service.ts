import { Prisma } from "@prisma/client";
import {
  DUE_ALERT_NOTIFICATION_TYPES,
  type DueAlertNotificationType,
  type NotificationItem,
  type NotificationListQuery,
  type NotificationListResponse,
} from "@contable/contracts";
import { withTenantContext } from "../auth/tenant.js";

/**
 * Avisos propios del usuario (corte 3c): lectura por estudio y marcado.
 *
 * user_notifications no tiene FK a tax_obligations ni RLS por estudio: el aislamiento por estudio lo dan la
 * consulta (firmId del estudio con membresía ACTIVE) y la RLS de tax_obligations, que corre dentro de
 * withTenantContext({userId, firmId}) para cada estudio. Un estudio sin membresía ACTIVE no se consulta.
 */

export type NotificationTx = Prisma.TransactionClient;

/** Ejecuta una consulta con el contexto RLS de un estudio (firmId vacío: solo el usuario). */
export type NotificationRunner = <T>(
  firmId: string,
  fn: (tx: NotificationTx) => Promise<T>,
) => Promise<T>;

/** Contexto por defecto: withTenantContext con el usuario y el estudio de cada consulta. */
export function tenantRunner(userId: string): NotificationRunner {
  return (firmId, fn) => withTenantContext({ userId, firmId, actorKind: "USER" }, fn);
}

/** Aviso ajeno, de otro estudio o inexistente: la API responde 404 sin revelar cuál es el caso. */
export class NotificationNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = "RESOURCE_NOT_FOUND";

  constructor() {
    super("Recurso no encontrado");
    this.name = "NotificationNotFoundError";
  }
}

type ActiveFirm = { firmId: string; firmName: string };

type AlertRow = {
  id: string;
  type: string;
  severity: string;
  title: string;
  body: string | null;
  clientId: string;
  clientName: string | null;
  obligationId: string;
  dueDate: Date | null;
  createdAt: Date;
  readAt: Date | null;
};

type Sorted = { item: NotificationItem; ms: number };

/**
 * Avisos visibles de un estudio para el usuario: propios, de vencimiento, no archivados, con una obligación del
 * mismo estudio que la RLS deja ver al usuario y sin presentar (estado FILED o presentación FILED registrada;
 * plan §2.c). El LEFT JOIN trae los datos de la obligación; el filtro IS NOT NULL exige que exista y sea visible.
 */
function visibleAlerts(userId: string, firmId: string): Prisma.Sql {
  return Prisma.sql`
    FROM user_notifications n
    LEFT JOIN tax_obligations o ON o.id = n."resourceId" AND o."firmId" = n."firmId"
    LEFT JOIN clients c ON c.id = o."clientId"
    WHERE n."userId" = ${userId}
      AND n."firmId" = ${firmId}
      AND n.type IN (${Prisma.join([...DUE_ALERT_NOTIFICATION_TYPES])})
      AND n."archivedAt" IS NULL
      AND o.id IS NOT NULL
      AND o.status <> 'FILED'
      AND NOT EXISTS (
        SELECT 1 FROM tax_filings tf
        WHERE tf."obligationId" = o.id AND tf.status = 'FILED'
      )`;
}

/** Membresías ACTIVE del usuario con el nombre de cada estudio. Se filtra por usuario: la RLS también deja ver las de sus colegas. */
async function activeFirms(userId: string, runTx: NotificationRunner): Promise<ActiveFirm[]> {
  const rows = await runTx("", (tx) =>
    tx.firmMembership.findMany({
      where: { userId, status: "ACTIVE" },
      select: { firmId: true, firm: { select: { displayName: true } } },
      orderBy: { firmId: "asc" },
    }),
  );
  return rows.map((row) => ({ firmId: row.firmId, firmName: row.firm.displayName }));
}

function toSorted(row: AlertRow, firm: ActiveFirm): Sorted {
  return {
    ms: row.createdAt.getTime(),
    item: {
      id: row.id,
      type: row.type as DueAlertNotificationType,
      severity: row.severity,
      title: row.title,
      body: row.body,
      firmId: firm.firmId,
      firmName: firm.firmName,
      clientId: row.clientId,
      clientName: row.clientName,
      obligationId: row.obligationId,
      dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt ? row.readAt.toISOString() : null,
    },
  };
}

/** Orden de la API: fecha de creación descendente y, en empate, id descendente (mismo criterio que SQL con COLLATE "C"). */
function newestFirst(a: Sorted, b: Sorted): number {
  if (a.ms !== b.ms) return b.ms - a.ms;
  if (a.item.id === b.item.id) return 0;
  return a.item.id < b.item.id ? 1 : -1;
}

export class NotificationService {
  /**
   * Listado paginado de los avisos visibles de todos los estudios activos del usuario. Cada estudio aporta como
   * máximo offset + limit filas (el resto no puede entrar en la página); luego se ordenan y se recorta la página.
   */
  async list(
    userId: string,
    query: NotificationListQuery,
    runTx: NotificationRunner = tenantRunner(userId),
  ): Promise<NotificationListResponse> {
    const firms = await activeFirms(userId, runTx);
    const end = query.offset + query.limit;
    const merged: Sorted[] = [];
    let total = 0;
    for (const firm of firms) {
      const page = await runTx(firm.firmId, async (tx) => {
        const [counted] = await tx.$queryRaw<{ count: number }[]>(
          Prisma.sql`SELECT COUNT(*)::int AS count ${visibleAlerts(userId, firm.firmId)}`,
        );
        const rows = await tx.$queryRaw<AlertRow[]>(Prisma.sql`
          SELECT n.id, n.type, n.severity, n.title, n.body,
                 o."clientId", c."legalName" AS "clientName",
                 o.id AS "obligationId", o."dueDate", n."createdAt", n."readAt"
          ${visibleAlerts(userId, firm.firmId)}
          ORDER BY n."createdAt" DESC, n.id COLLATE "C" DESC
          LIMIT ${end}`);
        return { count: counted?.count ?? 0, rows };
      });
      total += page.count;
      for (const row of page.rows) merged.push(toSorted(row, firm));
    }
    merged.sort(newestFirst);
    return {
      data: merged.slice(query.offset, end).map((entry) => entry.item),
      meta: { limit: query.limit, offset: query.offset, total },
    };
  }

  /** Cantidad de avisos visibles no leídos, en todos los estudios activos. */
  async unreadCount(
    userId: string,
    runTx: NotificationRunner = tenantRunner(userId),
  ): Promise<number> {
    let count = 0;
    for (const firm of await activeFirms(userId, runTx)) {
      const [row] = await runTx(firm.firmId, (tx) =>
        tx.$queryRaw<{ count: number }[]>(
          Prisma.sql`SELECT COUNT(*)::int AS count ${visibleAlerts(userId, firm.firmId)} AND n."readAt" IS NULL`,
        ),
      );
      count += row?.count ?? 0;
    }
    return count;
  }

  /** Marca como leído un aviso propio. Idempotente: conserva la primera fecha de lectura. */
  async markRead(
    userId: string,
    id: string,
    runTx: NotificationRunner = tenantRunner(userId),
  ): Promise<{ id: string; readAt: string }> {
    for (const firm of await activeFirms(userId, runTx)) {
      const [row] = await runTx(firm.firmId, (tx) =>
        tx.$queryRaw<{ id: string; readAt: Date }[]>(Prisma.sql`
          UPDATE user_notifications AS n
          SET "readAt" = COALESCE(n."readAt", (now() AT TIME ZONE 'UTC'))
          WHERE n.id = ${id}
            AND n."userId" = ${userId}
            AND n."firmId" = ${firm.firmId}
            AND n.type IN (${Prisma.join([...DUE_ALERT_NOTIFICATION_TYPES])})
          RETURNING n.id, n."readAt" AS "readAt"`),
      );
      if (row) return { id: row.id, readAt: row.readAt.toISOString() };
    }
    throw new NotificationNotFoundError();
  }

  /** Archiva un aviso propio: sale del listado y del contador. Idempotente: conserva la primera fecha. */
  async archive(
    userId: string,
    id: string,
    runTx: NotificationRunner = tenantRunner(userId),
  ): Promise<{ id: string; archivedAt: string }> {
    for (const firm of await activeFirms(userId, runTx)) {
      const [row] = await runTx(firm.firmId, (tx) =>
        tx.$queryRaw<{ id: string; archivedAt: Date }[]>(Prisma.sql`
          UPDATE user_notifications AS n
          SET "archivedAt" = COALESCE(n."archivedAt", (now() AT TIME ZONE 'UTC'))
          WHERE n.id = ${id}
            AND n."userId" = ${userId}
            AND n."firmId" = ${firm.firmId}
            AND n.type IN (${Prisma.join([...DUE_ALERT_NOTIFICATION_TYPES])})
          RETURNING n.id, n."archivedAt" AS "archivedAt"`),
      );
      if (row) return { id: row.id, archivedAt: row.archivedAt.toISOString() };
    }
    throw new NotificationNotFoundError();
  }
}
