-- DropForeignKey
ALTER TABLE "evidence_links" DROP CONSTRAINT "evidence_links_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "expense_evidence" DROP CONSTRAINT "expense_evidence_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "fiscal_components" DROP CONSTRAINT "fiscal_components_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "fiscal_voucher_lines" DROP CONSTRAINT "fiscal_voucher_lines_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "fiscal_vouchers" DROP CONSTRAINT "fiscal_vouchers_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "import_batches" DROP CONSTRAINT "import_batches_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "import_rows" DROP CONSTRAINT "import_rows_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "management_expenses" DROP CONSTRAINT "management_expenses_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "payment_allocations" DROP CONSTRAINT "payment_allocations_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "perception_certificates" DROP CONSTRAINT "perception_certificates_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "settlement_inputs" DROP CONSTRAINT "settlement_inputs_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "tax_adjustments" DROP CONSTRAINT "tax_adjustments_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "tax_credit_allocations" DROP CONSTRAINT "tax_credit_allocations_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "tax_credit_ledger_entries" DROP CONSTRAINT "tax_credit_ledger_entries_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "tax_differences" DROP CONSTRAINT "tax_differences_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "tax_export_artifacts" DROP CONSTRAINT "tax_export_artifacts_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "tax_filings" DROP CONSTRAINT "tax_filings_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "tax_payments" DROP CONSTRAINT "tax_payments_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "tax_settlement_lines" DROP CONSTRAINT "tax_settlement_lines_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "tax_settlements" DROP CONSTRAINT "tax_settlements_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "tax_treatment_decisions" DROP CONSTRAINT "tax_treatment_decisions_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "withholding_certificates" DROP CONSTRAINT "withholding_certificates_tenant_client_fk";

-- AlterTable
ALTER TABLE "upload_sessions" ADD COLUMN     "requestItemId" TEXT;

