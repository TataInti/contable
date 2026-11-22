import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { goTo, login, mutating, pickOption, SUFFIX } from "./helpers/ui";

const CLIENT = "Cliente E2E IIBB";
const MONTH = "Noviembre 2026";

async function openClientLegajo(page: Page) {
  await goTo(page, "Clientes");
  await page.getByRole("button", { name: `Abrir ficha de ${CLIENT}` }).click();
  await expect(page.getByText(CLIENT, { exact: true }).first()).toBeVisible();
  const clientSelector = page.getByRole("combobox", { name: "Cliente en el que estás trabajando" });
  await pickOption(clientSelector, CLIENT);
  await goTo(page, "Legajo");
  await expect(page.getByRole("heading", { name: "Legajo", exact: true })).toBeVisible();
  const period = page.getByLabel("Período fiscal");
  await pickOption(period, MONTH);
  await expect.poll(() => period.locator("option:checked").innerText()).toContain(MONTH);
}

async function nuevaPagina(context: BrowserContext) {
  return context.newPage();
}

async function loginPortal(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("cliente@contable.local");
  await page.getByLabel("Contraseña").fill("cliente1234");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function markGuidedTourSeen(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("contable-study-navigation-tour-v1", "dismissed");
  });
}

test("comentarios y menciones recorren Legajo, buzón y permisos desde la interfaz", async ({ browser }) => {
  test.setTimeout(120_000);
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const portalContext = await browser.newContext();
  const pageA = await nuevaPagina(contextA);
  const pageB = await nuevaPagina(contextB);
  const portalPage = await nuevaPagina(portalContext);
  const mentionText = `Seguimiento E2E ${SUFFIX} @`;
  const personalText = `Nota privada E2E ${SUFFIX}`;
  const archiveText = `Archivar E2E ${SUFFIX}`;
  const editedText = `Comentario editado E2E ${SUFFIX}`;

  try {
    await test.step("A abre la ficha del cliente y su Legajo de noviembre", async () => {
      await markGuidedTourSeen(pageA);
      await login(pageA);
      await openClientLegajo(pageA);
    });

    await test.step("A menciona a B y guarda una nota personal", async () => {
      const comment = pageA.getByLabel("Escribí un comentario");
      await comment.fill(mentionText);
      await expect(pageA.getByRole("listbox", { name: "Personas del estudio" })).toBeVisible();
      await pageA.getByRole("option", { name: "Revisor Demo" }).getByRole("button", { name: "Revisor Demo" }).click();
      await expect(pageA.getByText("Se notificará en «Pendientes para mí»." )).toBeVisible();
      // Se espera la respuesta del POST: el texto del textarea también coincide con getByText
      // mientras la mención viaja, y el formulario se vacía al guardar.
      await mutating(pageA, "/comments", () => pageA.getByRole("button", { name: "Comentar", exact: true }).click());
      const thread = pageA.getByRole("region", { name: "Comentarios" });
      await expect(thread.getByRole("listitem").filter({ hasText: mentionText.trim() })).toBeVisible();

      await comment.fill(personalText);
      await pageA.getByRole("checkbox", { name: "Solo para mí" }).check();
      await mutating(pageA, "/comments", () => pageA.getByRole("button", { name: "Comentar", exact: true }).click());
      await expect(thread.getByRole("listitem").filter({ hasText: personalText })).toBeVisible();
    });

    await test.step("B ve una mención, abre su hilo y no ve la nota personal", async () => {
      await markGuidedTourSeen(pageB);
      await login(pageB, "revisor@contable.local", "revisor1234");
      await expect(pageB.getByRole("link", { name: "Pendientes para mí (1)" })).toBeVisible();
      await pageB.getByRole("link", { name: "Pendientes para mí (1)" }).click();
      await expect(pageB.getByRole("heading", { name: "Pendientes para mí" })).toBeVisible();
      await expect(pageB.getByText(CLIENT, { exact: false }).first()).toBeVisible();
      await expect(pageB.getByText(MONTH, { exact: false }).first()).toBeVisible();
      await expect(pageB.getByText(personalText, { exact: true })).toHaveCount(0);
      await pageB.getByRole("button", { name: "Abrir comentario" }).click();
      await expect(pageB).toHaveURL(/\/expediente-mensual\?comentario=/);
      await expect(pageB.getByRole("region", { name: "Comentarios" }).getByText(mentionText.trim(), { exact: false })).toBeVisible();
      await expect(pageB.getByText(personalText, { exact: true })).toHaveCount(0);
      // Resolver se ofrece en el buzón «Pendientes para mí» (no en el hilo): se vuelve desde el menú.
      await pageB.getByRole("link", { name: "Pendientes para mí (1)" }).click();
      await mutating(pageB, "/resolve", () => pageB.getByRole("button", { name: "Marcar como resuelto" }).click());
      await expect(pageB.getByText("No tenés menciones pendientes.")).toBeVisible();
      await expect(pageB.getByRole("link", { name: "Pendientes para mí" })).toBeVisible();
    });

    await test.step("A edita su comentario y archiva otro", async () => {
      await pageA.reload();
      await expect(pageA.getByRole("region", { name: "Comentarios" })).toBeVisible();
      const mainComment = pageA.getByRole("listitem").filter({ hasText: mentionText.trim() });
      await mainComment.getByRole("button", { name: "Editar comentario" }).click();
      await pageA.getByLabel("Editar comentario").fill(editedText);
      await mutating(pageA, "/comments/", () => pageA.getByRole("button", { name: "Guardar cambios" }).click());
      const editedComment = pageA.getByRole("listitem").filter({ hasText: editedText });
      await expect(editedComment.locator("p").first()).toContainText("· editado");
      await expect(pageA.getByText(editedText, { exact: true })).toBeVisible();

      const archiveComment = pageA.getByRole("listitem").filter({ hasText: archiveText });
      await pageA.getByLabel("Escribí un comentario").fill(archiveText);
      await mutating(pageA, "/comments", () => pageA.getByRole("button", { name: "Comentar", exact: true }).click());
      await expect(archiveComment).toBeVisible();
      // Al archivar, el hilo reemplaza el texto por «Comentario archivado»: se sigue al mismo ítem por su id.
      const archivedItemId = await archiveComment.getAttribute("id");
      await mutating(pageA, "/archive", () => archiveComment.getByRole("button", { name: "Archivar" }).click());
      await expect(pageA.locator(`#${archivedItemId}`).getByText("Comentario archivado", { exact: true })).toBeVisible();
    });

    await test.step("el usuario del portal no accede a comentarios ni al buzón", async () => {
      await loginPortal(portalPage);
      await expect(portalPage.getByRole("link", { name: /Pendientes para mí/ })).toHaveCount(0);
      await expect(portalPage.getByRole("region", { name: "Comentarios" })).toHaveCount(0);
    });
  } finally {
    await Promise.allSettled([contextA.close(), contextB.close(), portalContext.close()]);
  }
});
