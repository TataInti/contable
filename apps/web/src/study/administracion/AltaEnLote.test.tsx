// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { api } from "../../lib/api";
import { contextoDemo, mockApiDemo, renderizarAdministracion } from "./pruebas/entornoDemo";

const contexto = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

vi.mock("../../context/ClientContext", () => ({
  useClientContext: () => contexto.current,
}));

vi.mock("../../session/SessionContext", () => ({
  useSession: () => ({
    status: "authenticated",
    me: null,
    portalContexts: [],
    error: null,
    refresh: async () => {},
  }),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      del: vi.fn(),
      postWithHeaders: vi.fn(),
    } as unknown as typeof actual.api,
  };
});

const LINEAS_CON_ERRORES = [
  "Ana Demo, ana@example.com, Revisor",
  "Beto Demo, beto@example.com",
  "Carla Demo, carla-sin-arroba, Revisor",
  "Dani Demo, ana@example.com, Revisor",
  "Eli Demo, eli@example.com, Gerente",
].join("\n");

/** Cuenta que devuelve el alta individual, con su contraseña temporal. */
function cuentaCreada(cuerpo: Record<string, string>) {
  return {
    userId: `user-${cuerpo.email}`,
    email: cuerpo.email,
    name: cuerpo.name,
    role: cuerpo.role,
    temporaryPassword: `tmp-${cuerpo.name}`,
  };
}

/** Alta que falla solo para Beto y crea a las demás. */
function altaConUnFallo(cuerpo: Record<string, string>) {
  return cuerpo.email === "beto@example.com"
    ? Promise.reject(new Error("Correo ya registrado en otro estudio"))
    : Promise.resolve(cuentaCreada(cuerpo));
}

const abrirLote = async () =>
  fireEvent.click(await screen.findByRole("button", { name: "Alta en lote" }));

const escribirLote = async (texto: string) =>
  fireEvent.change(await screen.findByLabelText(/Una persona por línea/), {
    target: { value: texto },
  });

/** Lee un Blob como texto (jsdom no implementa Blob.text). */
function leerBlob(blob: Blob): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onload = () => resolver(String(lector.result));
    lector.onerror = () => rechazar(lector.error);
    lector.readAsText(blob);
  });
}

describe("Alta en lote de usuarios (caracterización K8)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contexto.current = contextoDemo(["firm.manage", "firm.users.manage", "client.read"]);
    mockApiDemo();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
  });

  it("vista previa: marca cada línea con error y cuenta solo las válidas", async () => {
    renderizarAdministracion();
    await abrirLote();
    await escribirLote(LINEAS_CON_ERRORES);

    const vista = await screen.findByRole("table", { name: "Vista previa del alta en lote" });
    expect(within(vista).getByText("Correo inválido o faltante.")).toBeTruthy();
    expect(within(vista).getByText("Correo repetido en la lista.")).toBeTruthy();
    expect(within(vista).getByText("Rol desconocido: “Gerente”.")).toBeTruthy();
    expect(within(vista).getByText("Preparador")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Crear 2 usuarios/ })).toBeTruthy();
  });

  it("crea una cuenta por vez, en orden, y muestra las contraseñas temporales", async () => {
    vi.mocked(api.post).mockImplementation(((_ruta: string, cuerpo: Record<string, string>) =>
      Promise.resolve(cuentaCreada(cuerpo))) as never);
    renderizarAdministracion();
    await abrirLote();
    await escribirLote("Ana Demo, ana@example.com, Revisor\nBeto Demo, beto@example.com");

    fireEvent.click(await screen.findByRole("button", { name: /Crear 2 usuarios/ }));
    await waitFor(() => expect(vi.mocked(api.post)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.post)).toHaveBeenNthCalledWith(1, "/firms/firm-a/users", {
      email: "ana@example.com",
      name: "Ana Demo",
      role: "REVIEWER",
    });
    expect(vi.mocked(api.post)).toHaveBeenNthCalledWith(2, "/firms/firm-a/users", {
      email: "beto@example.com",
      name: "Beto Demo",
      role: "PREPARER",
    });
    expect(await screen.findByText("tmp-Ana Demo")).toBeTruthy();
    expect(screen.getByText("tmp-Beto Demo")).toBeTruthy();
    expect(document.querySelector(".dense-stack")?.textContent).toContain(
      "Se crearon 2 de 2 usuarios",
    );
  });

  it("un fallo en una línea no corta el resto y queda reflejado en el resultado", async () => {
    vi.mocked(api.post).mockImplementation(((_ruta: string, cuerpo: Record<string, string>) =>
      altaConUnFallo(cuerpo)) as never);
    renderizarAdministracion();
    await abrirLote();
    await escribirLote(
      "Ana Demo, ana@example.com, Revisor\nBeto Demo, beto@example.com\nCarla Demo, carla@example.com, auditor",
    );

    fireEvent.click(await screen.findByRole("button", { name: /Crear 3 usuarios/ }));
    await waitFor(() => expect(vi.mocked(api.post)).toHaveBeenCalledTimes(3));
    expect(await screen.findByText("Correo ya registrado en otro estudio")).toBeTruthy();
    expect(screen.getByText("tmp-Carla Demo")).toBeTruthy();
    expect(document.querySelector(".dense-stack")?.textContent).toContain(
      "Se crearon 2 de 3 usuarios",
    );
  });

  it("descarga el CSV solo con las cuentas creadas: nombre, correo, rol y contraseña", async () => {
    vi.mocked(api.post).mockImplementation(((_ruta: string, cuerpo: Record<string, string>) =>
      altaConUnFallo(cuerpo)) as never);
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((objeto: Blob) => {
      blobs.push(objeto);
      return "blob:demo-csv";
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    renderizarAdministracion();
    await abrirLote();
    await escribirLote(
      "Ana Demo, ana@example.com, Revisor\nBeto Demo, beto@example.com\nCarla Demo, carla@example.com, auditor",
    );
    fireEvent.click(await screen.findByRole("button", { name: /Crear 3 usuarios/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Descargar CSV" }));

    expect(blobs).toHaveLength(1);
    expect(await leerBlob(blobs[0] as Blob)).toBe(
      [
        '"nombre","email","rol","contraseña_temporal"',
        '"Ana Demo","ana@example.com","Revisor","tmp-Ana Demo"',
        '"Carla Demo","carla@example.com","Auditor · sólo lectura","tmp-Carla Demo"',
      ].join("\n"),
    );
  });
});
