// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UseMutationResult } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GrupoPerfilControl, type GrupoPerfilVariables } from "./GrupoPerfilControl";
import type { Workpaper } from "../tipos";

// Corte 4B: un grupo de comprobantes que no corresponden al perfil se resuelve por grupo, con motivo.
const wp = { id: "wp-1" } as unknown as Workpaper;
const control = {
  id: "ctl-1",
  code: "PERFIL_COMPROBANTE:FACTURA_A",
  status: "OPEN",
  severity: "BLOCKING",
  actual: "3",
  expected: null,
  tolerance: null,
  resolution: null,
  message: null,
} as unknown as Workpaper["controls"][number];

function mutacion(overrides: Partial<UseMutationResult<unknown, Error, GrupoPerfilVariables>> = {}) {
  return {
    mutate: vi.fn(),
    isPending: false,
    variables: undefined,
    error: null,
    ...overrides,
  } as unknown as UseMutationResult<unknown, Error, GrupoPerfilVariables>;
}

function montar(props: { puedeResolver?: boolean; mutation?: UseMutationResult<unknown, Error, GrupoPerfilVariables> }) {
  return render(
    <MemoryRouter>
      <GrupoPerfilControl wp={wp} control={control} puedeResolver={props.puedeResolver ?? true} mutation={props.mutation} />
    </MemoryRouter>,
  );
}

afterEach(() => cleanup());

describe("GrupoPerfilControl (corte 4B)", () => {
  it("muestra el grupo con su cantidad y dice que bloquea el cierre", () => {
    montar({ mutation: mutacion() });
    expect(screen.getByText("Facturas A: 3 comprobantes")).toBeInTheDocument();
    expect(screen.getByText("Bloquea el cierre")).toBeInTheDocument();
  });

  it("no deja excluir ni aceptar sin motivo, y el botón explica qué falta", () => {
    montar({ mutation: mutacion() });
    expect(screen.getByRole("button", { name: "Excluir del cálculo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Aceptar con motivo" })).toBeDisabled();
    expect(screen.getByText("Falta escribir el motivo.")).toBeInTheDocument();
  });

  it("excluir con motivo envía la acción del grupo con el motivo escrito", () => {
    const mutation = mutacion();
    montar({ mutation });
    fireEvent.change(screen.getByLabelText("Motivo FACTURA_A"), { target: { value: "Carga por error" } });
    fireEvent.click(screen.getByRole("button", { name: "Excluir del cálculo" }));
    expect(mutation.mutate).toHaveBeenCalledWith({
      workpaperId: "wp-1",
      grupo: "FACTURA_A",
      accion: "exclude",
      reason: "Carga por error",
    });
  });

  it("aceptar con motivo envía la acción de aceptar", () => {
    const mutation = mutacion();
    montar({ mutation });
    fireEvent.change(screen.getByLabelText("Motivo FACTURA_A"), { target: { value: "Trabajo puntual" } });
    fireEvent.click(screen.getByRole("button", { name: "Aceptar con motivo" }));
    expect(mutation.mutate).toHaveBeenCalledWith({
      workpaperId: "wp-1",
      grupo: "FACTURA_A",
      accion: "accept",
      reason: "Trabajo puntual",
    });
  });

  it("sin permiso para resolver, muestra el aviso y ninguna acción", () => {
    montar({ puedeResolver: false, mutation: mutacion() });
    expect(screen.getByText("Tu perfil no puede resolver controles de este legajo.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Excluir del cálculo" })).not.toBeInTheDocument();
  });
});
