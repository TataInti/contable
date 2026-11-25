import { describe, expect, it } from "vitest";
import type { Document } from "../lib/api";
import { documentFileName } from "./bandeja/utilidades";
import {
  belongsToDocumentQueue,
  coincideConBusqueda,
  nombreVisibleDelEstado,
  ordenarPorIngresoDescendente,
  type DocumentQueueFilter,
} from "./bandeja/colaDeDocumentos";

function documentWithStatus(status: string) {
  return { status } as { status: string };
}

describe("belongsToDocumentQueue", () => {
  const filters: DocumentQueueFilter[] = ["ALL", "PROCESSING", "NEEDS_REVIEW", "REVIEWED", "ERROR"];

  it("un documento EXTRACTED queda en Para revisar y fuera de Aprobado", () => {
    const doc = documentWithStatus("EXTRACTED");
    for (const filter of filters) {
      expect(belongsToDocumentQueue(doc, filter)).toBe(filter === "ALL" || filter === "NEEDS_REVIEW");
    }
  });

  it("un documento REVIEWED (extracción aprobada) está en Aprobado y ya no en Para revisar", () => {
    const doc = documentWithStatus("REVIEWED");
    for (const filter of filters) {
      expect(belongsToDocumentQueue(doc, filter)).toBe(filter === "ALL" || filter === "REVIEWED");
    }
  });

  it("estados de error quedan en Con error", () => {
    for (const status of ["EXTRACTION_FAILED", "INFECTED", "FAILED"]) {
      expect(belongsToDocumentQueue(documentWithStatus(status), "ERROR")).toBe(true);
      expect(belongsToDocumentQueue(documentWithStatus(status), "NEEDS_REVIEW")).toBe(false);
      expect(belongsToDocumentQueue(documentWithStatus(status), "REVIEWED")).toBe(false);
    }
  });
});

const ESTADOS = [
  "UPLOADED",
  "VALIDATING",
  "PROCESSING",
  "IN_PROGRESS",
  "RUNNING",
  "EXTRACTED",
  "REVIEWED",
  "EXTRACTION_FAILED",
  "INFECTED",
  "FAILED",
  "READY",
  "APPLIED",
  "CANCELED",
];

function documento(
  status: string,
  nombre: string,
  createdAt: string,
  category: string | null = null,
  mimeType = "application/pdf",
) {
  return {
    id: `doc-${status}-${nombre}`,
    status,
    createdAt,
    category,
    direction: null,
    fileVersions: [{ originalName: nombre, mimeType, bucket: "originals", antivirusStatus: "CLEAN" }],
  } as unknown as Document;
}

describe("colas de la Bandeja con los 13 estados del documento (7b.2)", () => {
  it("«Todos» incluye los 13 estados y cada cola toma solo los suyos", () => {
    const procesando = ["UPLOADED", "VALIDATING", "PROCESSING", "IN_PROGRESS", "RUNNING"];
    const conError = ["EXTRACTION_FAILED", "INFECTED", "FAILED"];
    for (const status of ESTADOS) {
      const doc = documentWithStatus(status);
      expect(belongsToDocumentQueue(doc, "ALL")).toBe(true);
      expect(belongsToDocumentQueue(doc, "PROCESSING")).toBe(procesando.includes(status));
      expect(belongsToDocumentQueue(doc, "NEEDS_REVIEW")).toBe(status === "EXTRACTED");
      expect(belongsToDocumentQueue(doc, "REVIEWED")).toBe(status === "REVIEWED");
      expect(belongsToDocumentQueue(doc, "ERROR")).toBe(conError.includes(status));
    }
  });

  it("READY, APPLIED y CANCELED solo aparecen en «Todos»", () => {
    for (const status of ["READY", "APPLIED", "CANCELED"]) {
      const doc = documentWithStatus(status);
      for (const filter of ["PROCESSING", "NEEDS_REVIEW", "REVIEWED", "ERROR"] as const) {
        expect(belongsToDocumentQueue(doc, filter)).toBe(false);
      }
    }
  });
});

describe("nombreVisibleDelEstado (C7B-4: un nombre por estado, el mismo que su cola)", () => {
  it("los estados de cola se muestran con el nombre de su cola", () => {
    expect(nombreVisibleDelEstado("EXTRACTED")).toBe("Para revisar");
    expect(nombreVisibleDelEstado("REVIEWED")).toBe("Aprobado");
    for (const status of ["UPLOADED", "VALIDATING", "PROCESSING", "IN_PROGRESS", "RUNNING"]) {
      expect(nombreVisibleDelEstado(status)).toBe("Procesando");
    }
    expect(nombreVisibleDelEstado("EXTRACTION_FAILED")).toBe("Con error");
    expect(nombreVisibleDelEstado("FAILED")).toBe("Con error");
    expect(nombreVisibleDelEstado("INFECTED")).toBe("Amenaza detectada");
  });

  it("READY, APPLIED y CANCELED conservan el nombre compartido", () => {
    expect(nombreVisibleDelEstado("READY")).toBe("Listo");
    expect(nombreVisibleDelEstado("APPLIED")).toBe("Aplicado");
    expect(nombreVisibleDelEstado("CANCELED")).toBe("Cancelado");
  });
});

describe("coincideConBusqueda (7b-6: busca lo que la fila muestra)", () => {
  const factura = documento("EXTRACTED", "factura.pdf", "2026-10-31T12:00:00.000Z", "PURCHASE");

  it("encuentra por nombre, sin tildes ni mayúsculas", () => {
    expect(coincideConBusqueda(factura, "FACTÚRA")).toBe(true);
    expect(coincideConBusqueda(factura, "ticket")).toBe(false);
  });

  it("encuentra por el nombre visible del estado y no por su código", () => {
    expect(coincideConBusqueda(factura, "para revisar")).toBe(true);
    expect(coincideConBusqueda(factura, "EXTRACTED")).toBe(false);
  });

  it("encuentra la fecha dd/mm/aaaa que muestra la fila y no la ISO", () => {
    expect(coincideConBusqueda(factura, "31/10/2026")).toBe(true);
    expect(coincideConBusqueda(factura, "2026-10-31")).toBe(false);
  });

  it("no busca por categoría, que la fila no muestra", () => {
    expect(coincideConBusqueda(factura, "purchase")).toBe(false);
  });

  it("busca el tipo visible y una búsqueda vacía no filtra", () => {
    const imagen = documento("REVIEWED", "ticket.jpg", "2026-10-20T12:00:00.000Z", null, "image/jpeg");
    expect(coincideConBusqueda(imagen, "imagen")).toBe(true);
    expect(coincideConBusqueda(imagen, "   ")).toBe(true);
  });
});

describe("ordenarPorIngresoDescendente (7b-12: más recientes primero)", () => {
  it("ordena por fecha de ingreso descendente sin modificar el arreglo original", () => {
    const docs = [
      documento("EXTRACTED", "a.pdf", "2026-10-01T12:00:00.000Z"),
      documento("REVIEWED", "b.pdf", "2026-10-20T12:00:00.000Z"),
      documento("UPLOADED", "c.pdf", "2026-10-10T12:00:00.000Z"),
    ];
    expect(ordenarPorIngresoDescendente(docs).map((doc) => documentFileName(doc))).toEqual([
      "b.pdf",
      "c.pdf",
      "a.pdf",
    ]);
    expect(docs.map((doc) => documentFileName(doc))).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
  });
});
