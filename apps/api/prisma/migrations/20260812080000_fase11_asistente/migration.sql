-- CreateTable
CREATE TABLE "assistant_conversations" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "periodId" TEXT,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistant_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_turns" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "abstained" BOOLEAN NOT NULL DEFAULT false,
    "abstentionReason" TEXT,
    "model" TEXT,
    "provider" TEXT,
    "promptVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_evidence" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ACCOUNT',
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "label" TEXT,
    "value" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_feedback" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "rating" INTEGER,
    "comment" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_usage" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "conversationId" TEXT,
    "turnId" TEXT,
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_conversations_firmId_clientId_idx" ON "assistant_conversations"("firmId", "clientId");

-- CreateIndex
CREATE INDEX "assistant_turns_firmId_clientId_conversationId_idx" ON "assistant_turns"("firmId", "clientId", "conversationId");

-- CreateIndex
CREATE INDEX "assistant_evidence_firmId_clientId_turnId_idx" ON "assistant_evidence"("firmId", "clientId", "turnId");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_feedback_turnId_key" ON "assistant_feedback"("turnId");

-- CreateIndex
CREATE INDEX "assistant_feedback_firmId_clientId_idx" ON "assistant_feedback"("firmId", "clientId");

-- CreateIndex
CREATE INDEX "assistant_usage_firmId_clientId_idx" ON "assistant_usage"("firmId", "clientId");

-- AddForeignKey
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "accounting_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_turns" ADD CONSTRAINT "assistant_turns_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "assistant_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_evidence" ADD CONSTRAINT "assistant_evidence_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "assistant_turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_feedback" ADD CONSTRAINT "assistant_feedback_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "assistant_turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Permisos para el rol runtime (ADR-006)
GRANT SELECT, INSERT, UPDATE, DELETE ON assistant_conversations, assistant_turns, assistant_evidence, assistant_feedback, assistant_usage TO contable_runtime;
