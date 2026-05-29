import type { GitProvider } from '../provider.js';
import type { PrRef, PrData, ReviewComment, ReviewOutput } from '../types.js';

export interface MockReviewCall {
  ref: PrRef;
  headSha: string;
  review: ReviewOutput;
  comments: ReviewComment[];
  dryRun: boolean;
}

const DEFAULT_PR_DATA: PrData = {
  title: 'Mock PR',
  body: 'Mock PR description.',
  headSha: 'abc123',
  diff: `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 const a = 1;
+const b = 2;
 const c = 3;
`,
};

export class MockProvider implements GitProvider {
  readonly name = 'Mock';
  readonly reviewTerm = 'pull request';
  readonly reviewCalls: MockReviewCall[] = [];

  constructor(private prData: PrData = DEFAULT_PR_DATA) {}

  fetchPr(_ref: PrRef): PrData {
    return this.prData;
  }

  postReview(
    ref: PrRef,
    headSha: string,
    review: ReviewOutput,
    comments: ReviewComment[],
    dryRun = false,
  ): void {
    this.reviewCalls.push({ ref, headSha, review, comments, dryRun });
  }
}
