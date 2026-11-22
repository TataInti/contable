import type { Prisma } from "@prisma/client";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";
import { loadPerfilPermitido, type PermitidoEfectivo } from "./voucher-permissions-core.js";
import { MonthlyWorkpaperService } from "./workpaper-service.js";
import {
  CLASES_COMPROBANTE,
  CLASE_LABELS,
  clasesOfrecidas,
  propuestaPerfil,
  type ClaseComprobante,
  type PermitidoPerfil,
} from "./voucher-profile.js";

type Tx = Prisma.TransactionClient;

export class VoucherPermissionsError extends Error {
  readonly code = "VOUCHER_PERMISSIONS_INVALID";
  readonly httpStatus = 422;
  readonly path: string[];
  constructor(message: string, path: string[]) {
    super(message);
    this.name = "VoucherPermissionsError";
    this.path = path;
  }
}

export interface VoucherPermissionsState extends PermitidoEfectivo {
  year: number;
  allowedClasses: ClaseComprobante[];
  exemptAllowed: boolean;
  offered: ClaseComprobante[];
  labels: Record<ClaseComprobante, string>;
  propuesta: PermitidoPerfil;
  savedAt: string | null;
}

export class VoucherPermissionsService {
  async get(ctx: TenantContext, input: { clientId: string; year: number }): Promise<VoucherPermissionsState> {
    return withTenantContext(ctx, (tx) => this.state(tx, ctx.firmId, input));
  }

  /** Guarda las tildes del año. Reabre los expedientes de ese año para que el control se recalcule. */
  async set(
    ctx: TenantContext,
    input: { clientId: string; year: number; allowedClasses: string[]; exemptAllowed: boolean },
  ): Promise<VoucherPermissionsState> {
    const unknown = input.allowedClasses.filter(
      (clase) => !(CLASES_COMPROBANTE as readonly string[]).includes(clase),
    );
    if (unknown.length > 0) {
      throw new VoucherPermissionsError(
        `No existe el tipo de comprobante «${unknown[0]}». Elegí de la lista.`,
        ["allowedClasses"],
      );
    }
    const allowedClasses = [...new Set(input.allowedClasses)] as ClaseComprobante[];
    return withTenantContext(ctx, async (tx) => {
      await tx.clientVoucherPermission.upsert({
        where: { firmId_clientId_year: { firmId: ctx.firmId, clientId: input.clientId, year: input.year } },
        update: {
          allowedClasses,
          exemptAllowed: input.exemptAllowed,
          updatedByUserId: ctx.userId ?? null,
        },
        create: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          year: input.year,
          allowedClasses,
          exemptAllowed: input.exemptAllowed,
          createdByUserId: ctx.userId ?? null,
          updatedByUserId: ctx.userId ?? null,
        },
      });
      await new MonthlyWorkpaperService().reopenForVoucherPermissions(tx, {
        firmId: ctx.firmId,
        clientId: input.clientId,
        year: input.year,
      });
      return this.state(tx, ctx.firmId, { clientId: input.clientId, year: input.year });
    });
  }

  private async state(
    tx: Tx,
    firmId: string,
    input: { clientId: string; year: number },
  ): Promise<VoucherPermissionsState> {
    const efectivo = await loadPerfilPermitido(tx, { firmId, clientId: input.clientId, year: input.year });
    const saved = await tx.clientVoucherPermission.findUnique({
      where: { firmId_clientId_year: { firmId, clientId: input.clientId, year: input.year } },
      select: { updatedAt: true },
    });
    return {
      ...efectivo,
      year: input.year,
      allowedClasses: [...efectivo.clases],
      exemptAllowed: efectivo.exentos,
      offered: [...clasesOfrecidas(efectivo.condicion)],
      labels: CLASE_LABELS,
      propuesta: propuestaPerfil(efectivo.condicion),
      savedAt: saved?.updatedAt.toISOString() ?? null,
    };
  }
}
