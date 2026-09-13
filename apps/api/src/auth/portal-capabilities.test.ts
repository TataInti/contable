import { describe, expect, it } from "vitest";
import { portalCapabilities } from "./portal-capabilities.js";

describe("capacidades del portal", () => {
  it("OWNER puede consultar resultados y operar documentos", () => {
    const capabilities = portalCapabilities("OWNER");
    expect(capabilities.has("portal.results.read")).toBe(true);
    expect(capabilities.has("portal.documents.upload")).toBe(true);
    expect(capabilities.has("message.shared")).toBe(true);
  });

  it("COLLABORATOR puede responder pero no consultar resultados", () => {
    const capabilities = portalCapabilities("COLLABORATOR");
    expect(capabilities.has("portal.documents.upload")).toBe(true);
    expect(capabilities.has("portal.requests.respond")).toBe(true);
    expect(capabilities.has("message.shared")).toBe(true);
    expect(capabilities.has("portal.results.read")).toBe(false);
  });

  it("READONLY sólo puede consultar resultados publicados", () => {
    const capabilities = portalCapabilities("READONLY");
    expect([...capabilities]).toEqual(["client.read", "portal.results.read"]);
    expect(capabilities.has("portal.documents.upload")).toBe(false);
    expect(capabilities.has("message.shared")).toBe(false);
  });
});
