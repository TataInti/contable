-- Snapshot aditivo e inmutable del dato final confirmado al aprobar.
CREATE TABLE "extraction_approved_snapshots" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "extractionId" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "schemaVersion" TEXT NOT NULL,
    "ocrEngine" TEXT,
    "model" TEXT,
    "provider" TEXT,
    "promptVersion" TEXT,
    "data" JSONB NOT NULL,
    CONSTRAINT "extraction_approved_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "extraction_approved_snapshots_extractionId_key"
    ON "extraction_approved_snapshots"("extractionId");
CREATE INDEX "extraction_approved_snapshots_firmId_clientId_documentId_approvedAt_idx"
    ON "extraction_approved_snapshots"("firmId", "clientId", "documentId", "approvedAt");

ALTER TABLE "extraction_approved_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "extraction_approved_snapshots" FORCE ROW LEVEL SECURITY;

CREATE POLICY "extraction_approved_snapshots_select" ON "extraction_approved_snapshots" FOR SELECT
    USING (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY "extraction_approved_snapshots_insert" ON "extraction_approved_snapshots" FOR INSERT
    WITH CHECK (
        current_setting('app.actor_kind', true) <> 'PORTAL'
        AND app_can_access_tenant("firmId", "clientId")
    );

REVOKE ALL ON TABLE "extraction_approved_snapshots" FROM PUBLIC;
REVOKE ALL ON TABLE "extraction_approved_snapshots" FROM contable_worker;
GRANT SELECT, INSERT ON TABLE "extraction_approved_snapshots" TO contable_runtime;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "extraction_approved_snapshots" FROM contable_runtime, contable_worker;

CREATE FUNCTION reject_extraction_approved_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'approved extraction snapshots are immutable'
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER extraction_approved_snapshots_immutable
    BEFORE UPDATE OR DELETE ON "extraction_approved_snapshots"
    FOR EACH ROW EXECUTE FUNCTION reject_extraction_approved_snapshot_mutation();
