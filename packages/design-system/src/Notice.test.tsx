// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./Button.js";
import { Notice, type NoticeTone } from "./Notice.js";

afterEach(() => cleanup());

describe("Notice", () => {
  const tones: NoticeTone[] = ["info", "success", "warning", "error"];

  it.each(tones)("aplica tono %s y el rol anunciado correspondiente", (tone) => {
    const { container } = render(<Notice tone={tone}>Mensaje</Notice>);
    const notice = container.querySelector(".ds-notice");

    expect(notice).toHaveClass(`ds-notice--${tone}`);
    expect(notice).toHaveAttribute("role", tone === "error" ? "alert" : "status");
    if (tone === "error") {
      expect(notice).not.toHaveAttribute("aria-live");
    } else {
      expect(notice).toHaveAttribute("aria-live", "polite");
    }
    expect(notice?.querySelector(".ds-notice__icon")).toHaveAttribute("aria-hidden", "true");
  });

  it("muestra título y acción, conserva el foco en la acción y admite contenido plano", () => {
    render(
      <Notice tone="warning" title="Revisá la consulta" action={<Button>Reintentar</Button>}>
        La consulta puede volver a ejecutarse.
      </Notice>,
    );

    expect(screen.getByText("Revisá la consulta")).toBeInTheDocument();
    expect(screen.getByText("La consulta puede volver a ejecutarse.")).toBeInTheDocument();
    const action = screen.getByRole("button", { name: "Reintentar" });
    action.focus();
    expect(action).toHaveFocus();
  });
});