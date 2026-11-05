import { describe, expect, it } from "vitest";
import { buildClientDeletionOrder } from "./client-deletion-service.js";
import { DeletionError } from "../lib/deletion.js";

describe("buildClientDeletionOrder", () => {
  it("ordena dependencias antes que sus padres y conserva audit_events", () => {
    const order = buildClientDeletionOrder(
      ["documents", "document_file_versions", "audit_events", "orphans"],
      [
        { child: "documents", parent: "clients" },
        { child: "document_file_versions", parent: "documents" },
      ],
    );

    expect(order).not.toContain("audit_events");
    expect(order).toEqual(["orphans", "document_file_versions", "documents"]);
    expect(order.indexOf("document_file_versions")).toBeLessThan(order.indexOf("documents"));
  });

  it("detiene el borrado si el grafo de claves foráneas tiene un ciclo", () => {
    try {
      buildClientDeletionOrder(
        ["clients", "first_child", "second_child"],
        [
          { child: "first_child", parent: "clients" },
          { child: "second_child", parent: "first_child" },
          { child: "first_child", parent: "second_child" },
        ],
      );
      throw new Error("Expected a deletion-plan cycle error");
    } catch (error) {
      expect(error).toBeInstanceOf(DeletionError);
      expect((error as DeletionError).code).toBe("CLIENT_DELETE_PLAN_CYCLE");
    }
  });
});
