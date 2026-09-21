// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { StudyAyuda } from "./StudyAyuda";

describe("ayuda paso a paso", () => {
  afterEach(() => cleanup());

  it("muestra el manual y los capítulos anclados de cada pantalla", () => {
    render(
      <MemoryRouter initialEntries={["/ayuda#bandeja"]}>
        <StudyAyuda />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Manual del estudio" })).toBeTruthy();
    expect(document.getElementById("bandeja")).toBeTruthy();
    expect(document.getElementById("expediente")).toBeTruthy();
    expect(document.getElementById("liquidaciones")).toBeTruthy();
    expect(document.getElementById("configuracion-fiscal")).toBeTruthy();
  });
});
