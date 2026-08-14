-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('GENERATED', 'NEEDS_REVIEW', 'REVIEWED', 'SUPERSEDED', 'FAILED');

-- CreateTable
CREATE TABLE "document_extractions" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "fileVersionId" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "status" "ExtractionStatus" NOT NULL DEFAULT 'GENERATED',
    "classification" TEXT,
    "confidence" DOUBLE PRECISION,
    "ocrEngine" TEXT,
    "model" TEXT,
    "provider" TEXT,
    "promptVersion" TEXT,
    "normalizedText" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_fields" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "extractionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "rawValue" TEXT,
    "normalizedValue" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "page" INTEGER,
    "boundingBox" JSONB,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACCEPTED',
    "correction" TEXT,
    "reason" TEXT,

    CONSTRAINT "extracted_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_line_items" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "extractionId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" TEXT,
    "unitPrice" TEXT,
    "netAmount" TEXT,
    "vatRate" TEXT,
    "vatAmount" TEXT,
    "totalAmount" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "page" INTEGER,
    "boundingBox" JSONB,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACCEPTED',

    CONSTRAINT "extracted_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_extractions_firmId_clientId_documentId_idx" ON "document_extractions"("firmId", "clientId", "documentId");

-- CreateIndex
CREATE INDEX "extracted_fields_firmId_clientId_extractionId_idx" ON "extracted_fields"("firmId", "clientId", "extractionId");

-- CreateIndex
CREATE INDEX "extracted_line_items_firmId_clientId_extractionId_idx" ON "extracted_line_items"("firmId", "clientId", "extractionId");

-- AddForeignKey
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_fields" ADD CONSTRAINT "extracted_fields_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "document_extractions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_line_items" ADD CONSTRAINT "extracted_line_items_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "document_extractions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

