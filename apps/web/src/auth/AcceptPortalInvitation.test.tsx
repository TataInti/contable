// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { AcceptPortalInvitation } from "./AcceptPortalInvitation";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
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

const DATOS_SINTETICOS = {
  name: "Persona Sintetica",
  email: "invitada.sintetica@example.test",
  password: "clave-sintetica-123",
};

function renderEn(entrada: string) {
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <AcceptPortalInvitation />
    </MemoryRouter>,
  );
}

function completarYEnviar() {
  const campo = (id: string) => document.getElementById(id) as HTMLInputElement;
  fireEvent.change(campo("invite-name"), { target: { value: DATOS_SINTETICOS.name } });
  fireEvent.change(campo("invite-email"), { target: { value: DATOS_SINTETICOS.email } });
  fireEvent.change(campo("invite-password"), { target: { value: DATOS_SINTETICOS.password } });
  fireEvent.click(screen.getByRole("button", { name: /Activar cuenta/ }));
}

describe("AcceptPortalInvitation", () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
    vi.mocked(api.post).mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("con #token= envía la aceptación con el token del fragmento", async () => {
    renderEn("/aceptar-invitacion#token=abc");
    completarYEnviar();

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/portal/invitations/accept", {
        token: "abc",
        ...DATOS_SINTETICOS,
      }),
    );
  });

  it("un token con caracteres especiales llega intacto desde el fragmento", async () => {
    renderEn(`/aceptar-invitacion#token=${encodeURIComponent("ab+/=cd")}`);
    completarYEnviar();

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/portal/invitations/accept",
        expect.objectContaining({ token: "ab+/=cd" }),
      ),
    );
  });

  it.each(["/aceptar-invitacion", "/aceptar-invitacion?token=abc"])(
    "sin token en el fragmento (%s) muestra el aviso y no habilita el envío",
    (entrada) => {
      renderEn(entrada);

      expect(screen.getByText(/El enlace de invitación está incompleto/)).toBeTruthy();
      expect(screen.getByText(/Pedile uno nuevo a quien administra el estudio/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Activar cuenta/ })).toBeNull();
      expect(api.post).not.toHaveBeenCalled();
    },
  );
});
