-- G0-04: unificar enums de pedidos y cierres entre DB, API, contratos y UI.
-- Fuente: PLAN_DESARROLLO_CONTABLE.md §6.8.
-- Convierte columnas status de String a enums tipados preservando datos.

-- CreateEnum
CREATE TYPE "DocumentRequestStatus" AS ENUM ('DRAFT', 'SENT', 'IN_PROGRESS', 'READY_FOR_REVIEW', 'COMPLETED', 'CANCELLED');
CREATE TYPE "DocumentRequestItemStatus" AS ENUM ('PENDING', 'ATTACHED', 'ACCEPTED', 'REJECTED', 'WAIVED');
CREATE TYPE "CloseCycleStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FINALIZED', 'CANCELLED');
CREATE TYPE "CloseWorkItemStatus" AS ENUM ('PENDING', 'DONE', 'SKIPPED');

-- close_cycles: IN_PROGRESS se conserva; OPEN/COMPLETE/COMPLETED legacy → COMPLETED
ALTER TABLE "close_cycles"
  ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "close_cycles"
  ALTER COLUMN "status" TYPE "CloseCycleStatus"
  USING (
    CASE "status"
      WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'::"CloseCycleStatus"
      WHEN 'FINALIZED' THEN 'FINALIZED'::"CloseCycleStatus"
      WHEN 'COMPLETED' THEN 'COMPLETED'::"CloseCycleStatus"
      WHEN 'COMPLETE' THEN 'COMPLETED'::"CloseCycleStatus"
      WHEN 'OPEN' THEN 'COMPLETED'::"CloseCycleStatus"
      WHEN 'CANCELLED' THEN 'CANCELLED'::"CloseCycleStatus"
      WHEN 'CANCELED' THEN 'CANCELLED'::"CloseCycleStatus"
      ELSE 'IN_PROGRESS'::"CloseCycleStatus"
    END
  );
ALTER TABLE "close_cycles"
  ALTER COLUMN "status" SET DEFAULT 'IN_PROGRESS';

-- close_work_items: PENDING/DONE se conservan
ALTER TABLE "close_work_items"
  ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "close_work_items"
  ALTER COLUMN "status" TYPE "CloseWorkItemStatus"
  USING (
    CASE "status"
      WHEN 'PENDING' THEN 'PENDING'::"CloseWorkItemStatus"
      WHEN 'DONE' THEN 'DONE'::"CloseWorkItemStatus"
      WHEN 'COMPLETED' THEN 'DONE'::"CloseWorkItemStatus"
      WHEN 'COMPLETE' THEN 'DONE'::"CloseWorkItemStatus"
      ELSE 'PENDING'::"CloseWorkItemStatus"
    END
  );
ALTER TABLE "close_work_items"
  ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- document_requests: OPEN/COMPLETE/COMPLETED legacy → COMPLETED; SENT se conserva
ALTER TABLE "document_requests"
  ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "document_requests"
  ALTER COLUMN "status" TYPE "DocumentRequestStatus"
  USING (
    CASE "status"
      WHEN 'DRAFT' THEN 'DRAFT'::"DocumentRequestStatus"
      WHEN 'SENT' THEN 'SENT'::"DocumentRequestStatus"
      WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'::"DocumentRequestStatus"
      WHEN 'READY_FOR_REVIEW' THEN 'READY_FOR_REVIEW'::"DocumentRequestStatus"
      WHEN 'COMPLETED' THEN 'COMPLETED'::"DocumentRequestStatus"
      WHEN 'COMPLETE' THEN 'COMPLETED'::"DocumentRequestStatus"
      WHEN 'OPEN' THEN 'IN_PROGRESS'::"DocumentRequestStatus"
      WHEN 'CANCELLED' THEN 'CANCELLED'::"DocumentRequestStatus"
      WHEN 'CANCELED' THEN 'CANCELLED'::"DocumentRequestStatus"
      ELSE 'DRAFT'::"DocumentRequestStatus"
    END
  );
ALTER TABLE "document_requests"
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- document_request_items: PENDING/SUBMITTED/ATTACHED/ACCEPTED/REJECTED/WAIVED
ALTER TABLE "document_request_items"
  ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "document_request_items"
  ALTER COLUMN "status" TYPE "DocumentRequestItemStatus"
  USING (
    CASE "status"
      WHEN 'PENDING' THEN 'PENDING'::"DocumentRequestItemStatus"
      WHEN 'ATTACHED' THEN 'ATTACHED'::"DocumentRequestItemStatus"
      WHEN 'ACCEPTED' THEN 'ACCEPTED'::"DocumentRequestItemStatus"
      WHEN 'REJECTED' THEN 'REJECTED'::"DocumentRequestItemStatus"
      WHEN 'WAIVED' THEN 'WAIVED'::"DocumentRequestItemStatus"
      WHEN 'SUBMITTED' THEN 'ATTACHED'::"DocumentRequestItemStatus"
      WHEN 'COMPLETED' THEN 'ACCEPTED'::"DocumentRequestItemStatus"
      WHEN 'COMPLETE' THEN 'ACCEPTED'::"DocumentRequestItemStatus"
      ELSE 'PENDING'::"DocumentRequestItemStatus"
    END
  );
ALTER TABLE "document_request_items"
  ALTER COLUMN "status" SET DEFAULT 'PENDING';