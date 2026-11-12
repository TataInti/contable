import { z } from "zod";

export const firmRoleSchema = z.enum([
  "OWNER",
  "ADMIN",
  "PREPARER",
  "REVIEWER",
  "AUDITOR_READONLY",
]);

export const portalRoleSchema = z.enum(["OWNER", "COLLABORATOR", "READONLY"]);

export const memberIdentityPatchSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()).optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "Indicá al menos un campo para actualizar la identidad",
  });
export type MemberIdentityPatch = z.infer<typeof memberIdentityPatchSchema>;

export const firmProfilePatchSchema = z
  .object({
    legalName: z.string().trim().min(1).max(200).optional(),
    displayName: z.string().trim().min(1).max(100).optional(),
    taxId: z.string().trim().max(20).nullable().optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "Indicá al menos un campo para actualizar la firma",
  });
export type FirmProfilePatch = z.infer<typeof firmProfilePatchSchema>;

export const internalMemberRolePatchSchema = z.object({ role: firmRoleSchema }).strict();
export type InternalMemberRolePatch = z.infer<typeof internalMemberRolePatchSchema>;

export const internalMemberStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"]),
}).strict();
export type InternalMemberStatus = z.infer<typeof internalMemberStatusSchema>;

export const portalMembershipPatchSchema = z
  .object({
    role: portalRoleSchema.optional(),
    status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  })
  .strict()
  .refine((value) => value.role !== undefined || value.status !== undefined, {
    message: "Indicá el rol o el estado para actualizar el acceso del portal",
  });
export type PortalMembershipPatch = z.infer<typeof portalMembershipPatchSchema>;
