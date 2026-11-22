import { fireEvent, screen } from "@testing-library/react";

/**
 * Elige una opción de un desplegable SearchSelect (combobox con búsqueda por texto).
 *
 * Abre el combobox, escribe el rótulo de la opción y hace clic en ella: es el mismo
 * recorrido que hace la persona. `etiqueta` es el nombre accesible del campo y
 * `texto` el rótulo exacto de la opción que se elige.
 */
export function elegirOpcion(etiqueta: string | RegExp, texto: string) {
  const combobox = screen.getByRole("combobox", { name: etiqueta });
  fireEvent.focus(combobox);
  fireEvent.change(combobox, { target: { value: texto } });
  fireEvent.click(screen.getByRole("option", { name: texto }));
}

/**
 * Reemplazo de `fireEvent.change(elemento, { target: { value } })` para las pruebas
 * que cambiaban un desplegable por su valor.
 *
 * Si el elemento es un combobox y tiene una opción con ese valor, la elige con un clic
 * (como una persona). En cualquier otro caso —un campo de texto o una búsqueda que se
 * tipea—, hace el mismo `fireEvent.change` de antes.
 */
export function cambiarValor(elemento: HTMLElement, valor: string) {
  if (elemento.getAttribute("role") === "combobox") {
    // Primero se abre el desplegable (el listado solo existe mientras está abierto).
    fireEvent.focus(elemento);
    const opciones = Array.from(elemento.parentElement?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    const opcion = opciones.find((item) => item.getAttribute("data-value") === valor);
    if (opcion) {
      fireEvent.click(opcion);
      return;
    }
  }
  fireEvent.change(elemento, { target: { value: valor } });
}
