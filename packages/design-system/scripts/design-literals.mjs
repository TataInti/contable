import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const BASELINE_PATH = join(REPO_ROOT, "packages/design-system/literals-baseline.json");
const SOURCE_ROOTS = ["apps/web/src", "packages/design-system/src"];
const COUNT_FIELDS = ["fontSize", "spacing", "radius", "color"];

function emptyCounts() {
  return { fontSize: 0, spacing: 0, radius: 0, color: 0 };
}

function countPx(value) {
  const matches = String(value).match(/-?(?:\d+(?:\.\d+)?|\.\d+)px\b/gi) ?? [];
  return matches.filter((match) => Number.parseFloat(match) !== 0).length;
}

function countColors(value) {
  const withoutUrls = String(value).replace(/url\([^)]*\)/gi, "");
  const matches = withoutUrls.match(/#[\da-f]{3}\b|#[\da-f]{4}\b|#[\da-f]{6}\b|#[\da-f]{8}\b|\brgba?\(\s*[^)]*\)/gi);
  return matches?.length ?? 0;
}

function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function classifyProperty(property) {
  const normalized = property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).toLowerCase();
  if (normalized === "font-size") return "fontSize";
  if (normalized === "font") return "font";
  if (/^(?:padding|margin)(?:-|$)/.test(normalized)) return "spacing";
  if (/^(?:gap|row-gap|column-gap|grid-gap|grid-row-gap|grid-column-gap)$/.test(normalized)) {
    return "spacing";
  }
  if (normalized === "border-radius") return "radius";
  return null;
}

function countDimensionValue(value, propertyType) {
  if (propertyType === "font") {
    return countPx(String(value).split("/", 1)[0] ?? "");
  }
  return countPx(value);
}

export function countCssLiterals(source) {
  const counts = emptyCounts();
  const cleaned = stripCssComments(source);
  const declarationPattern = /(?:^|[;{])\s*([\w-]+)\s*:\s*([^;{}]*)(?=;|\})/g;

  for (const [, property, value] of cleaned.matchAll(declarationPattern)) {
    if (property === undefined || value === undefined) continue;
    counts.color += countColors(value);

    const propertyType = classifyProperty(property);
    if (propertyType === "fontSize" || propertyType === "spacing" || propertyType === "radius") {
      counts[propertyType] += countDimensionValue(value, propertyType);
    } else if (propertyType === "font") {
      counts.fontSize += countDimensionValue(value, propertyType);
    }
  }

  return counts;
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function getPropertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function countTsxDimension(expression, propertyType) {
  const node = unwrapExpression(expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return countDimensionValue(node.text, propertyType);
  }
  if (ts.isNumericLiteral(node)) {
    return Number(node.text) === 0 ? 0 : 1;
  }
  if (ts.isTemplateExpression(node)) {
    const staticText = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ");
    const interpolatedPx = [...node.getText().matchAll(/\$\{\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*\}\s*px\b/gi)]
      .filter((match) => Number.parseFloat(match[1] ?? "0") !== 0).length;
    return countDimensionValue(staticText, propertyType) + interpolatedPx;
  }
  if (ts.isConditionalExpression(node)) {
    return countTsxDimension(node.whenTrue, propertyType) + countTsxDimension(node.whenFalse, propertyType);
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return countTsxDimension(node.left, propertyType) + countTsxDimension(node.right, propertyType);
  }
  return 0;
}

function countTsxColors(expression) {
  const node = unwrapExpression(expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return countColors(node.text);
  if (ts.isConditionalExpression(node)) {
    return countTsxColors(node.whenTrue) + countTsxColors(node.whenFalse);
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return countTsxColors(node.left) + countTsxColors(node.right);
  }
  return 0;
}

export function countTsxLiterals(source, filename = "inline-styles.tsx") {
  const counts = emptyCounts();
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map();
  const visitedExpressions = new Set();

  function collectDeclarations(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const initializers = declarations.get(node.name.text) ?? [];
      initializers.push(node.initializer);
      declarations.set(node.name.text, initializers);
    }
    ts.forEachChild(node, collectDeclarations);
  }

  function countStyleObject(objectLiteral) {
    if (visitedExpressions.has(objectLiteral)) return;
    visitedExpressions.add(objectLiteral);

    for (const member of objectLiteral.properties) {
      if (ts.isSpreadAssignment(member)) {
        visitStyleExpression(member.expression);
        continue;
      }
      if (!ts.isPropertyAssignment(member)) continue;

      const propertyName = getPropertyName(member.name);
      if (!propertyName) continue;
      const propertyType = classifyProperty(propertyName);
      const initializer = member.initializer;
      counts.color += countTsxColors(initializer);
      if (propertyType === "fontSize" || propertyType === "spacing" || propertyType === "radius") {
        counts[propertyType] += countTsxDimension(initializer, propertyType);
      } else if (propertyType === "font") {
        counts.fontSize += countTsxDimension(initializer, propertyType);
      }
    }
  }

  function visitStyleExpression(expression) {
    const node = unwrapExpression(expression);
    if (ts.isObjectLiteralExpression(node)) {
      countStyleObject(node);
      return;
    }
    if (visitedExpressions.has(node)) return;
    visitedExpressions.add(node);
    if (ts.isIdentifier(node)) {
      for (const initializer of declarations.get(node.text) ?? []) visitStyleExpression(initializer);
      return;
    }
    if (ts.isConditionalExpression(node)) {
      visitStyleExpression(node.whenTrue);
      visitStyleExpression(node.whenFalse);
      return;
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      visitStyleExpression(node.body);
      return;
    }
    if (ts.isBlock(node)) {
      for (const statement of node.statements) visitStyleExpression(statement);
      return;
    }
    if (ts.isReturnStatement(node) && node.expression) {
      visitStyleExpression(node.expression);
      return;
    }
    if (ts.isCallExpression(node)) {
      visitStyleExpression(node.expression);
      for (const argument of node.arguments) visitStyleExpression(argument);
      return;
    }
    ts.forEachChild(node, (child) => {
      if (ts.isObjectLiteralExpression(child)) countStyleObject(child);
      else visitStyleExpression(child);
    });
  }

  collectDeclarations(sourceFile);
  function visitJsx(node) {
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "style" &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression
    ) {
      visitStyleExpression(node.initializer.expression);
    }
    ts.forEachChild(node, visitJsx);
  }
  visitJsx(sourceFile);

  return counts;
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(entryPath);
      if (entry.isFile() && (entry.name.endsWith(".css") || entry.name.endsWith(".tsx"))) return [entryPath];
      return [];
    })
    .sort();
}

