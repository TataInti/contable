CREATE UNIQUE INDEX "tax_control_findings_workpaperId_code_sourceHash_key"
ON "tax_control_findings"("workpaperId", "code", "sourceHash");
