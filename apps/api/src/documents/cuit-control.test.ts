import { describe, expect, it } from "vitest";
import { CUIT_ESTADO, evaluarCuitDocumento, formatearCuit, normalizarCuit } from "./cuit-control.js";

/** CUIT sintéticos (dígito verificador válido, sin datos reales). */
const CLIENTE = { cuit: "20111111112", nombre: "Cliente Demo A" };
const OTRO = { id: "cli-b", legalName: "Cliente Demo B", cuit: "30222222229" };
const EXTERNO = "27333333334";
const EXTERNO_2 = "23333333334";

const base = {
  clienteNombre: CLIENTE.nombre,
  clienteCuit: CLIENTE.cuit,
  otrosClientes: [OTRO],
};

describe("normalizarCuit", () => {
  it("quita guiones y espacios y devuelve los once dígitos", () => {
    expect(normalizarCuit("20-11111111-2")).toBe("20111111112");
    expect(normalizarCuit(" 20 11111111 2 ")).toBe("20111111112");
  });

  it("devuelve null si no hay once dígitos o el valor no es texto", () => {
    expect(normalizarCuit("1234567890")).toBeNull();
    expect(normalizarCuit("")).toBeNull();
    expect(normalizarCuit(null)).toBeNull();
    expect(normalizarCuit(20111111112)).toBeNull();
  });

  it("formatea con guiones para el contador", () => {
    expect(formatearCuit("20111111112")).toBe("20-11111111-2");
  });
});

describe("evaluarCuitDocumento", () => {
  it("es correcto cuando el cliente es el emisor (venta)", () => {
    const r = evaluarCuitDocumento({ ...base, emisor: CLIENTE.cuit, receptor: EXTERNO });
    expect(r.estado).toBe(CUIT_ESTADO.CORRECTO);
    expect(r.mensaje).toBeNull();
    expect(r.sugerido).toBeNull();
  });

  it("es correcto cuando el cliente es el receptor (compra)", () => {
    const r = evaluarCuitDocumento({ ...base, emisor: EXTERNO, receptor: "20-11111111-2" });
    expect(r.estado).toBe(CUIT_ESTADO.CORRECTO);
  });

  it("sugiere el otro cliente del estudio cuando el emisor es de él", () => {
    const r = evaluarCuitDocumento({ ...base, emisor: OTRO.cuit, receptor: EXTERNO });
    expect(r.estado).toBe(CUIT_ESTADO.OTRO_CLIENTE);
    expect(r.sugerido).toEqual(OTRO);
    expect(r.mensaje).toBe(
      "Este comprobante es del CUIT 30-22222222-9, que corresponde a Cliente Demo B (no a Cliente Demo A).",
    );
  });

  it("sugiere al cliente del receptor aunque el emisor no se haya leído", () => {
    const r = evaluarCuitDocumento({ ...base, emisor: null, receptor: OTRO.cuit });
    expect(r.estado).toBe(CUIT_ESTADO.OTRO_CLIENTE);
    expect(r.sugerido?.id).toBe("cli-b");
  });

  it("marca CUIT de otro cliente sin sugerencia cuando ninguno es del estudio", () => {
    const r = evaluarCuitDocumento({ ...base, emisor: EXTERNO, receptor: EXTERNO_2 });
    expect(r.estado).toBe(CUIT_ESTADO.OTRO_CLIENTE);
    expect(r.sugerido).toBeNull();
    expect(r.mensaje).toContain("no son de Cliente Demo A");
  });

  it("marca CUIT no leído cuando la IA no leyó ninguno de los dos", () => {
    const r = evaluarCuitDocumento({ ...base, emisor: null, receptor: null });
    expect(r.estado).toBe(CUIT_ESTADO.NO_LEIDO);
    expect(r.mensaje).toBe(
      "No se pudo leer el CUIT del emisor ni del receptor del comprobante. Revisalo a mano y, si es de Cliente Demo A, aceptalo con motivo.",
    );
  });

  it("marca CUIT no leído cuando falta un lado y el otro no es de nadie del estudio", () => {
    const r = evaluarCuitDocumento({ ...base, emisor: null, receptor: EXTERNO });
    expect(r.estado).toBe(CUIT_ESTADO.NO_LEIDO);
    expect(r.mensaje).toContain("No se pudo leer el CUIT del emisor del comprobante");
  });

  it("trata un CUIT del cliente con guiones igual que sin guiones", () => {
    const r = evaluarCuitDocumento({ ...base, emisor: "20-11111111-2", receptor: null });
    expect(r.estado).toBe(CUIT_ESTADO.CORRECTO);
  });

  it("no lee como correcto si el cliente no tiene CUIT válido", () => {
    const r = evaluarCuitDocumento({ ...base, clienteCuit: "", emisor: CLIENTE.cuit, receptor: EXTERNO });
    expect(r.estado).not.toBe(CUIT_ESTADO.CORRECTO);
  });
});
