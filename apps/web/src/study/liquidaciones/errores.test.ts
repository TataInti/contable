// Mapeo único de errores de la pantalla de Liquidaciones (decisión de Inti, 68):
// qué pasó y qué hacer, por código estable y por estado HTTP, nunca por el texto.
import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api";
import { mensajeDeErrorDeLiquidacion } from "./errores";

const REINTENTAR =
  "Volvé a intentarlo en unos minutos. Si sigue igual, avisá a quien administra el estudio.";
const RESPALDO = "No se pudo completar la acción sobre la liquidación.";
const INTEGRIDAD =
  "El archivo guardado no coincide con su verificación de integridad y no se entrega, porque es evidencia. Avisá a quien administra el estudio.";
const ALMACENAMIENTO =
  "No se puede entregar el archivo ahora: el almacenamiento no responde. Volvé a intentarlo en unos minutos. Si sigue igual, avisá a quien administra el estudio.";

describe("mensajeDeErrorDeLiquidacion", () => {
  it("la verificación de integridad muestra el texto aprobado del servidor", () => {
    const error = new ApiError("ARTIFACT_CHECKSUM_MISMATCH", INTEGRIDAD, 409);
    expect(mensajeDeErrorDeLiquidacion(error, RESPALDO)).toBe(INTEGRIDAD);
  });

  it("sin almacenamiento disponible (503) muestra el texto controlado del servidor, no el técnico", () => {
    const error = new ApiError("ARTIFACT_STORAGE_UNAVAILABLE", ALMACENAMIENTO, 503);
    expect(mensajeDeErrorDeLiquidacion(error, RESPALDO)).toBe(ALMACENAMIENTO);
  });

  it("un no encontrado dice qué pasó y qué hacer", () => {
    const error = new ApiError("ARTIFACT_NOT_FOUND", "Papel de trabajo no encontrado", 404);
    expect(mensajeDeErrorDeLiquidacion(error, RESPALDO)).toBe(
      "Papel de trabajo no encontrado. Actualizá la pantalla. Si sigue igual, avisá a quien administra el estudio.",
    );
  });

  it("un conflicto conserva su motivo y dice el paso siguiente", () => {
    const error = new ApiError(
      "SETTLEMENT_IMMUTABLE",
      "El papel de trabajo sólo se descarga desde una liquidación finalizada",
      409,
    );
    expect(mensajeDeErrorDeLiquidacion(error, RESPALDO)).toBe(
      "El papel de trabajo sólo se descarga desde una liquidación finalizada. Actualizá la pantalla y volvé a intentarlo.",
    );
  });

  it("un 500 nunca muestra el texto técnico y dice el paso siguiente", () => {
    const error = new ApiError("INTERNAL_ERROR", "connect ECONNREFUSED 127.0.0.1:9000", 500);
    const texto = mensajeDeErrorDeLiquidacion(error, RESPALDO);
    expect(texto).toBe(REINTENTAR);
    expect(texto).not.toContain("ECONNREFUSED");
  });

  it("sin respuesta del servidor dice el paso siguiente", () => {
    const error = new ApiError("NETWORK_ERROR", "Failed to fetch", 0);
    expect(mensajeDeErrorDeLiquidacion(error, RESPALDO)).toBe(REINTENTAR);
  });

  it("un error que no viene de la API conserva el texto de respaldo", () => {
    expect(mensajeDeErrorDeLiquidacion(new Error("otro"), RESPALDO)).toBe(RESPALDO);
  });
});
