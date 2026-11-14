/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildPortalInvitationLink } from "./portalInvitationLink";

const ORIGIN = "https://contable.example.test";

describe("buildPortalInvitationLink", () => {
  it("el token viaja en el fragmento y el enlace no lleva ?token=", () => {
    const link = buildPortalInvitationLink(ORIGIN, "token-sintetico-1");

    expect(link).toBe(`${ORIGIN}/aceptar-invitacion#token=token-sintetico-1`);
    expect(link).toContain("#token=");
    expect(link).not.toContain("?token=");
  });

  it("un token con caracteres especiales viaja intacto y se recupera del fragmento", () => {
    const token = "ab+/=cd";
    const link = buildPortalInvitationLink(ORIGIN, token);

    expect(link).toContain("#token=ab%2B%2F%3Dcd");
    expect(new URLSearchParams(new URL(link).hash.slice(1)).get("token")).toBe(token);
  });

  it("StudyAdministracion copia el enlace con el helper y sin el formato de query", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../study/StudyAdministracion.tsx", import.meta.url)),
      "utf8",
    );

    expect(source).toContain("buildPortalInvitationLink(window.location.origin, created.invitationToken)");
    expect(source).not.toContain("/aceptar-invitacion?token=");
  });
});
