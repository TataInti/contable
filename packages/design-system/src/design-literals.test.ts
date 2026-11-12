import { describe, expect, it } from "vitest";
import {
  compareWithBaseline,
  countCssLiterals,
  countTsxLiterals,
  readBaseline,
  scanRepository,
} from "../scripts/design-literals.mjs";

const baseline = readBaseline();
const currentFiles = scanRepository();
const violations = compareWithBaseline(currentFiles, baseline.files);

describe("design literal ratchet", () => {
  it("keeps each CSS/TSX file at or below its versioned baseline", () => {
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("rejects a new source file that introduces a tracked literal", () => {
    expect(
      compareWithBaseline(
        { "apps/web/src/New.css": { fontSize: 0, spacing: 1, radius: 0, color: 0 } },
        {},
      ),
    ).toEqual(["apps/web/src/New.css: archivo nuevo con 1 literal(es)"]);
  });

  it("counts CSS dimensions and colors while exempting zero and border width", () => {
    expect(
      countCssLiterals(`
        .example {
          font-size: clamp(12px, 1rem, 16px);
          font: 600 11px/16px sans-serif;
          padding: 0 4px;
          margin: 0;
          border: 1px solid #eeeeee;
          border-radius: 0 50% 2px;
          color: rgb(12, 34, 56);
          box-shadow: 0 1px 2px #000;
        }
      `),
    ).toEqual({ fontSize: 3, spacing: 1, radius: 1, color: 3 });
  });

  it("counts literals in inline TSX styles, including referenced style objects", () => {
    expect(
      countTsxLiterals(`
        const shared = { color: "#112233", gap: "8px" };
        const local = { fontSize: 14, borderRadius: "50%" };
        const Example = () => (
          <div style={{
            ...shared,
            ...local,
            margin: "0 4px",
            font: "600 13px/20px sans-serif",
            background: "rgba(1, 2, 3, .5)",
          }} />
        );
      `),
    ).toEqual({ fontSize: 2, spacing: 2, radius: 0, color: 2 });
  });
});
