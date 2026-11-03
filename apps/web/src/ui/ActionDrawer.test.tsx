// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FormEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionDrawer } from "./ActionDrawer";

describe("ActionDrawer", () => {
  afterEach(() => cleanup());

  it("mantiene el pie fuera del contenido desplazable y asocia su submit al formulario", () => {
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());

    render(
      <ActionDrawer
        isOpen
        onClose={() => undefined}
        title="Alta de cliente"
        footer={
          <button type="submit" form="client-create-form">
            Crear cliente
          </button>
        }
      >
        <form id="client-create-form" onSubmit={onSubmit}>
          <label htmlFor="client-name">Razón social</label>
          <input id="client-name" name="clientName" defaultValue="Vionnet SA" />
        </form>
      </ActionDrawer>,
    );

    const panel = screen.getByRole("dialog");
    const header = panel.querySelector(".action-drawer__header");
    const content = panel.querySelector(".action-drawer__content");
    const footer = panel.querySelector(".action-drawer__footer");
    const submit = screen.getByRole("button", { name: "Crear cliente" }) as HTMLButtonElement;

    expect(header?.nextElementSibling).toBe(content);
    expect(content?.nextElementSibling).toBe(footer);
    expect(submit.form).toBe(document.getElementById("client-create-form"));

    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
