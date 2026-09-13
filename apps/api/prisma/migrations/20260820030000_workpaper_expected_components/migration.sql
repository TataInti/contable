-- El expediente mensual materializa sus componentes esperados desde las
-- obligaciones aun antes de que exista una liquidación calculada. El vínculo
-- conserva obligationId como identidad estable y settlementId se completa al
-- orquestar el cálculo.
ALTER TABLE "workpaper_settlements"
  ALTER COLUMN "settlementId" DROP NOT NULL;
