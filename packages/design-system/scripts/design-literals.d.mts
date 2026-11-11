export interface DesignLiteralCounts {
  fontSize: number;
  spacing: number;
  radius: number;
  color: number;
}

export interface DesignLiteralBaseline {
  schemaVersion: 1;
  files: Record<string, DesignLiteralCounts>;
}

export function countCssLiterals(source: string): DesignLiteralCounts;
export function countTsxLiterals(source: string, filename?: string): DesignLiteralCounts;
export function scanRepository(root?: string): Record<string, DesignLiteralCounts>;
export function compareWithBaseline(
  currentFiles: Record<string, DesignLiteralCounts>,
  baselineFiles: Record<string, DesignLiteralCounts>,
): string[];
export function readBaseline(path?: string): DesignLiteralBaseline;
