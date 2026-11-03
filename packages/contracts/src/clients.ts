import { z } from "zod";
import { cuit, isoDate, uuid } from "./primitives.js";
import { functionalCurrency } from "./catalogs.js";

/** Creación de cliente */
export const createClientSchema = z
  .object({
    legalName: z.string().min(1).max(200),
    tradeName: z.string().max(100).optional(),
    cuit: cuit,
    province: z.string().max(100).optional(),
    activity: z.string().max(200).optional(),
    legalForm: z.string().max(100).optional(),
  })
  .strict();
export type CreateClient = z.infer<typeof createClientSchema>;

/** Actualización de cliente */
export const updateClientSchema = createClientSchema.partial();
export type UpdateClient = z.infer<typeof updateClientSchema>;

/** Perfil contable/fiscal del cliente */
export const clientProfileSchema = z
  .object({
    // Moneda funcional: limitada al catálogo respaldado (contracts/catalogs.ts).
    // No se asume que 3 letras = ISO 4217; valores fuera del catálogo se rechazan.
    functionalCurrency: functionalCurrency.default("ARS"),
    accountingStandard: z.string().max(100).optional(),
    fiscalYearEndMonth: z.number().int().min(1).max(12).default(12),
    vatCondition: z.string().max(100).optional(),
    iibbJurisdictions: z.array(z.string()).default([]),
    province: z.string().max(100).optional(),
    activity: z.string().max(200).optional(),
    legalForm: z.string().max(100).optional(),
    serviceStartDate: isoDate.optional(),
  })
  .strict();
export type ClientProfile = z.infer<typeof clientProfileSchema>;

/** Creación de cuenta */
export const createAccountSchema = z
  .object({
    code: z.string().min(1).max(20),
    name: z.string().min(1).max(200),
    type: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE", "MEMO"]),
    normalBalance: z.enum(["DEBIT", "CREDIT"]),
    parentId: uuid.optional(),
    isPostable: z.boolean().default(true),
    currencyBehavior: z.enum(["FUNCTIONAL_ONLY", "ORIGINAL_AND_FUNCTIONAL"]).default("FUNCTIONAL_ONLY"),
    monetaryClassification: z
      .enum(["MONETARY", "NON_MONETARY", "NOT_APPLICABLE"])
      .default("NOT_APPLICABLE"),
    vatRole: z
      .enum(["NONE", "INPUT_VAT", "OUTPUT_VAT", "WITHHOLDING", "PERCEPTION"])
      .default("NONE"),
  })
  .strict();
export type CreateAccount = z.infer<typeof createAccountSchema>;

/** Creación de contraparte */
export const createCounterpartySchema = z
  .object({
    cuit: cuit,
    legalName: z.string().min(1).max(200),
    tradeName: z.string().max(100).optional(),
    taxCondition: z.string().max(100).optional(),
    address: z.string().max(200).optional(),
    country: z.string().length(2).default("AR"),
    aliases: z.array(z.string()).default([]),
  })
  .strict();
export type CreateCounterparty = z.infer<typeof createCounterpartySchema>;

/** Creación de centro de costo */
export const createCostCenterSchema = z
  .object({
    code: z.string().min(1).max(20),
    name: z.string().min(1).max(200),
  })
  .strict();
export type CreateCostCenter = z.infer<typeof createCostCenterSchema>;

/** Creación de ejercicio fiscal */
export const createFiscalYearSchema = z
  .object({
    startDate: isoDate,
    endDate: isoDate,
    label: z.string().min(1).max(100),
  })
  .strict();
export type CreateFiscalYear = z.infer<typeof createFiscalYearSchema>;

/** Creación de período contable */
export const createPeriodSchema = z
  .object({
    startDate: isoDate,
    endDate: isoDate,
    ordinal: z.number().int().positive(),
  })
  .strict();
export type CreatePeriod = z.infer<typeof createPeriodSchema>;

/** Creación de sesión de upload de documento (G2-07: requestItemId obligatorio) */
export const createUploadSessionSchema = z
  .object({
    expectedMime: z.string().optional(),
    maxFiles: z.number().int().positive().max(10).optional(),
    // G2-07: el ítem de pedido al que responde el documento. Obligatorio para
    // que cada archivo quede ligado al ítem correcto del pedido documental.
    requestItemId: z.string().uuid(),
  })
  .strict();
export type CreateUploadSession = z.infer<typeof createUploadSessionSchema>;