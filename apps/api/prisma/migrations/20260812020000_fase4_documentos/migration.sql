-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'VALIDATING', 'READY', 'APPLIED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER', 'CANCELED');

-- CreateEnum
CREATE TYPE "UploadSessionStatus" AS ENUM ('PENDING', 'COMPLETED', 'EXPIRED', 'CANCELED');

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "category" TEXT,
    "direction" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "currentFileVersionId" TEXT,
    "currentExtractionId" TEXT,
    "uploadedByUserId" TEXT,
    "uploadOrigin" TEXT NOT NULL DEFAULT 'FIRM',
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_file_versions" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "pages" INTEGER,
    "sha256" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "objectVersion" TEXT,
    "antivirusStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "isOriginal" BOOLEAN NOT NULL DEFAULT true,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_file_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_processing_jobs" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "fileVersionId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'VALIDATE',
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "stage" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "deduplicationKey" TEXT,
    "traceId" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_processing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_sessions" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "UploadSessionStatus" NOT NULL DEFAULT 'PENDING',
    "expectedMime" TEXT,
    "maxSizeBytes" INTEGER NOT NULL,
    "maxFiles" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_firmId_clientId_status_idx" ON "documents"("firmId", "clientId", "status");

-- CreateIndex
CREATE INDEX "documents_firmId_clientId_createdAt_idx" ON "documents"("firmId", "clientId", "createdAt");

-- CreateIndex
CREATE INDEX "document_file_versions_firmId_clientId_idx" ON "document_file_versions"("firmId", "clientId");

-- CreateIndex
CREATE INDEX "document_file_versions_sha256_idx" ON "document_file_versions"("sha256");

-- CreateIndex
CREATE INDEX "document_processing_jobs_firmId_clientId_status_idx" ON "document_processing_jobs"("firmId", "clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "document_processing_jobs_deduplicationKey_key" ON "document_processing_jobs"("deduplicationKey");

-- CreateIndex
CREATE INDEX "upload_sessions_firmId_clientId_idx" ON "upload_sessions"("firmId", "clientId");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_file_versions" ADD CONSTRAINT "document_file_versions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_processing_jobs" ADD CONSTRAINT "document_processing_jobs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

