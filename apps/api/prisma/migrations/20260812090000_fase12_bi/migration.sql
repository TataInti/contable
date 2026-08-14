-- CreateTable
CREATE TABLE "bi_metrics" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bi_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_dimensions" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bi_dimensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_dashboards" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "layout" JSONB,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bi_dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_widgets" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "plan" JSONB,
    "cutoff" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "result" JSONB,
    "resultHash" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bi_widgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_snapshots" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "cutoff" TIMESTAMP(3) NOT NULL,
    "resultHash" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bi_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bi_metrics_firmId_clientId_idx" ON "bi_metrics"("firmId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "bi_metrics_clientId_code_version_key" ON "bi_metrics"("clientId", "code", "version");

-- CreateIndex
CREATE INDEX "bi_dimensions_firmId_clientId_idx" ON "bi_dimensions"("firmId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "bi_dimensions_clientId_code_key" ON "bi_dimensions"("clientId", "code");

-- CreateIndex
CREATE INDEX "bi_dashboards_firmId_clientId_idx" ON "bi_dashboards"("firmId", "clientId");

-- CreateIndex
CREATE INDEX "bi_widgets_firmId_clientId_dashboardId_idx" ON "bi_widgets"("firmId", "clientId", "dashboardId");

-- CreateIndex
CREATE INDEX "bi_snapshots_firmId_clientId_dashboardId_idx" ON "bi_snapshots"("firmId", "clientId", "dashboardId");

-- AddForeignKey
ALTER TABLE "bi_metrics" ADD CONSTRAINT "bi_metrics_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bi_dimensions" ADD CONSTRAINT "bi_dimensions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bi_dashboards" ADD CONSTRAINT "bi_dashboards_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bi_dashboards" ADD CONSTRAINT "bi_dashboards_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bi_widgets" ADD CONSTRAINT "bi_widgets_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bi_widgets" ADD CONSTRAINT "bi_widgets_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "bi_dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bi_widgets" ADD CONSTRAINT "bi_widgets_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "bi_metrics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bi_snapshots" ADD CONSTRAINT "bi_snapshots_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bi_snapshots" ADD CONSTRAINT "bi_snapshots_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "bi_dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Permisos para el rol runtime (ADR-006)
GRANT SELECT, INSERT, UPDATE, DELETE ON bi_metrics, bi_dimensions, bi_dashboards, bi_widgets, bi_snapshots TO contable_runtime;
