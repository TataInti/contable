-- CreateTable
CREATE TABLE "vat_rules" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(10,4) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vat_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vat_liquidations" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "cutoff" TIMESTAMP(3) NOT NULL,
    "rulesVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CALCULATED',
    "totals" JSONB,
    "differences" JSONB,
    "preparedByUserId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vat_liquidations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligations" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "frequency" TEXT NOT NULL DEFAULT 'MONTHLY',
    "dueDay" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligation_instances" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "materializedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "obligation_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligation_reminders" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "instanceId" TEXT,
    "rule" TEXT NOT NULL DEFAULT 'DUE_DATE',
    "offsetDays" INTEGER NOT NULL DEFAULT 0,
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "obligation_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_dispatches" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "reminderId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminder_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "close_cycles" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "close_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "close_work_items" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "assigneeUserId" TEXT,
    "completedByUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "close_work_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_requests" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "dueDate" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_request_items" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_threads" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'INTERNAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "request_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_messages" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'INTERNAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_VatLiquidationToVatRule" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_VatLiquidationToVatRule_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "vat_rules_firmId_clientId_idx" ON "vat_rules"("firmId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "vat_rules_clientId_code_version_key" ON "vat_rules"("clientId", "code", "version");

-- CreateIndex
CREATE INDEX "vat_liquidations_firmId_clientId_periodId_idx" ON "vat_liquidations"("firmId", "clientId", "periodId");

-- CreateIndex
CREATE INDEX "obligations_firmId_clientId_idx" ON "obligations"("firmId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "obligations_clientId_code_version_key" ON "obligations"("clientId", "code", "version");

-- CreateIndex
CREATE INDEX "obligation_instances_firmId_clientId_dueDate_idx" ON "obligation_instances"("firmId", "clientId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "obligation_instances_obligationId_periodLabel_key" ON "obligation_instances"("obligationId", "periodLabel");

-- CreateIndex
CREATE INDEX "obligation_reminders_firmId_clientId_idx" ON "obligation_reminders"("firmId", "clientId");

-- CreateIndex
CREATE INDEX "reminder_dispatches_firmId_clientId_idx" ON "reminder_dispatches"("firmId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_dispatches_reminderId_instanceId_key" ON "reminder_dispatches"("reminderId", "instanceId");

-- CreateIndex
CREATE INDEX "close_cycles_firmId_clientId_idx" ON "close_cycles"("firmId", "clientId");

-- CreateIndex
CREATE INDEX "close_work_items_firmId_clientId_cycleId_idx" ON "close_work_items"("firmId", "clientId", "cycleId");

-- CreateIndex
CREATE INDEX "document_requests_firmId_clientId_idx" ON "document_requests"("firmId", "clientId");

-- CreateIndex
CREATE INDEX "document_request_items_firmId_clientId_requestId_idx" ON "document_request_items"("firmId", "clientId", "requestId");

-- CreateIndex
CREATE INDEX "request_threads_firmId_clientId_requestId_idx" ON "request_threads"("firmId", "clientId", "requestId");

-- CreateIndex
CREATE INDEX "request_messages_firmId_clientId_threadId_idx" ON "request_messages"("firmId", "clientId", "threadId");

-- CreateIndex
CREATE INDEX "_VatLiquidationToVatRule_B_index" ON "_VatLiquidationToVatRule"("B");

-- AddForeignKey
ALTER TABLE "vat_rules" ADD CONSTRAINT "vat_rules_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vat_liquidations" ADD CONSTRAINT "vat_liquidations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vat_liquidations" ADD CONSTRAINT "vat_liquidations_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vat_liquidations" ADD CONSTRAINT "vat_liquidations_preparedByUserId_fkey" FOREIGN KEY ("preparedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vat_liquidations" ADD CONSTRAINT "vat_liquidations_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_instances" ADD CONSTRAINT "obligation_instances_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_instances" ADD CONSTRAINT "obligation_instances_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "obligations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_reminders" ADD CONSTRAINT "obligation_reminders_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_reminders" ADD CONSTRAINT "obligation_reminders_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "obligations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_reminders" ADD CONSTRAINT "obligation_reminders_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "obligation_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_dispatches" ADD CONSTRAINT "reminder_dispatches_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "obligation_reminders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_dispatches" ADD CONSTRAINT "reminder_dispatches_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "obligation_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "close_cycles" ADD CONSTRAINT "close_cycles_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "close_cycles" ADD CONSTRAINT "close_cycles_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "close_cycles" ADD CONSTRAINT "close_cycles_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "close_work_items" ADD CONSTRAINT "close_work_items_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "close_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "close_work_items" ADD CONSTRAINT "close_work_items_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "close_work_items" ADD CONSTRAINT "close_work_items_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_request_items" ADD CONSTRAINT "document_request_items_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "document_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_request_items" ADD CONSTRAINT "document_request_items_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_threads" ADD CONSTRAINT "request_threads_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_threads" ADD CONSTRAINT "request_threads_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "document_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_messages" ADD CONSTRAINT "request_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "request_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_messages" ADD CONSTRAINT "request_messages_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_VatLiquidationToVatRule" ADD CONSTRAINT "_VatLiquidationToVatRule_A_fkey" FOREIGN KEY ("A") REFERENCES "vat_liquidations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_VatLiquidationToVatRule" ADD CONSTRAINT "_VatLiquidationToVatRule_B_fkey" FOREIGN KEY ("B") REFERENCES "vat_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Permisos para el rol runtime (ADR-006)
GRANT SELECT, INSERT, UPDATE, DELETE ON vat_rules, vat_liquidations, obligations, obligation_instances, obligation_reminders, reminder_dispatches, close_cycles, close_work_items, document_requests, document_request_items, request_threads, request_messages TO contable_runtime;
