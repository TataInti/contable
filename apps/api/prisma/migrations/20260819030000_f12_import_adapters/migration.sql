-- ============================================================
-- F1.2: Registro de adaptadores de importación (PLAN §5.6.2)
--
-- El origen de cada lote se fija antes del upload y no puede cambiar
-- después de la validación. `originCode` no es una cadena libre para
-- decisiones de negocio; se valida contra este registro.
-- ============================================================

-- CreateTable
CREATE TABLE "import_adapters" (
    "id" TEXT NOT NULL,
    "taxTypeId" TEXT NOT NULL,
    "originCode" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "sourceSchemaVersion" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "taxScope" TEXT NOT NULL,
    "fileFormat" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_adapters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "import_adapters_originCode_sourceSchemaVersion_key" ON "import_adapters"("originCode", "sourceSchemaVersion");

-- AddForeignKey
ALTER TABLE "import_adapters" ADD CONSTRAINT "import_adapters_taxTypeId_fkey" FOREIGN KEY ("taxTypeId") REFERENCES "tax_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grants para contable_runtime: CRUD.
GRANT SELECT, INSERT, UPDATE, DELETE ON import_adapters TO contable_runtime;