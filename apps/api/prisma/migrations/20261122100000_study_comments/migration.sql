-- Comentarios internos por estudio/cliente, notas personales e historial inmutable.
CREATE TABLE "study_comments" (
  "id" text PRIMARY KEY,
  "firmId" text NOT NULL,
  "clientId" text NOT NULL,
  "authorUserId" text NOT NULL,
  "body" text NOT NULL CHECK (char_length("body") BETWEEN 1 AND 4000),
  "isPersonal" boolean NOT NULL DEFAULT false,
  "periodLabel" text,
  "mentionedUserId" text,
  "resolvedAt" timestamptz,
  "resolvedByUserId" text,
  "archivedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "study_comments_client_fkey" FOREIGN KEY ("firmId", "clientId") REFERENCES "clients"("firmId", "id") ON DELETE CASCADE,
  CONSTRAINT "study_comments_author_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id"),
  CONSTRAINT "study_comments_mentioned_user_fkey" FOREIGN KEY ("mentionedUserId") REFERENCES "users"("id"),
  CONSTRAINT "study_comments_resolved_by_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id"),
  CONSTRAINT "study_comments_private_no_mention" CHECK (NOT ("isPersonal" AND "mentionedUserId" IS NOT NULL))
);
CREATE INDEX "study_comments_thread_idx" ON "study_comments" ("firmId", "clientId", "createdAt");
CREATE UNIQUE INDEX "study_comments_firmId_id_key" ON "study_comments" ("firmId", "id");
CREATE INDEX "study_comments_inbox_idx" ON "study_comments" ("firmId", "mentionedUserId", "resolvedAt") WHERE "mentionedUserId" IS NOT NULL;

CREATE TABLE "study_comment_edits" (
  "id" text PRIMARY KEY,
  "firmId" text NOT NULL,
  "commentId" text NOT NULL,
  "editorUserId" text NOT NULL REFERENCES "users"("id"),
  "previousBody" text NOT NULL,
  "editedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "study_comment_edits_firm_comment_fkey" FOREIGN KEY ("firmId", "commentId") REFERENCES "study_comments"("firmId", "id") ON DELETE CASCADE
);
CREATE INDEX "study_comment_edits_comment_idx" ON "study_comment_edits" ("firmId", "commentId", "editedAt");

ALTER TABLE "study_comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "study_comments" FORCE ROW LEVEL SECURITY;
CREATE POLICY study_comments_select ON "study_comments" FOR SELECT USING (
  "firmId" = current_setting('app.firm_id', true)
  AND current_setting('app.actor_kind', true) <> 'PORTAL'
  AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  AND app_can_access_tenant("firmId", "clientId")
  AND (NOT "isPersonal" OR "authorUserId" = current_setting('app.user_id', true))
);
CREATE POLICY study_comments_insert ON "study_comments" FOR INSERT WITH CHECK (
  "firmId" = current_setting('app.firm_id', true)
  AND current_setting('app.actor_kind', true) <> 'PORTAL'
  AND "authorUserId" = current_setting('app.user_id', true)
  AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  AND app_can_access_tenant("firmId", "clientId")
  AND ("mentionedUserId" IS NULL OR EXISTS (
    SELECT 1 FROM "firm_memberships" fm WHERE fm."firmId" = "study_comments"."firmId"
      AND fm."userId" = "study_comments"."mentionedUserId" AND fm.status = 'ACTIVE'
  ))
);
CREATE POLICY study_comments_update ON "study_comments" FOR UPDATE USING (
  "firmId" = current_setting('app.firm_id', true)
  AND current_setting('app.actor_kind', true) <> 'PORTAL'
  AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  AND app_can_access_tenant("firmId", "clientId")
  AND ("authorUserId" = current_setting('app.user_id', true) OR "mentionedUserId" = current_setting('app.user_id', true))
) WITH CHECK (
  "firmId" = current_setting('app.firm_id', true)
  AND current_setting('app.actor_kind', true) <> 'PORTAL'
  AND app_can_access_tenant("firmId", "clientId")
  AND ("authorUserId" = current_setting('app.user_id', true) OR "mentionedUserId" = current_setting('app.user_id', true))
);

ALTER TABLE "study_comment_edits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "study_comment_edits" FORCE ROW LEVEL SECURITY;
CREATE POLICY study_comment_edits_select ON "study_comment_edits" FOR SELECT USING (
  "firmId" = current_setting('app.firm_id', true)
  AND EXISTS (SELECT 1 FROM "study_comments" c WHERE c."id" = "study_comment_edits"."commentId")
);
CREATE POLICY study_comment_edits_insert ON "study_comment_edits" FOR INSERT WITH CHECK (
  "firmId" = current_setting('app.firm_id', true)
  AND "editorUserId" = current_setting('app.user_id', true)
  AND EXISTS (SELECT 1 FROM "study_comments" c WHERE c."id" = "study_comment_edits"."commentId" AND c."authorUserId" = current_setting('app.user_id', true))
);
GRANT SELECT, INSERT, UPDATE ON "study_comments" TO contable_runtime;
GRANT SELECT, INSERT ON "study_comment_edits" TO contable_runtime;
REVOKE DELETE ON "study_comments", "study_comment_edits" FROM contable_runtime;
