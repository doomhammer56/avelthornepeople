import "server-only";
import type { ContentIssue } from "../../lib/content/contract.ts";
export class ContentError extends Error {
  readonly status: number;
  readonly issues: ContentIssue[];
  constructor(status: number, issues: ContentIssue[] = []) {
    super("Content request failed");
    this.status = status;
    this.issues = issues.slice(0, 20);
  }
}
