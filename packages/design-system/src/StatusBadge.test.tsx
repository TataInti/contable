// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { getStatusBadgeMeta, StatusBadge } from "./StatusBadge.js";

afterEach(() => cleanup());

const toneSamples = [
  ["ACTIVE", "Activo", "ok"],
  ["PENDING", "Pendiente", "warn"],
  ["FAILED", "Fallido", "danger"],
  ["IN_PROGRESS", "En proceso", "info"],
  ["ARCHIVED", "Archivado", "muted"],
] as const;

const normalClosureStatuses = [
  ["CANCELED", "Cancelado"],
  ["CANCELLED", "Cancelado"],
  ["DISABLED", "Deshabilitado"],
  ["HARD_CLOSED", "Período cerrado"],
  ["ARCHIVED", "Archivado"],
  ["INACTIVE", "Inactivo"],
  ["CLOSED", "Cerrado"],
  ["FINALIZED", "Finalizado"],
] as const;

describe("StatusBadge", () => {
  it.each(toneSamples)("shows a decorative dot and text for %s (%s / %s)", (status, label, tone) => {
    render(<StatusBadge status={status} />);

    const badge = screen.getByText(label).closest(".status-badge");
    expect(badge).toHaveClass("status-badge", `status-badge--${tone}`, "status-badge--plain");
    expect(badge).not.toHaveClass("status-badge--pill");
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(badge?.querySelector(".status-badge__dot")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders the pill variant with the same accessible text and decorative dot", () => {
    render(<StatusBadge status="ACTIVE" variant="pill" />);

    const badge = screen.getByText("Activo").closest(".status-badge");
    expect(badge).toHaveClass("status-badge--pill", "status-badge--ok");
    expect(screen.getByText("Activo")).toBeInTheDocument();
    expect(badge?.querySelector(".status-badge__dot")).toHaveAttribute("aria-hidden", "true");
  });

  it.each(normalClosureStatuses)("uses the neutral tone for normal closure %s", (status, label) => {
    expect(getStatusBadgeMeta(status)).toEqual({ label, tone: "muted" });
  });
});
