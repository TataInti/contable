import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

type Rule = "EQ" | "SWITCH" | "PREFIX" | "SET_HAS" | "MAP_INDEX";
type Finding = {
  file: string;
  rule: Rule;
  property: string;
  snippetHash: string;
  line: number;
};
type BaselineEntry = Omit<Finding, "line"> & { closesIn: string };

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const baselinePath = resolve(root, "apps/api/src/tax/catalog-text-baseline.json");
const fiscalScanPaths = [
  "apps/api/src/tax",
  "apps/api/src/flags/feature-flag-service.ts",
  "apps/api/src/clients/client-repository.ts",
  "packages/contracts/src/tax-engine-compatibility.ts",
  "packages/tax-engine/src",
  "apps/web/src/study/StudyExpedienteMensual.tsx",
  "apps/web/src/study/StudyReglasFiscales.tsx",
];
const sensitiveNames = [
  "code",
  "name",
  "engineVersion",
  "adapterVersion",
  "originCode",
  "activityCode",
  "taxTypeCode",
  "regimeCode",
  "jurisdictionCode",
  "concept",
  "familyKey",
];
const methodNames = new Set(["startsWith", "endsWith", "includes", "indexOf"]);
const comparisonKinds = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

function unwrapped(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) current = current.expression;
  return current;
}

function sensitiveProperty(node: ts.Expression): string | undefined {
  const value = unwrapped(node);
  if (ts.isPropertyAccessExpression(value) && sensitiveNames.includes(value.name.text)) {
    return value.name.text;
  }
  if (ts.isIdentifier(value)) {
    return sensitiveNames.find((name) => value.text.endsWith(name));
  }
  return undefined;
}

function isSensitive(node: ts.Expression): boolean {
  return sensitiveProperty(node) !== undefined;
}

function stringLiteral(node: ts.Expression | undefined): node is ts.StringLiteral {
  return Boolean(node && ts.isStringLiteral(node));
}

function normalizedSnippet(node: ts.Node): string {
  return node.getText().replace(/\s+/g, " ").trim();
}

function collectFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(absolute);
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) return [];
    const file = relative(root, absolute).replaceAll("\\", "/");
    if (/\.test\.tsx?$/.test(file) || file.includes("/__tests__/") || file.includes("/fixtures/")) return [];
    if (file.startsWith("apps/api/prisma/")) return [];
    if (/(^|\/)(seed[^/]*|[^/]*seed[^/]*)\.tsx?$/.test(file)) return [];
    if (/(^|\/)(node_modules|dist|build|coverage|\.next)\//.test(file)) return [];
    return [absolute];
  });
}

function scanFile(absolute: string): Finding[] {
  const text = readFileSync(absolute, "utf8");
  const source = ts.createSourceFile(
    absolute,
    text,
    ts.ScriptTarget.Latest,
    true,
    absolute.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const file = relative(root, absolute).replaceAll("\\", "/");
  const sets = new Set<string>();
  const maps = new Set<string>();

  function collectCatalogContainers(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const initializer = unwrapped(node.initializer);
      if (
        ts.isNewExpression(initializer) &&
        ts.isIdentifier(initializer.expression) &&
        initializer.expression.text === "Set" &&
        initializer.arguments?.some(ts.isArrayLiteralExpression)
      ) sets.add(node.name.text);
      if (ts.isObjectLiteralExpression(initializer)) {
        const hasCatalogKeys = initializer.properties.some((property) => {
          if (!ts.isPropertyAssignment(property)) return false;
          const name = property.name;
          const key = ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : "";
          return /^[A-Z][A-Z0-9_]+$/.test(key);
        });
        if (hasCatalogKeys) maps.add(node.name.text);
      }
    }
    ts.forEachChild(node, collectCatalogContainers);
  }
  collectCatalogContainers(source);

  const findings: Finding[] = [];
  function report(node: ts.Node, rule: Rule, expression: ts.Expression) {
    const property = sensitiveProperty(expression);
    if (!property) return;
    const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const snippetHash = createHash("sha256").update(normalizedSnippet(node)).digest("hex");
    findings.push({ file, rule, property, snippetHash, line: start });
  }

  function visit(node: ts.Node) {
    if (ts.isBinaryExpression(node) && comparisonKinds.has(node.operatorToken.kind)) {
      if (stringLiteral(node.left) && isSensitive(node.right)) report(node, "EQ", node.right);
      else if (stringLiteral(node.right) && isSensitive(node.left)) report(node, "EQ", node.left);
    }
    if (ts.isSwitchStatement(node) && isSensitive(node.expression)) {
      report(node, "SWITCH", node.expression);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const receiver = node.expression.expression;
      const method = node.expression.name.text;
      if (methodNames.has(method) && isSensitive(receiver) && stringLiteral(node.arguments[0])) {
        report(node, "PREFIX", receiver);
      }
      if (method === "has" && node.arguments[0] && isSensitive(node.arguments[0])) {
        const container = unwrapped(receiver);
        const isSet = (ts.isIdentifier(container) && sets.has(container.text)) ||
          (ts.isNewExpression(container) && ts.isIdentifier(container.expression) && container.expression.text === "Set");
        if (isSet) report(node, "SET_HAS", node.arguments[0]);
      }
    }
    if (ts.isElementAccessExpression(node) && node.argumentExpression && isSensitive(node.argumentExpression)) {
      const container = unwrapped(node.expression);
      if (ts.isIdentifier(container) && maps.has(container.text)) {
        report(node, "MAP_INDEX", node.argumentExpression);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return findings;
}

function findingKey(entry: Omit<Finding, "line">): string {
  return [entry.file, entry.rule, entry.property, entry.snippetHash].join("|");
}

function scanRepository(): Finding[] {
  return fiscalScanPaths
    .flatMap((path) => {
      const absolute = resolve(root, path);
      return statSync(absolute).isDirectory() ? collectFiles(absolute) : [absolute];
    })
    .flatMap(scanFile);
}

describe("decisiones fiscales no dependen del texto del catálogo", () => {
  it("no agrega coincidencias de texto y retira las entradas cerradas del baseline", () => {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as {
      version: number;
      entries: BaselineEntry[];
    };
    expect(baseline.version).toBe(1);

    const current = scanRepository();
    const baselineKeys = new Set(baseline.entries.map(findingKey));
    const currentKeys = new Set(current.map(findingKey));
    const added = current.filter((finding) => !baselineKeys.has(findingKey(finding)));
    const stale = baseline.entries.filter((entry) => !currentKeys.has(findingKey(entry)));

    if (added.length || stale.length) {
      const newLines = added.map(({ file, line, rule, property, snippetHash }) =>
        `nuevo ${file}:${line} ${rule} ${property} ${snippetHash}`);
      const staleLines = stale.map(({ file, rule, property, closesIn }) =>
        `stale ${file} ${rule} ${property} (cerrar: ${closesIn})`);
      throw new Error([...newLines, ...staleLines].join("\n") || "El baseline anti-texto cambió");
    }
  });
});
