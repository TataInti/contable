// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EtapaCierre } from "./EtapaCierre";

const wp = {
  id: "wp-demo",
  preparedByUserId: "user-demo",
  reviewedByUserId: "user-demo",
  finalizedByUserId: null,
  periodStart: "2026-10-01T00:00:00.000Z",
  periodEnd: "2026-10-31T00:00:00.000Z",
  revision: 1,
  status: "REVIEWED",
  inputHash: "hash-in-demo",
  outputHash: "hash-out-demo",
  settlements: [],
  controls: [],
};

describe("Etapa Cierre guiada", () => {
  afterEach(() => cleanup());

  it("presenta los cuatro pasos y mantiene el detalle técnico plegado", () => {
    render(<EtapaCierre wp={wp} />);
    expect(screen.getByText("Finalizar", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("Presentación y acuse")).toBeInTheDocument();
    expect(screen.getByText("Declaración jurada")).toBeInTheDocument();
    expect(screen.getByText("Pago (opcional)")).toBeInTheDocument();
    expect(screen.getByText("Saldo para el mes siguiente")).toBeInTheDocument();
    expect(screen.getByText("Detalle técnico")).toBeInTheDocument();
    expect(screen.queryByText("hash-in-demo")).not.toBeVisible();
  });

  const position = (obligationId: string, nombre: string, extra: object = {}) => ({
    obligationId,
    status: "READY_TO_FILE",
    dueDate: null,
    regime: {
      id: `regimen-${obligationId}`,
      name: "Régimen Demo",
      isActive: true,
      taxType: { id: `tipo-${obligationId}`, name: nombre, isActive: true },
      jurisdiction: { id: "jur-demo", name: "Tucumán", isActive: true },
    },
    settlement: { id: `liq-${obligationId}`, status: "FINALIZED", version: 1, totals: {} },
    accrued: "1000.00",
    paid: "0.00",
    pending: "1000.00",
    availableCredit: "0.00",
    interest: "0.00",
    totalPayable: "1000.00",
    ...extra,
  });

  it("muestra el estado de cada paso y de cada impuesto, con un cajón por impuesto", () => {
    const abrir = vi.fn();
    render(<EtapaCierre
      wp={{ ...wp, status: "FINALIZED" }}
      positions={[
        position("iibb", "Ingresos Brutos", { filingId: "f1", hasDeclaration: true, paid: "1000.00", totalPayable: "0.00" }),
        position("tem", "TEM"),
      ]}
      hasFiling={false}
      canFile
      canDeclare
      canPay
      onOpenTax={abrir}
    />);
    const completo = screen.getByRole("list", { name: "Estado de Ingresos Brutos" });
    expect(within(completo).getByText("Hecha")).toBeInTheDocument();
    expect(within(completo).getByText("Cargada")).toBeInTheDocument();
    expect(within(completo).getByText("Pagado")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Estado de TEM" })).getAllByText("Pendiente")).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: /^(Completar|Ver o corregir) / })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Completar TEM" }));
    expect(abrir).toHaveBeenCalledWith("tem");
    expect(screen.getByRole("button", { name: "Ver o corregir Ingresos Brutos" })).toBeInTheDocument();
  });

  it("sin permisos explica por qué no hay cajón y en solo lectura no ofrece nada", () => {
    const { rerender } = render(<EtapaCierre
      wp={{ ...wp, status: "FINALIZED" }}
      positions={[position("iibb", "Ingresos Brutos")]}
      canFile={false}
      canDeclare={false}
      canPay={false}
    />);
    expect(screen.getByText("Tu perfil no tiene permiso para registrar presentaciones ni pagos.")).toBeInTheDocument();
    rerender(<EtapaCierre wp={{ ...wp, status: "FINALIZED" }} positions={[position("iibb", "Ingresos Brutos")]} canFile canPay readOnly />);
    expect(screen.queryByRole("button", { name: /^(Completar|Ver o corregir) / })).toBeNull();
  });

  it("antes de finalizar no ofrece cajones", () => {
    render(<EtapaCierre wp={wp} positions={[position("iibb", "Ingresos Brutos")]} canFile canPay />);
    expect(screen.queryByRole("list", { name: "Estado de Ingresos Brutos" })).toBeNull();
    expect(screen.getByText("Falta finalizar la liquidación.")).toBeInTheDocument();
  });
});
