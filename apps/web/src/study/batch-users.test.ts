import { describe, expect, it } from "vitest";
import { credentialsCsv, parseBatchUsers, resolveBatchRole } from "./batch-users";

describe("resolveBatchRole", () => {
  it("usa Preparador cuando no se indica rol", () => {
    expect(resolveBatchRole(undefined)).toBe("PREPARER");
    expect(resolveBatchRole("  ")).toBe("PREPARER");
  });

  it("reconoce etiquetas y códigos sin importar tildes ni mayúsculas", () => {
    expect(resolveBatchRole("Revisor")).toBe("REVIEWER");
    expect(resolveBatchRole("ADMINISTRADOR")).toBe("ADMIN");
    expect(resolveBatchRole("Auditor · sólo lectura")).toBe("AUDITOR_READONLY");
    expect(resolveBatchRole("auditor")).toBe("AUDITOR_READONLY");
    expect(resolveBatchRole("TITULAR")).toBe("OWNER");
  });

  it("devuelve null ante un rol desconocido", () => {
    expect(resolveBatchRole("gerente")).toBeNull();
  });
});

describe("parseBatchUsers", () => {
  it("interpreta una persona por línea e ignora líneas vacías", () => {
    const lines = parseBatchUsers(
      "Lucía Fernández, lucia@estudio.com, Preparador\n\nMartín Acosta, martin@estudio.com, Revisor",
    );
    expect(lines).toEqual([
      { line: 1, name: "Lucía Fernández", email: "lucia@estudio.com", role: "PREPARER", error: null },
      { line: 3, name: "Martín Acosta", email: "martin@estudio.com", role: "REVIEWER", error: null },
    ]);
  });

  it("marca emails inválidos, roles desconocidos y repetidos sin frenar el resto", () => {
    const lines = parseBatchUsers(
      [
        "Ana, ana@estudio.com",
        "Beto, beto@estudio",
        "Carla, carla@estudio.com, gerente",
        "Ana Bis, ANA@estudio.com",
        ", sin-nombre@estudio.com",
      ].join("\n"),
    );
    expect(lines.map((line) => line.error)).toEqual([
      null,
      "Email inválido o faltante.",
      "Rol desconocido: “gerente”.",
      "Email repetido en la lista.",
      "Falta el nombre.",
    ]);
  });
});

describe("credentialsCsv", () => {
  it("escapa comillas y neutraliza fórmulas", () => {
    const csv = credentialsCsv([
      { name: '=SUMA(1)', email: "a@b.com", role: "Revisor", temporaryPassword: 'p"w' },
    ]);
    expect(csv.split("\n")[1]).toBe(`"'=SUMA(1)","a@b.com","Revisor","p""w"`);
  });
});
