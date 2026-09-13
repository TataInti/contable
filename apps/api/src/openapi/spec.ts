import { z } from "zod";
import * as contracts from "@contable/contracts";

/**
 * F2.3: generador de OpenAPI 3.1 desde los schemas Zod de @contable/contracts.
 *
 * Produce un documento OpenAPI 3.1 con los paths de la API fiscal y sus
 * schemas derivados de los contratos Zod. La CI verifica que este documento
 * no tenga drift contra las rutas Fastify registradas (ver openapi-drift.test.ts).
 *
 * Documenta la superficie fiscal y de portal que forma parte del piloto. Las
 * rutas legacy fuera de ese recorrido quedan fuera deliberadamente.
 */

export interface OpenApiSpec {
  openapi: "3.1.0";
  info: { title: string; version: string };
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
}

/** Convierte un schema Zod a un schema JSON Schema (OpenAPI 3.1). */
function zodToJsonSchema(schema: z.ZodType): unknown {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodType>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodNullable)) {
        required.push(key);
      }
    }
    return { type: "object", properties, ...(required.length ? { required } : {}) };
  }
  if (schema instanceof z.ZodArray) {
    return { type: "array", items: zodToJsonSchema(schema.element) };
  }
  if (schema instanceof z.ZodEnum) {
    return { type: "string", enum: schema.options };
  }
  if (schema instanceof z.ZodString) return { type: "string" };
  if (schema instanceof z.ZodNumber) return { type: "number" };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodNullable) {
    const inner = zodToJsonSchema(schema.unwrap());
    return { ...(typeof inner === "object" && inner ? inner : {}), nullable: true };
  }
  if (schema instanceof z.ZodOptional) {
    return zodToJsonSchema(schema.unwrap());
  }
  if (schema instanceof z.ZodEffects) {
    return zodToJsonSchema(schema.innerType());
  }
  if (schema instanceof z.ZodDefault) {
    // ZodDefault no expone su inner type públicamente; documenta como genérico.
    return {};
  }
  return {};
}

