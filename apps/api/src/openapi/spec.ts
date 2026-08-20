import { z } from "zod";
import * as contracts from "@contable/contracts";

/**
 * F2.3: generador de OpenAPI 3.1 desde los schemas Zod de @contable/contracts.
 *
 * Produce un documento OpenAPI 3.1 con los paths de la API fiscal y sus
 * schemas derivados de los contratos Zod. La CI verifica que este documento
 * no tenga drift contra las rutas Fastify registradas (ver openapi-drift.test.ts).
 *
 * No pretende cubrir todas las rutas del sistema: documenta las rutas fiscales
 * críticas (las que tienen contratos Zod) y sirve de base para ampliar.
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
      method: "get",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/profitability",
      summary: "Snapshots de rentabilidad",
      capability: "profitability.read",
    },
    {
      method: "get",
      path: "/api/v1/firms/{firmId}/clients/{clientId}/monthly-tax-workpapers",
      summary: "Expedientes mensuales de liquidación",
      capability: "tax.settlements.read",
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