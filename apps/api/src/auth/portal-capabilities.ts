import type { Capability } from "@contable/permissions";

export type PortalRole = "OWNER" | "COLLABORATOR" | "READONLY";

/**
 * Capacidades del portal separadas de las capacidades internas del estudio.
 *
 * OWNER puede consultar resultados y operar sobre pedidos/documentos.
 * COLLABORATOR sólo puede responder pedidos, cargar documentos y mensajear.
 * READONLY sólo puede consultar información publicada.
 */
export function portalCapabilities(role: PortalRole): ReadonlySet<Capability> {
  if (role === "OWNER") {
    return new Set([
      "client.read",
      "portal.results.read",
      "portal.documents.upload",
      "portal.requests.respond",
      "message.shared",
    ]);
  }

  if (role === "COLLABORATOR") {
    return new Set([
      "client.read",
      "portal.documents.upload",
      "portal.requests.respond",
      "message.shared",
    ]);
  }

  return new Set(["client.read", "portal.results.read"]);
}
