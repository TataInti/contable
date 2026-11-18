// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkBar } from "./WorkBar.js";
import { WorkPage } from "./WorkPage.js";

afterEach(() => cleanup());

const barra = <WorkBar label="Barra de prueba" context={<span>Período</span>} />;

describe("WorkPage", () => {
  it("ubica la barra antes del cuerpo y fuera de él", () => {
    const { container } = render(
      <WorkPage bar={barra}>
        <p>Contenido</p>
      </WorkPage>,
    );
    const raiz = container.querySelector(".work-page") as HTMLElement;
    const [primero, segundo] = Array.from(raiz.children);
    expect(primero).toHaveClass("work-bar");
    expect(segundo).toHaveClass("work-page__body");
    expect(segundo?.contains(primero ?? null)).toBe(false);
  });

  it("pone el contenido en el cuerpo, dentro de su bloque de contenido", () => {
    const { container } = render(
      <WorkPage bar={barra}>
        <p>Contenido</p>
      </WorkPage>,
    );
    expect(container.querySelector(".work-page__body .work-page__content p")).toHaveTextContent(
      "Contenido",
    );
  });

  it("publica el ancho de la barra de desplazamiento del cuerpo para alinear la barra", () => {
    const { container } = render(
      <WorkPage bar={barra}>
        <p>Contenido</p>
      </WorkPage>,
    );
    const raiz = container.querySelector(".work-page") as HTMLElement;
    // En jsdom no hay diseño: la medida vale 0 px.
    expect(raiz.style.getPropertyValue("--work-page-scrollbar")).toBe("0px");
  });

  it("acepta una clase adicional en la raíz", () => {
    const { container } = render(
      <WorkPage bar={barra} className="legajo">
        <p>Contenido</p>
      </WorkPage>,
    );
    expect(container.querySelector(".work-page.legajo")).not.toBeNull();
  });
});
