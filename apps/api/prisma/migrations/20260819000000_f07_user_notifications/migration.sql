-- ============================================================
-- F0.7: UserNotification (notificaciones internas, PLAN §5.3)
-- Tabla de sistema con RLS por userId (frontera principal de lectura).
-- ============================================================

-- CreateTable
CREATE TABLE "user_notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firmId" TEXT,
    "clientId" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "deduplicationKey" TEXT,
    "readAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_notifications_userId_deduplicationKey_key" ON "user_notifications"("userId", "deduplicationKey");

-- CreateIndex
CREATE INDEX "user_notifications_userId_createdAt_idx" ON "user_notifications"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: cada usuario sólo lee/actualiza sus propias notificaciones. Los
-- productores internos (worker) crean para destinatarios resueltos por
-- autorización; el actor PORTAL nunca escribe notificaciones.
ALTER TABLE "user_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_notifications" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notif_select ON "user_notifications";
DROP POLICY IF EXISTS notif_insert ON "user_notifications";
DROP POLICY IF EXISTS notif_update ON "user_notifications";
DROP POLICY IF EXISTS notif_delete ON "user_notifications";
CREATE POLICY notif_select ON "user_notifications" FOR SELECT USING (current_setting('app.user_id', true) = "userId");
CREATE POLICY notif_insert ON "user_notifications" FOR INSERT WITH CHECK (current_setting('app.actor_kind', true) <> 'PORTAL');
CREATE POLICY notif_update ON "user_notifications" FOR UPDATE USING (current_setting('app.user_id', true) = "userId") WITH CHECK (current_setting('app.user_id', true) = "userId");
CREATE POLICY notif_delete ON "user_notifications" FOR DELETE USING (current_setting('app.user_id', true) = "userId");

-- Grants para contable_runtime: CRUD (el worker usa contable_worker).
GRANT SELECT, INSERT, UPDATE, DELETE ON user_notifications TO contable_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_notifications TO contable_worker;