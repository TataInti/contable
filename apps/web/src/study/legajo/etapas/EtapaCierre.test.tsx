// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
  it("presenta los cuatro pasos y mantiene el detalle técnico plegado", () => {
    render(<EtapaCierre wp={wp} />);
    expect(screen.getByText("Paso 1 · Finalizar")).toBeInTheDocument();
    expect(screen.getByText("Paso 2 · Registrar presentación y acuse")).toBeInTheDocument();
    expect(screen.getByText("Paso 3 · Cargar la declaración jurada")).toBeInTheDocument();
    expect(screen.getByText("Paso 4 · Pago (opcional)")).toBeInTheDocument();
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
});
