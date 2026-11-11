ALTER TABLE "document_extractions"
  ADD COLUMN "inputTokens" INTEGER,
  ADD COLUMN "outputTokens" INTEGER,
  ADD COLUMN "latencyMs" INTEGER,
  ADD COLUMN "estimatedCostUsd" DOUBLE PRECISION,
  ADD COLUMN "reviewReason" TEXT,
  ADD COLUMN "voucherData" JSONB;
