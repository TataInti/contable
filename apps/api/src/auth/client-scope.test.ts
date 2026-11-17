import { describe, expect, it } from "vitest";
import type { TenantContext } from "./tenant.js";
import {
  NOT_FOUND_IN_CLIENT_MESSAGES,
  NotFoundInClientError,
  clientScope,
} from "./client-scope.js";

const base: TenantContext = { userId: "u-demo", firmId: "f-demo", actorKind: "USER" };

describe("alcance por cliente de la ruta", () => {
  it("devuelve el estudio y el cliente de la ruta", () => {
    expect(clientScope({ ...base, clientId: "c-demo" })).toEqual({
      firmId: "f-demo",
      clientId: "c-demo",
    });
  });

  it.each([
    ["sin cliente", {}],
    ["cliente nulo", { clientId: null }],
    ["cliente vacío", { clientId: "" }],
  ] as const)("%s en el contexto: falla en lugar de abrirse a todo el estudio", (_caso, extra) => {
    expect(() => clientScope({ ...base, ...extra })).toThrow("requiere el cliente de la ruta");
  });

  it("«no encontrado en este cliente» es un 404 con el código de la guardia y el paso siguiente", () => {
    const error = new NotFoundInClientError("asiento");
    expect(error).toMatchObject({
      statusCode: 404,
      code: "RESOURCE_NOT_FOUND",
      message: NOT_FOUND_IN_CLIENT_MESSAGES.asiento,
    });
    expect(error.message).toBe(
      "No encontramos el asiento en este cliente. Abrilo desde la ficha del cliente donde está.",
    );
  });
});