export function scanRepository(root = REPO_ROOT) {
  const countsByFile = {};
  for (const sourceRoot of SOURCE_ROOTS) {
    for (const absolutePath of sourceFiles(join(root, sourceRoot))) {
      if (absolutePath.endsWith(`${process.platform === "win32" ? "\\" : "/"}tokens.css`)) continue;
      const filename = relative(root, absolutePath).split("\\").join("/");
      const source = readFileSync(absolutePath, "utf8");
      countsByFile[filename] = absolutePath.endsWith(".css")
        ? countCssLiterals(source)
        : countTsxLiterals(source, filename);
    }
  }
  return Object.fromEntries(Object.entries(countsByFile).sort(([left], [right]) => left.localeCompare(right)));
}

export function compareWithBaseline(currentFiles, baselineFiles) {
  const violations = [];
  for (const [filename, current] of Object.entries(currentFiles)) {
    const previous = baselineFiles[filename];
    if (!previous) {
      const total = COUNT_FIELDS.reduce((sum, field) => sum + current[field], 0);
      if (total > 0) violations.push(`${filename}: archivo nuevo con ${total} literal(es)`);
      continue;
    }
    for (const field of COUNT_FIELDS) {
      if (current[field] > (previous[field] ?? 0)) {
        violations.push(`${filename}: ${field} ${current[field]} > baseline ${previous[field] ?? 0}`);
      }
    }
  }
  return violations;
}

export function readBaseline(path = BASELINE_PATH) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (parsed.schemaVersion !== 1 || !parsed.files || typeof parsed.files !== "object") {
    throw new Error(`Formato de baseline no válido: ${path}`);
  }
  return parsed;
}

function totals(files) {
  return Object.values(files).reduce((result, counts) => {
    for (const field of COUNT_FIELDS) result[field] += counts[field];
    return result;
  }, emptyCounts());
}

function writeBaseline(currentFiles) {
  if (existsSync(BASELINE_PATH)) {
    const previous = readBaseline().files;
    const violations = compareWithBaseline(currentFiles, previous);
    if (violations.length > 0) {
      throw new Error(`La línea base solo puede bajar:\n${violations.join("\n")}`);
    }
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify({ schemaVersion: 1, files: currentFiles }, null, 2)}\n`);
  console.log(`Baseline actualizado: ${Object.keys(currentFiles).length} archivos; ${JSON.stringify(totals(currentFiles))}`);
}

function main(args) {
  const currentFiles = scanRepository();
  if (args.length === 1 && args[0] === "--write") {
    writeBaseline(currentFiles);
    return;
  }
  if (args.length === 1 && args[0] === "--check") {
    const baseline = readBaseline();
    const violations = compareWithBaseline(currentFiles, baseline.files);
    if (violations.length > 0) throw new Error(violations.join("\n"));
    console.log(`Ratchet OK: ${Object.keys(currentFiles).length} archivos; ${JSON.stringify(totals(currentFiles))}`);
    return;
  }
  console.log(JSON.stringify({ files: Object.keys(currentFiles).length, totals: totals(currentFiles) }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
