import { Prisma } from "@prisma/client";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";
import {
  DeletionError,
  groupDeletionCounts,
  type DeletionPreview,
} from "../lib/deletion.js";

/**
 * Borrado definitivo de un cliente y TODOS sus dependientes, en una única
 * transacción. Sólo se invoca desde rutas protegidas por la capability
 * data.delete (OWNER). El guard y la policy RLS clients_delete vuelven a
 * verificar el rol; la marca app.purge_client_id habilita la excepción de
 * inmutabilidad de asientos/liquidaciones exclusivamente dentro de esta
 * transacción y para un OWNER activo del estudio.
 *
 * audit_events queda intacto (append-only). Antes de borrar se registra el
 * evento client.delete con el detalle de filas por tabla, sin datos
 * personales. Los objetos de MinIO se eliminan después del commit; si falla
 * alguno se registra client.delete.storage_cleanup_failed para limpieza.
 */

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 120_000 } as const;
const KNOWN_BUCKETS = new Set(["quarantine", "originals", "derived", "exports"]);

export interface DeletionStorage {
  remove(bucket: string, key: string): Promise<void>;
}

interface DeletionTableRow {
  table_name: string;
}

interface DeletionEdgeRow {
  child: string;
  parent: string;
}

interface CountRow {
  table_name: string;
  count: number;
}

interface StorageObject {
  bucket: string;
  key: string;
}

export interface ClientDeletionResult {
  clientId: string;
  deletedRows: number;
  counts: Record<string, number>;
  storage: {
    total: number;
    deleted: number;
    failed: number;
  };
  auditEventId: string;
}

let cachedOrder: string[] | null = null;

/** Permite a los tests verificar cambios de esquema en la misma corrida. */
export function resetClientDeletionPlanCache(): void {
  cachedOrder = null;
}

function quoteIdentifier(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new DeletionError(
      "CLIENT_DELETE_PLAN_INVALID",
      `El plan de borrado contiene un identificador inválido: ${name}`,
      500,
    );
  }
  return `"${name}"`;
}

/**
 * Ordena las tablas hijas antes que las padres usando el grafo de FKs.
 * audit_events se excluye explícitamente: es append-only y no tiene FK a
 * clients. Las tablas con clientId no alcanzables desde clients se borran
 * primero (no hay otra tabla del cliente que dependa de ellas).
 */
export function buildClientDeletionOrder(
  tables: string[],
  edges: DeletionEdgeRow[],
): string[] {
  const eligible = new Set(tables.filter((table) => table !== "audit_events"));
  const children = new Map<string, Set<string>>();

  for (const edge of edges) {
    if (edge.child === edge.parent) continue;
    if (!eligible.has(edge.child)) continue;
    if (edge.parent !== "clients" && !eligible.has(edge.parent)) continue;
    const bucket = children.get(edge.parent) ?? new Set<string>();
    bucket.add(edge.child);
    children.set(edge.parent, bucket);
  }

  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();

  const visit = (table: string, path: string[]): void => {
    const current = state.get(table);
    if (current === "done") return;
    if (current === "visiting") {
      throw new DeletionError(
        "CLIENT_DELETE_PLAN_CYCLE",
        `El grafo de dependencias tiene un ciclo: ${[...path, table].join(" -> ")}`,
        500,
      );
    }
    state.set(table, "visiting");
    for (const child of children.get(table) ?? []) {
      visit(child, [...path, table]);
    }
    state.set(table, "done");
    if (table !== "clients") order.push(table);
  };

  visit("clients", []);

  const ordered = new Set(order);
  const unreachable = tables
    .filter((table) => table !== "audit_events" && !ordered.has(table))
    .sort((a, b) => a.localeCompare(b));

  return [...unreachable, ...order];
}

