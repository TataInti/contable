import { reviewIssueSchema, type ReviewIssue } from "@contable/contracts";

export function apiReviewIssues(value: unknown): ReviewIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = reviewIssueSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export function extractionForApi<T extends { reviewIssues: unknown }>(
  extraction: T,
): Omit<T, "reviewIssues"> & { reviewIssues: ReviewIssue[] } {
  return {
    ...extraction,
    reviewIssues: apiReviewIssues(extraction.reviewIssues),
  };
}
