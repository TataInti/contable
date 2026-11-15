// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FormEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionDrawer, ActionDrawerFooter } from "./ActionDrawer.js";

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

  it("puede iniciar el foco en Cerrar mientras el contenido se carga", async () => {
    render(
      <ActionDrawer
        isOpen
        onClose={() => undefined}
        title="Clientes de Ana"
        initialFocus="close"
      >
        <p role="status">Cargando clientes y asignaciones…</p>
      </ActionDrawer>,
    );

    const close = screen.getByRole("button", { name: "Cerrar" });
    await waitFor(() => expect(document.activeElement).toBe(close));
  });

  it("el pie pone «Cancelar» a la izquierda, el motivo junto a la acción principal y fuera del contenido", () => {
    const onCancel = vi.fn();
    render(
      <ActionDrawer
        isOpen
        onClose={() => undefined}
        title="Nuevo paquete"
        footer={
          <ActionDrawerFooter
            primary={
              <button type="submit" form="pack-form" disabled>
                Crear paquete
              </button>
            }
            hint="Completá el código para crear el paquete."
            onCancel={onCancel}
          />
        }
      >
        <form id="pack-form" />
      </ActionDrawer>,
    );

    const cancel = screen.getByRole("button", { name: "Cancelar" });
    const submit = screen.getByRole("button", { name: "Crear paquete" });
    const hint = screen.getByText("Completá el código para crear el paquete.");
    const footer = document.querySelector(".action-drawer__footer") as HTMLElement;

    expect(cancel.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hint.parentElement).toBe(submit.parentElement);
    expect(footer.contains(cancel) && footer.contains(submit)).toBe(true);
    expect(document.querySelector(".action-drawer__content")?.contains(cancel)).toBe(false);

    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
