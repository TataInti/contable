// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api";
import { FieldErrorsFromDetails } from "./FieldErrorsFromDetails";

afterEach(cleanup);

describe("FieldErrorsFromDetails", () => {
  it("traduce el campo de vigencia y el mensaje de fecha inválida", () => {
    const error = new ApiError("VALIDATION_ERROR", "La solicitud contiene datos inválidos", 400, null, {
      code: "VALIDATION_ERROR",
      details: [{ path: ["validFrom"], message: "Invalid date" }],
    });

    render(<FieldErrorsFromDetails error={error} />);

    expect(screen.getByRole("alert").textContent).toContain("Vigencia desde: Fecha inválida");
  });

  it("muestra el mensaje general cuando el detalle no tiene un campo", () => {
    const error = new ApiError("VALIDATION_ERROR", "La fecha no es válida", 400, null, {
      code: "VALIDATION_ERROR",
      details: [{ path: [], message: "La fecha no es válida" }],
    });

    render(<FieldErrorsFromDetails error={error} />);

    expect(screen.getByRole("alert").textContent).toBe("La fecha no es válida");
  });
});
