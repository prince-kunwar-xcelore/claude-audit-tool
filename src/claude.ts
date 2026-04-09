import { execSync } from 'child_process';
import type { PrData, ParsedFile, ReviewOutput } from './types.js';
import { renderDiffForPrompt } from './diff.js';

const SYSTEM_RULES = `You are a senior software engineer reviewing a GitHub PR.
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

export function buildPrompt(prData: PrData, files: ParsedFile[]): string {
  const diff = renderDiffForPrompt(files);

  return `${SYSTEM_RULES}

PR Title: ${prData.title}

PR Description:
${prData.body || '(none)'}

Diff:
${diff}`;
}

export function callClaude(prompt: string): ReviewOutput {
  let raw: string;
  try {
    raw = execSync('claude -p --model claude-sonnet-4-6', {
      input: prompt,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'inherit'],
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    throw new Error(`claude CLI failed: ${(err as Error).message}`);
  }

  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as ReviewOutput;
  } catch {
    console.error('[error] Claude returned non-JSON output:');
    console.error(trimmed.slice(0, 500));
    throw new Error('Failed to parse Claude response as JSON');
  }
}

export function mergeReviews(reviews: ReviewOutput[]): ReviewOutput {
  if (reviews.length === 1) return reviews[0];

  const verdictPriority: Record<string, number> = {
    REQUEST_CHANGES: 2,
    COMMENT: 1,
    APPROVE: 0,
  };

  let topVerdict: ReviewOutput['verdict'] = 'APPROVE';
  const summaries: string[] = [];
  const allComments = reviews.flatMap((r) => r.comments);

  for (const r of reviews) {
    summaries.push(r.summary);
    if (verdictPriority[r.verdict] > verdictPriority[topVerdict]) {
      topVerdict = r.verdict;
    }
  }

  return {
    summary: summaries.join('\n\n'),
    verdict: topVerdict,
    comments: allComments,
  };
}