async function loadDeletionOrder(tx: Prisma.TransactionClient): Promise<string[]> {
  if (cachedOrder) return cachedOrder;

  const tables = await tx.$queryRaw<DeletionTableRow[]>`
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'clientId'
      AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name
  `;

  const edges = await tx.$queryRaw<DeletionEdgeRow[]>`
    WITH client_tables AS (
      SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public'
        AND c.column_name = 'clientId'
        AND t.table_type = 'BASE TABLE'
    )
    SELECT con.conrelid::regclass::text AS child,
           con.confrelid::regclass::text AS parent
    FROM pg_constraint con
    WHERE con.contype = 'f'
      AND con.conrelid::regclass::text IN (SELECT table_name FROM client_tables)
      AND (
        con.confrelid::regclass::text IN (SELECT table_name FROM client_tables)
        OR con.confrelid = 'clients'::regclass
      )
      AND con.conrelid <> con.confrelid
  `;

  cachedOrder = buildClientDeletionOrder(
    tables.map((row) => row.table_name),
    edges,
  );
  return cachedOrder;
}

async function countClientRows(
  tx: Prisma.TransactionClient,
  order: string[],
  firmId: string,
  clientId: string,
): Promise<CountRow[]> {
  if (order.length === 0) return [];
  const sql = order
    .map(
      (table) =>
        `SELECT '${table.replace(/'/g, "''")}' AS table_name, count(*)::int AS count FROM ${quoteIdentifier(table)} WHERE "firmId" = $1 AND "clientId" = $2`,
    )
    .join(" UNION ALL ");
  return tx.$queryRawUnsafe<CountRow[]>(sql, firmId, clientId);
}

async function collectStorageObjects(
  tx: Prisma.TransactionClient,
  firmId: string,
  clientId: string,
): Promise<StorageObject[]> {
  const [versions, artifacts] = await Promise.all([
    tx.documentFileVersion.findMany({
      where: { firmId, clientId },
      select: { bucket: true, objectKey: true },
    }),
    tx.taxExportArtifact.findMany({
      where: { firmId, clientId, objectKey: { not: null } },
      select: { objectKey: true },
    }),
  ]);

  const objects: StorageObject[] = [];
  for (const version of versions) {
    if (version.objectKey && KNOWN_BUCKETS.has(version.bucket)) {
      objects.push({ bucket: version.bucket, key: version.objectKey });
    }
  }
  for (const artifact of artifacts) {
    if (artifact.objectKey) {
      objects.push({ bucket: "exports", key: artifact.objectKey });
    }
  }
  return objects;
}

export class ClientDeletionService {
  constructor(private readonly storage?: DeletionStorage) {}

  async preview(
    firmId: string,
    clientId: string,
    ctx: TenantContext,
  ): Promise<DeletionPreview> {
    return withTenantContext(
      { ...ctx, firmId, clientId },
      async (tx) => {
        const client = await tx.client.findFirst({
          where: { firmId, id: clientId },
          select: { id: true, legalName: true, tradeName: true, cuit: true },
        });
        if (!client) {
          throw new DeletionError(
            "CLIENT_NOT_FOUND",
            "El cliente no existe o no pertenece a tu estudio",
            404,
          );
        }

        const order = await loadDeletionOrder(tx);
        const [rows, storageObjects] = await Promise.all([
          countClientRows(tx, order, firmId, clientId),
          collectStorageObjects(tx, firmId, clientId),
        ]);
        const counts = rows.map((row) => ({ table: row.table_name, count: row.count }));
        const { groups, items } = groupDeletionCounts(counts);
        const totalRows = counts.reduce((sum, row) => sum + row.count, 0);

        return {
          entity: {
            id: client.id,
            kind: "CLIENT",
            label: client.legalName,
            ...(client.tradeName ? { secondary: client.tradeName } : {}),
          },
          confirmation: {
            expected: client.legalName,
            label: "Escribí la razón social exacta para confirmar",
          },
          totals: { rows: totalRows },
          groups,
          items,
          blockers: [],
          canDelete: true,
          notes: [
            `Se eliminarán ${totalRows} registros dependientes y ${storageObjects.length} archivos del almacenamiento.`,
            "La auditoría del estudio se conserva: el borrado queda registrado como evento append-only.",
            "Esta acción es definitiva y no se puede deshacer.",
          ],
        };
      },
      TRANSACTION_OPTIONS,
    );
  }

