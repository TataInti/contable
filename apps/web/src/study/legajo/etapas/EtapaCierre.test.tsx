// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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

afterEach(cleanup);

describe("Etapa Cierre guiada", () => {
  it("presenta los cuatro pasos y mantiene el detalle técnico plegado", () => {
    render(<EtapaCierre wp={wp} />);
    expect(screen.getByText("Finalizar", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("Registrar presentación y acuse")).toBeInTheDocument();
    expect(screen.getByText("Cargar la declaración jurada")).toBeInTheDocument();
    expect(screen.getByText("Pago (opcional)")).toBeInTheDocument();
    expect(screen.getByText("Saldo para el mes siguiente")).toBeInTheDocument();
    expect(screen.getByText("Detalle técnico")).toBeInTheDocument();
    expect(screen.queryByText("hash-in-demo")).not.toBeVisible();
  });

  it("muestra el estado de presentación, declaración y pago y explica los permisos", () => {
    render(<EtapaCierre
      wp={{ ...wp, status: "FINALIZED" }}
      hasFiling
      hasDeclaration
      hasPayment
      canFile={false}
      canDeclare={false}
      canPay={false}
    />);
    expect(screen.getAllByText("Hecho")).toHaveLength(4);
    expect(screen.getByText("Tu perfil no tiene permiso para registrar la presentación.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar presentación y acuse" })).toBeDisabled();
    expect(screen.getByText("Tu perfil no tiene permiso para cargar la declaración jurada.")).toBeInTheDocument();
    expect(screen.getByText("Tu perfil no tiene permiso para registrar el pago.")).toBeInTheDocument();
  });

  it("resume «Total determinado · Pagado · Saldo» y da formato de importe al saldo siguiente", () => {
    const posicion = (accrued: string, paid: string, totalPayable: string) => ({
      obligationId: "ob", status: "PAID", dueDate: null,
      regime: { id: "r", name: "R", isActive: true, taxType: { id: "t", name: "IIBB", isActive: true }, jurisdiction: { id: "j", name: "Tucumán", isActive: true } },
      settlement: null, accrued, paid, pending: "0.0000", availableCredit: "0.0000", interest: "0.0000", totalPayable,
    });
    render(<EtapaCierre
      wp={{ ...wp, status: "FINALIZED" }}
      positions={[posicion("9679.4500", "9679.4500", "0.0000"), posicion("10028.0000", "10028.0000", "0.0000")]}
      hasFiling
      hasDeclaration
      hasPayment
      paymentNotRequired
      nextBalance="0.0000"
    />);
    const resumen = screen.getByText(/Total determinado/).textContent ?? "";
    expect(resumen.replace(/\u00a0/g, " ")).toContain("Total determinado $ 19.707,45 · Pagado $ 19.707,45 · Saldo $ 0,00");
    expect(resumen).not.toContain("Total a ingresar");
    expect(screen.getByText(/Pagado: \$\s19\.707,45/)).toBeInTheDocument();
    expect(screen.getByText(/\$\s0,00 · pasa a/)).toBeInTheDocument();
    expect(screen.queryByText(/0\.0000/)).not.toBeInTheDocument();
  });
});
