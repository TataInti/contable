import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const design = readFileSync(new URL("../../../DESIGN.md", import.meta.url), "utf8");
const tokenCss = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const definedTokens = new Set<string>(
  [...tokenCss.matchAll(/^\s*(--ds-[\w-]+)\s*:/gm)]
    .map((match) => match[1])
    .filter((token): token is string => token !== undefined),
);
const citedTokens = new Set<string>(design.match(/--ds-[\w-]+/g) ?? []);
const colorAliases = new Set([
  "--ds-surface",
  "--ds-surface-muted",
  "--ds-border",
  "--ds-text",
  "--ds-text-muted",
  "--ds-accent",
  "--ds-accent-soft",
]);

function isRequiredFamily(token: string): boolean {
  return (
    token.startsWith("--ds-color-") ||
    token.startsWith("--ds-font-") ||
    token.startsWith("--ds-radius-") ||
    token.startsWith("--ds-text-") ||
    token.startsWith("--ds-leading-") ||
    colorAliases.has(token)
  );
}

describe("DESIGN.md token coverage", () => {
  it("cites only tokens declared in tokens.css", () => {
    const unknown = [...citedTokens].filter((token) => !definedTokens.has(token));

    expect(unknown, `Tokens citados en DESIGN.md que no existen: ${unknown.join(", ")}`).toEqual([]);
  });

  it("documents every color, typography, and radius token", () => {
    const missing = [...definedTokens].filter(
      (token) => isRequiredFamily(token) && !citedTokens.has(token),
    );

    expect(missing, `Tokens sin documentar en DESIGN.md: ${missing.join(", ")}`).toEqual([]);
  });
});
