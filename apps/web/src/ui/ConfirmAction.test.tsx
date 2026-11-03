// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmAction } from "./ConfirmAction";

describe("ConfirmAction", () => {
  afterEach(() => cleanup());

  it("mantiene título y acciones fuera del contenido desplazable", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const description = Array.from({ length: 40 }, () => "Detalle de la acción.").join(" ");

    render(
      <ConfirmAction
        open
        title="Confirmar acción"
        description={description}
        confirmLabel="Continuar"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const dialog = screen.getByRole("alertdialog");
    const header = dialog.querySelector(".confirm-action__header");
    const content = dialog.querySelector(".confirm-action__content");
    const footer = dialog.querySelector(".confirm-action__actions");

    expect(header?.nextElementSibling).toBe(content);
    expect(content?.nextElementSibling).toBe(footer);
    expect(content?.textContent).toBe(description);

    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