  async delete(
    firmId: string,
    clientId: string,
    confirmation: string,
    ctx: TenantContext,
  ): Promise<ClientDeletionResult> {
    const committed = await withTenantContext(
      { ...ctx, firmId, clientId },
      async (tx) => {
        const client = await tx.client.findFirst({
          where: { firmId, id: clientId },
          select: { id: true, legalName: true },
        });
        if (!client) {
          throw new DeletionError(
            "CLIENT_NOT_FOUND",
            "El cliente no existe o no pertenece a tu estudio",
            404,
          );
        }
        if (confirmation.trim() !== client.legalName) {
          throw new DeletionError(
            "CLIENT_CONFIRMATION_MISMATCH",
            "La razón social escrita no coincide con la del cliente",
            409,
          );
        }

        const order = await loadDeletionOrder(tx);
        const storageObjects = await collectStorageObjects(tx, firmId, clientId);

        // Habilita la excepción de inmutabilidad sólo para este cliente y
        // este OWNER. El trigger vuelve a validar ambos datos.
        await tx.$executeRaw`SELECT set_config('app.purge_client_id', ${clientId}, true)`;

        let deletedRows = 0;
        const counts: Record<string, number> = {};
        for (const table of order) {
          const deleted = await tx.$executeRawUnsafe(
            `DELETE FROM ${quoteIdentifier(table)} WHERE "firmId" = $1 AND "clientId" = $2`,
            firmId,
            clientId,
          );
          if (deleted > 0) counts[table] = deleted;
          deletedRows += deleted;
        }

        const clientDelete = await tx.client.deleteMany({ where: { firmId, id: clientId } });
        if (clientDelete.count !== 1) {
          throw new DeletionError(
            "CLIENT_DELETE_INCOMPLETE",
            "No se pudo eliminar el cliente; la transacción se revirtió",
            409,
          );
        }

        const audit = await tx.auditEvent.create({
          data: {
            firmId,
            clientId,
            userId: ctx.userId,
            actorKind: "USER",
            action: "client.delete",
            entityType: "Client",
            entityId: clientId,
            after: {
              deletedRows,
              tables: counts,
              storageObjects: storageObjects.length,
            },
          },
          select: { id: true },
        });

        return { deletedRows, counts, storageObjects, auditEventId: audit.id };
      },
      TRANSACTION_OPTIONS,
    );

    let storageDeleted = 0;
    const storageFailed: StorageObject[] = [];
    if (this.storage) {
      for (const object of committed.storageObjects) {
        try {
          await this.storage.remove(object.bucket, object.key);
          storageDeleted += 1;
        } catch {
          storageFailed.push(object);
        }
      }
    }

    if (storageFailed.length > 0) {
      // El borrado de la base ya está confirmado. Dejamos un evento explícito
      // para que la limpieza de objetos huérfanos sea auditable y reintentable.
      await withTenantContext(
        { userId: ctx.userId, firmId, clientId, actorKind: "USER" },
        (tx) =>
          tx.auditEvent.create({
            data: {
              firmId,
              clientId,
              userId: ctx.userId,
              actorKind: "USER",
              action: "client.delete.storage_cleanup_failed",
              entityType: "Client",
              entityId: clientId,
              after: {
                failedObjects: storageFailed.length,
                objects: storageFailed.map((object) => ({
                  bucket: object.bucket,
                  key: object.key,
                })),
              },
            },
          }),
      );
    }

    return {
      clientId,
      deletedRows: committed.deletedRows,
      counts: committed.counts,
      storage: {
        total: committed.storageObjects.length,
        deleted: storageDeleted,
        failed: storageFailed.length,
      },
      auditEventId: committed.auditEventId,
    };
  }
}
