/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface FontFace {
  family: string | undefined;
  weight: string | undefined;
  src: string | undefined;
}

describe("font subsets", () => {
  it("declares a latin face for every family and weight in fonts.css", () => {
    const css = readFileSync(new URL("./fonts.css", import.meta.url), "utf8");
    const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => {
      const body = match[1] ?? "";
      const property = (name: string) =>
        new RegExp(`(?:^|\\n)\\s*${name}\\s*:\\s*([^;]+);`, "i").exec(body)?.[1]?.trim();

      return {
        family: property("font-family")?.replace(/^['\"]|['\"]$/g, ""),
        weight: property("font-weight"),
        src: property("src"),
      } satisfies FontFace;
    });

    expect(faces.length).toBeGreaterThan(0);

    const declaredPairs = new Map<string, { family: string; weight: string }>();
    for (const { family, weight } of faces) {
      if (family === undefined || weight === undefined) {
        throw new Error("Every @font-face must declare its family and weight");
      }
      declaredPairs.set(`${family}/${weight}`, { family, weight });
    }

    for (const { family, weight } of declaredPairs.values()) {
      expect(
        faces.some(
          (face) =>
            face.family === family &&
            face.weight === weight &&
            /-latin-(\d+)-normal\.woff2/.exec(face.src ?? "")?.[1] === weight,
        ),
        `${family} ${weight} must have a latin font face`,
      ).toBe(true);
    }
  });
});
