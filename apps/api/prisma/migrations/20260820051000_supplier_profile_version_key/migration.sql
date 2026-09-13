-- El maestro de proveedores es versionado por cliente y CUIT. La clave
-- evita dos revisiones con el mismo número ante clasificaciones concurrentes.
CREATE UNIQUE INDEX "supplier_tax_profiles_clientId_cuitNormalized_version_key"
  ON "supplier_tax_profiles"("clientId", "cuitNormalized", "version");
