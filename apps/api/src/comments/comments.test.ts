import { describe, expect, it } from "vitest";
import { requiredCapability } from "../auth/guard.js";

describe("comentarios del estudio", () => {
  it("limita lectura al cliente y escritura al permiso de mensajes compartidos", () => {
    const path = "/api/v1/firms/f1/clients/c1/comments";
    expect(requiredCapability("GET", path)).toBe("client.read");
    expect(requiredCapability("POST", path)).toBe("message.shared");
    expect(requiredCapability("PATCH", `${path}/comment-1`)).toBe("message.shared");
    expect(requiredCapability("POST", "/api/v1/firms/f1/comments/inbox/resolve")).toBe("message.shared");
  });
});
