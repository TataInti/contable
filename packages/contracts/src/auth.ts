import { z } from "zod";
import { uuid } from "./primitives.js";

/** Login con email + password */
export const loginSchema = z
  .object({
    email: z.string().email().transform((v) => v.toLowerCase()),
    password: z.string().min(8).max(200),
  })
  .strict();
export type Login = z.infer<typeof loginSchema>;

/** Respuesta de login (requiere MFA si está habilitado) */
export const loginResultSchema = z
  .object({
    status: z.enum(["OK", "MFA_REQUIRED"]),
    accessToken: z.string().optional(),
    mfaSessionToken: z.string().optional(),
  })
  .strict();
export type LoginResult = z.infer<typeof loginResultSchema>;

/** Verificación TOTP */
export const mfaVerifySchema = z
  .object({
    mfaSessionToken: z.string(),
    code: z.string().regex(/^\d{6}$/),
  })
  .strict();
export type MfaVerify = z.infer<typeof mfaVerifySchema>;

/** Refresh token (opaco) */
export const refreshSchema = z
  .object({
    refreshToken: z.string(),
  })
  .strict();
export type Refresh = z.infer<typeof refreshSchema>;

/** Contextos del usuario: estudios, roles y clientes asignados */
export const meContextsSchema = z.object({
  userId: uuid,
  firms: z.array(
    z.object({
      firmId: uuid,
      firmName: z.string(),
      role: z.enum(["OWNER", "ADMIN", "PREPARER", "REVIEWER", "AUDITOR_READONLY"]),
      capabilities: z.array(z.string()),
      clients: z.array(
        z.object({
          clientId: uuid,
          clientName: z.string(),
          periods: z.array(z.object({ periodId: uuid, label: z.string(), status: z.string() })),
        }),
      ),
    }),
  ),
});
export type MeContexts = z.infer<typeof meContextsSchema>;

/** Invitación a una firma */
export const invitationSchema = z
  .object({
    email: z.string().email().transform((v) => v.toLowerCase()),
    role: z.enum(["OWNER", "ADMIN", "PREPARER", "REVIEWER", "AUDITOR_READONLY"]),
    message: z.string().max(500).optional(),
  })
  .strict();
export type Invitation = z.infer<typeof invitationSchema>;

/** Creación de firma (admin de plataforma) */
export const createFirmSchema = z
  .object({
    legalName: z.string().min(1).max(200),
    displayName: z.string().min(1).max(100),
    taxId: z.string().max(20).optional(),
  })
  .strict();
export type CreateFirm = z.infer<typeof createFirmSchema>;

/** Creación de miembro de firma */
export const createMemberSchema = z
  .object({
    userId: uuid,
    role: z.enum(["OWNER", "ADMIN", "PREPARER", "REVIEWER", "AUDITOR_READONLY"]),
  })
  .strict();
export type CreateMember = z.infer<typeof createMemberSchema>;

/** Asignación de cliente a usuario */
export const createAssignmentSchema = z
  .object({
    userId: uuid,
    clientId: uuid,
    capabilities: z
      .array(
        z.enum([
          "document.upload",
          "document.prepare",
          "document.review",
          "entry.create",
          "entry.review",
          "entry.post",
          "bank.import",
          "bank.reconcile",
          "vat.calculate",
          "vat.review",
          "vat.finalize",
        ]),
      )
      .optional(),
  })
  .strict();
export type CreateAssignment = z.infer<typeof createAssignmentSchema>;