/** Registra los paths fiscales documentados con sus contratos. */
export function fiscalPaths(): OpenApiPath[] {
  return [
    {
      method: "get",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/tax-settlements",
      summary: "Lista liquidaciones fiscales con filtros paginados de período/cutoff",
      capability: "tax.settlements.read",
    },
    {
      method: "post",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/tax-settlements/calculate",
      summary: "Calcula una liquidación fiscal",
      capability: "tax.settlements.calculate",
      idempotent: true,
      versioned: true,
    },
    {
      method: "get",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/tax-credit-ledger",
      summary: "Libro de créditos fiscales (solo lectura)",
      capability: "tax.settlements.read",
    },
    {
      method: "post",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/tax-credit-ledger/opening",
      summary: "Registra un saldo inicial (nace PENDING_VERIFICATION)",
      capability: "tax.settlements.calculate",
    },
    {
      method: "post",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/tax-credit-ledger/{lotId}/verify",
      summary: "Verifica un saldo anterior (maker-checker + evidencia)",
      capability: "tax.settlements.review",
    },
    {
      method: "post",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/tax-credit-ledger/{lotId}/movements",
      summary: "Registra uso/compensación como movimiento inmutable",
      capability: "tax.settlements.calculate",
    },
    {
      method: "post",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/tax-credit-ledger/{lotId}/corrections",
      summary: "Corrección de monto vía movimiento compensatorio",
      capability: "tax.settlements.calculate",
    },
    {
      method: "post",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/document-requests/{requestId}/send",
      summary: "Envía un pedido documental (DRAFT → SENT)",
      capability: "request.manage",
    },
    {
      method: "post",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/document-requests/{requestId}/cancel",
      summary: "Cancela un pedido documental abierto",
      capability: "request.manage",
    },
    {
      method: "post",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/document-requests/{requestId}/items/{itemId}/accept",
      summary: "Acepta un ítem del pedido",
      capability: "request.manage",
    },
    {
      method: "post",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/document-requests/{requestId}/items/{itemId}/reject",
      summary: "Rechaza un ítem conservando evidencia y motivo",
      capability: "request.manage",
    },
    {
      method: "post",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/document-requests/{requestId}/items/{itemId}/waive",
      summary: "Exime un ítem del pedido",
      capability: "request.manage",
    },
    {
      method: "get",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/management-incomes",
      summary: "Lista ingresos gerenciales (§7.1)",
      capability: "tax.management_expenses.read",
    },
    {
      method: "post",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/management-incomes",
      summary: "Alta de ingreso gerencial en DRAFT",
      capability: "tax.management_expenses.write",
    },
    {
      method: "post",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/management-incomes/{incomeId}/approve",
      summary: "Aprueba un ingreso gerencial (maker-checker)",
      capability: "tax.management_expenses.approve_treatment",
    },
    {
      method: "post",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/management-incomes/{incomeId}/submit-review",
      summary: "Envía un ingreso gerencial a revisión",
      capability: "tax.management_expenses.write",
    },
    {
      method: "post",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/management-incomes/{incomeId}/reject",
      summary: "Rechaza un ingreso gerencial con comentario obligatorio",
      capability: "tax.management_expenses.approve_treatment",
    },
    {
      method: "get",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/profitability",
      summary: "Snapshots de rentabilidad",
      capability: "profitability.read",
    },
    {
      method: "post",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/profitability/calculate",
      summary: "Calcula un snapshot de rentabilidad",
      capability: "profitability.calculate",
      idempotent: true,
      versioned: true,
    },
    {
      method: "post",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/profitability/publish",
      summary: "Publica un snapshot de rentabilidad",
      capability: "profitability.publish",
      versioned: true,
    },
    {
      method: "post",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/monthly-tax-workpapers",
      summary: "Crea o recupera un expediente mensual",
      capability: "tax.settlements.calculate",
      idempotent: true,
      versioned: true,
    },
    {
      method: "get",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/monthly-tax-workpapers",
      summary: "Expedientes mensuales de liquidación",
      capability: "tax.settlements.read",
    },
    {
      method: "post",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/monthly-tax-workpapers/{workpaperId}/calculate",
      summary: "Calcula el expediente mensual",
      capability: "tax.settlements.calculate",
      idempotent: true,
      versioned: true,
    },
    {
      method: "post",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/monthly-tax-workpapers/{workpaperId}/submit-review",
      summary: "Envía el expediente mensual a revisión",
      capability: "tax.settlements.submit_review",
    },
    {
      method: "post",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/monthly-tax-workpapers/{workpaperId}/review",
      summary: "Revisa el expediente mensual",
      capability: "tax.settlements.review",
    },
    {
      method: "post",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/monthly-tax-workpapers/{workpaperId}/finalize",
      summary: "Finaliza el expediente mensual",
      capability: "tax.settlements.finalize",
      versioned: true,
    },
    {
      method: "post",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/monthly-tax-workpapers/{workpaperId}/rectify",
      summary: "Crea una rectificativa del expediente mensual",
      capability: "tax.settlements.rectify",
      versioned: true,
    },
    {
      method: "get",
      path: "/api/v1/portal/clients/{clientId}/tax-settlements",
      summary: "Lista liquidaciones fiscales finalizadas del portal",
      capability: "portal.results.read",
    },
    {
      method: "get",
      path: "/api/v1/portal/clients/{clientId}/profitability",
      summary: "Lista snapshots de rentabilidad publicados",
      capability: "portal.results.read",
    },
    {
      method: "get",
      path: "/api/v1/portal/clients/{clientId}/profitability/{snapshotId}/receipt",
      summary: "Consulta el recibo de una publicación",
      capability: "portal.results.read",
    },
  ];
}

interface OpenApiPath {
  method: "get" | "post" | "patch" | "put" | "delete";
  path: string;
  summary: string;
  capability: string;
  idempotent?: boolean;
  versioned?: boolean;
}

interface OpenApiPath {
  method: "get" | "post" | "patch" | "put" | "delete";
  path: string;
  summary: string;
  capability: string;
  idempotent?: boolean;
  versioned?: boolean;
}

/** Genera el documento OpenAPI 3.1 completo. */
export function buildOpenApiSpec(): OpenApiSpec {
  const paths: OpenApiSpec["paths"] = {};
  const schemas: OpenApiSpec["components"]["schemas"] = {};

  // Schemas de contratos exportados (los que son ZodObject).
  for (const [name, value] of Object.entries(contracts)) {
    if (value instanceof z.ZodObject) {
      schemas[name] = zodToJsonSchema(value);
    }
  }

  for (const p of fiscalPaths()) {
    const operation: Record<string, unknown> = {
      summary: p.summary,
      operationId: `${p.method}_${p.path.replace(/[^a-zA-Z0-9]/g, "_")}`,
      security: [{ bearerAuth: [] }],
      "x-capability": p.capability,
      responses: {
        "200": { description: "OK" },
        "401": { description: "No autenticado" },
        "403": { description: "Sin capability" },
      },
    };
    if (p.idempotent) operation["x-idempotent"] = true;
    if (p.versioned) operation["x-versioned"] = true;
    paths[p.path] = { [p.method]: operation };
  }

  return {
    openapi: "3.1.0",
    info: { title: "Contable API", version: "0.1.0" },
    paths,
    components: {
      schemas,
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    },
  };
}

export const openApiSpec = buildOpenApiSpec();
