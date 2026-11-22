import { fireEvent, screen, within } from "@testing-library/react";

/**
 * Helpers de prueba para los desplegables SearchSelect (combobox con búsqueda por texto).
 *
 * Cambian CÓMO se elige o se lee un valor (abrir, escribir, hacer clic en la opción),
 * nunca QUÉ se verifica. `etiqueta` es el nombre accesible del campo; `ambito` acota
 * la búsqueda a un contenedor (un diálogo, un cajón) cuando la pantalla repite etiquetas.
 */

type Ambito = HTMLElement | undefined;

function consulta(ambito?: Ambito) {
  return ambito ? within(ambito) : screen;
}

function comboboxDe(etiqueta: string | RegExp, ambito?: Ambito): HTMLInputElement {
  return consulta(ambito).getByRole("combobox", { name: etiqueta }) as HTMLInputElement;
}

/** Listado del propio desplegable (cada SearchSelect lo renderiza dentro de su raíz). */
function listadoDe(combobox: HTMLInputElement): HTMLElement {
  const listado = combobox.parentElement?.querySelector<HTMLElement>('[role="listbox"]');
  if (!listado) throw new Error("El desplegable no tiene listado abierto");
  return listado;
}

/**
 * Elige una opción de un desplegable: lo abre, escribe el rótulo y hace clic en la opción.
 * `opcion` es el rótulo exacto o una expresión regular que lo identifica.
 */
export function elegirOpcion(etiqueta: string | RegExp, opcion: string | RegExp, ambito?: Ambito) {
  const combobox = comboboxDe(etiqueta, ambito);
  fireEvent.focus(combobox);
  if (typeof opcion === "string") fireEvent.change(combobox, { target: { value: opcion } });
  fireEvent.click(within(listadoDe(combobox)).getByRole("option", { name: opcion }));
}

/**
 * Abre el desplegable y devuelve su listado (con la opción vacía «Elegí…» si la tiene).
 * Para leer o buscar opciones: `within(abrirListado("Campo")).getAllByRole("option")`.
 * El listado queda abierto; se cierra con Escape o eligiendo una opción.
 */
export function abrirListado(etiqueta: string | RegExp, ambito?: Ambito): HTMLElement {
  const combobox = comboboxDe(etiqueta, ambito);
  fireEvent.focus(combobox);
  return listadoDe(combobox);
}

/** Valor guardado del desplegable (el que iría en el formulario): reemplaza `select.value`. */
export function valorElegido(etiqueta: string | RegExp, ambito?: Ambito): string {
  const combobox = comboboxDe(etiqueta, ambito);
  const oculto = combobox.parentElement?.querySelector<HTMLInputElement>('input[type="hidden"]');
  return oculto?.value ?? "";
}

/** Texto visible del desplegable con su opción elegida. */
export function textoElegido(etiqueta: string | RegExp, ambito?: Ambito): string {
  return comboboxDe(etiqueta, ambito).value;
}

/**
 * Nombres de las opciones del desplegable, sin la opción vacía («Elegí…»).
 * Abre el listado y lo cierra con Escape. Reemplaza las lecturas de `select.options`.
 */
export function opcionesDe(etiqueta: string | RegExp, ambito?: Ambito): string[] {
  const combobox = comboboxDe(etiqueta, ambito);
  const listado = abrirListado(etiqueta, ambito);
  const nombres = within(listado)
    .getAllByRole("option")
    .filter((option) => option.getAttribute("data-value") !== "")
    .map((option) => option.textContent ?? "");
  fireEvent.keyDown(combobox, { key: "Escape" });
  return nombres;
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
