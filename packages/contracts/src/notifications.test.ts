import { describe, expect, it } from "vitest";
import {
  DUE_ALERT_NOTIFICATION_TYPES,
  notificationArchiveResponseSchema,
  notificationItemSchema,
  notificationListQuerySchema,
  notificationListResponseSchema,
  notificationReadResponseSchema,
  notificationUnreadCountResponseSchema,
} from "./notifications.js";

const item = {
  id: "0190f0a0-0000-7000-8000-000000000001",
  type: "DUE_ALERT",
  severity: "WARNING",
  title: "Vence en 2 días hábiles (sintético)",
  body: null,
  firmId: "0190f0a0-0000-7000-8000-0000000000f1",
  firmName: "Estudio sintético 3C",
  clientId: "0190f0a0-0000-7000-8000-0000000000c1",
  clientName: "Cliente sintético 3C uno",
  obligationId: "0190f0a0-0000-7000-8000-0000000000b1",
  dueDate: "2026-11-20",
  createdAt: "2026-11-18T12:00:00.000Z",
  readAt: null,
};

describe("contratos de avisos propios (corte 3c)", () => {
  it("el listado usa límite 20 y desplazamiento 0 por defecto", () => {
    expect(notificationListQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
  });

  it("acepta límites de 1 a 50 y convierte los textos de la URL", () => {
    expect(notificationListQuerySchema.parse({ limit: "50", offset: "20" })).toEqual({ limit: 50, offset: 20 });
    expect(notificationListQuerySchema.parse({ limit: "1" }).limit).toBe(1);
  });

  it("rechaza un límite fuera de rango e indica el campo", () => {
    for (const limit of ["0", "51", "2.5", "abc"]) {
      const parsed = notificationListQuerySchema.safeParse({ limit });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toMatch(/^limit: /);
    }
  });

  it("rechaza un desplazamiento negativo e indica el campo", () => {
    const parsed = notificationListQuerySchema.safeParse({ offset: "-1" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toMatch(/^offset: /);
  });

  it("solo los avisos de vencimiento se listan y cuentan", () => {
    expect(DUE_ALERT_NOTIFICATION_TYPES).toEqual(["DUE_ALERT", "DUE_OVERDUE"]);
  });

  it("el aviso tiene la forma acordada y acepta cuerpo y cliente nulos", () => {
    expect(notificationItemSchema.parse(item)).toEqual(item);
    expect(notificationItemSchema.safeParse({ ...item, type: "OTRO" }).success).toBe(false);
    expect(notificationItemSchema.safeParse({ ...item, createdAt: "18/11/2026" }).success).toBe(false);
  });

  it("las respuestas siguen las formas {data, meta} y {data: {count}}", () => {
    const list = notificationListResponseSchema.parse({
      data: [item],
      meta: { limit: 20, offset: 0, total: 1 },
    });
    expect(list.meta.total).toBe(1);
    expect(notificationListResponseSchema.safeParse({ data: [] }).success).toBe(false);
    expect(notificationUnreadCountResponseSchema.parse({ data: { count: 0 } })).toEqual({ data: { count: 0 } });
    expect(notificationUnreadCountResponseSchema.safeParse({ data: { count: -1 } }).success).toBe(false);
    const readAt = "2026-11-18T12:05:00.000Z";
    expect(notificationReadResponseSchema.parse({ data: { id: item.id, readAt } })).toEqual({
      data: { id: item.id, readAt },
    });
    const archivedAt = "2026-11-18T12:06:00.000Z";
    expect(notificationArchiveResponseSchema.parse({ data: { id: item.id, archivedAt } })).toEqual({
      data: { id: item.id, archivedAt },
    });
  });
});
