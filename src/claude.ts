import type {
  PrData,
  ParsedFile,
  ReviewOutput,
  TokenUsage,
  BatchResult,
} from "./types.js";
import { renderDiffForPrompt } from "./diff.js";

function systemRules(reviewTerm: string): string {
  return `You are a senior software engineer reviewing a ${reviewTerm}.
Output ONLY valid JSON — no prose, no markdown fences, no explanation.

Schema:
{
  "summary": "string",
  "verdict": "APPROVE" | "COMMENT" | "REQUEST_CHANGES",
  "comments": [
    { "path": "file.ts", "line": 42, "severity": "critical|warning|suggestion", "body": "string" }
  ]
}

Rules:
- Only comment on added lines ('+' in diff)
- Focus on: bugs, security issues, logic errors, missing error handling
- Ignore style, formatting, and nitpicks
- Be concise (1-3 sentences per comment)
- If no issues found, return an empty comments array and verdict APPROVE`;
}

export function buildPrompt(prData: PrData, files: ParsedFile[], reviewTerm: string): string {
  const diff = renderDiffForPrompt(files);

  return `${systemRules(reviewTerm)}

PR Title: ${prData.title}

PR Description:
${prData.body || "(none)"}

Diff:
${diff}`;
}

export const OUTPUT_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    summary: { type: "string" },
    verdict: {
      type: "string",
      enum: ["APPROVE", "COMMENT", "REQUEST_CHANGES"],
    },
    comments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          line: { type: "number" },
          severity: {
            type: "string",
            enum: ["critical", "warning", "suggestion"],
          },
          body: { type: "string" },
        },
        required: ["path", "line", "severity", "body"],
      },
    },
  },
  required: ["summary", "verdict", "comments"],
});

export function buildSynthesisPrompt(
  prTitle: string,
  summaries: string[],
  verdict: ReviewOutput["verdict"],
  reviewTerm = "pull request",
): string {
  return `You are a senior software engineer. A ${reviewTerm} was reviewed in ${summaries.length} batches.
Below are the individual batch summaries. Write a single concise overall review summary (2-4 sentences) that synthesizes the key findings. Do not repeat yourself. Focus on the most important issues found.

PR Title: ${prTitle}
Overall verdict: ${verdict}

Batch summaries:
${summaries.map((s, i) => `[Batch ${i + 1}]: ${s}`).join("\n\n")}

Output ONLY the summary text — no JSON, no markdown, no labels.`;
}

export function mergeResults(results: BatchResult[]): {
  review: ReviewOutput;
  totalUsage: TokenUsage;
} {
  const verdictPriority = {
    REQUEST_CHANGES: 2,
    COMMENT: 1,
    APPROVE: 0,
  };

  let topVerdict: ReviewOutput["verdict"] = "APPROVE";
  const summaries: string[] = [];
  const allComments = results.flatMap((r) => r.review.comments);
  const totalUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUSD: 0,
  };

  for (const { review, usage } of results) {
    summaries.push(review.summary);
    if (verdictPriority[review.verdict] > verdictPriority[topVerdict]) {
      topVerdict = review.verdict;
    }
    totalUsage.inputTokens += usage.inputTokens;
    totalUsage.outputTokens += usage.outputTokens;
    totalUsage.cacheReadTokens += usage.cacheReadTokens;
    totalUsage.cacheCreationTokens += usage.cacheCreationTokens;
    totalUsage.costUSD += usage.costUSD;
  }

  return {
    review: {
      summary: summaries.join("\n\n"),
      verdict: topVerdict,
      comments: allComments,
    },
    totalUsage,
  };
}
