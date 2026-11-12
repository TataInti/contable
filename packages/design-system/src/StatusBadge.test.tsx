// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getStatusBadgeMeta, StatusBadge } from "./StatusBadge.js";

afterEach(() => cleanup());

const statusBadgeCss = readFileSync(
  resolve(process.cwd(), "../../apps/web/src/styles/global.css"),
  "utf8",
);
const designTokensCss = readFileSync(resolve(process.cwd(), "src/tokens.css"), "utf8");

function getColorToken(token: string): string {
  return designTokensCss.match(new RegExp(`${token}:\\s*(#[\\da-fA-F]{6});`))?.[1] ?? "";
}

function luminance(hexColor: string): number {
  const channels = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(hexColor.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
    (left, right) => right - left,
  );
  return (lighter! + 0.05) / (darker! + 0.05);
}

const toneSamples = [
  ["ACTIVE", "Activo", "ok"],
  ["PENDING", "Pendiente", "warn"],
  ["FAILED", "Fallido", "danger"],
  ["IN_PROGRESS", "En proceso", "info"],
  ["ARCHIVED", "Archivado", "muted"],
  ["CONFIGURED", "Configurada", "ok"],
  ["RESOLVED", "Resuelto", "ok"],
  ["WAITING_INPUTS", "Esperando datos", "warn"],
  ["READY_TO_CALCULATE", "Listo para calcular", "info"],
  ["PARTIALLY_PAID", "Pago parcial", "warn"],
  ["CHANGES_REQUESTED", "Cambios solicitados", "warn"],
  ["RETIRED", "Retirado", "muted"],
  ["INFO", "Informativo", "info"],
  ["WARNING", "Aviso", "warn"],
  ["BLOCKING", "Bloqueante", "danger"],
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
  ["RETIRED", "Retirado"],
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

  it("keeps the status tone when a contextual visible label is supplied", () => {
    render(<StatusBadge status="MISSING" label="Faltan 2" className="status-badge--regular" />);

    const badge = screen.getByText("Faltan 2").closest(".status-badge");
    expect(badge).toHaveAttribute("data-status", "MISSING");
    expect(badge).toHaveClass("status-badge--warn", "status-badge--regular");
  });

  it("uses an 8px spacing-token dot centered with the badge text", () => {
    const badgeRule = statusBadgeCss.match(/\.status-badge\s*\{([^}]*)\}/)?.[1] ?? "";
    const dotRule = statusBadgeCss.match(/\.status-badge__dot,[\s\S]*?\{([^}]*)\}/)?.[1] ?? "";

    expect(badgeRule).toMatch(/align-items:\s*center;/);
    expect(dotRule).toContain("inline-size: var(--ds-space-2);");
    expect(dotRule).toContain("block-size: var(--ds-space-2);");
    expect(dotRule).toContain("flex: 0 0 var(--ds-space-2);");
    expect(designTokensCss).toMatch(/--ds-space-2:\s*8px;/);
  });

  it("keeps badge text above AA contrast on a selected row", () => {
    const badgeRule = statusBadgeCss.match(/\.status-badge\s*\{([^}]*)\}/)?.[1] ?? "";
    const textColor = getColorToken("--ds-color-text");
    const selectedColor = getColorToken("--ds-color-selected");

    expect(badgeRule).toContain("color: var(--ds-color-text);");
    expect(textColor).toMatch(/^#[\da-fA-F]{6}$/);
    expect(selectedColor).toMatch(/^#[\da-fA-F]{6}$/);
    expect(contrastRatio(textColor, selectedColor)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(normalClosureStatuses)("uses the neutral tone for normal closure %s", (status, label) => {
    expect(getStatusBadgeMeta(status)).toEqual({ label, tone: "muted" });
  });
});
