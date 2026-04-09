import { execSync } from 'child_process';
import type { PrData, ParsedFile, ReviewOutput, TokenUsage, BatchResult } from './types.js';
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

const OUTPUT_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    summary: { type: 'string' },
    verdict: { type: 'string', enum: ['APPROVE', 'COMMENT', 'REQUEST_CHANGES'] },
    comments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          line: { type: 'number' },
          severity: { type: 'string', enum: ['critical', 'warning', 'suggestion'] },
          body: { type: 'string' },
        },
        required: ['path', 'line', 'severity', 'body'],
      },
    },
  },
  required: ['summary', 'verdict', 'comments'],
});

interface ClaudeEnvelope {
  type: string;
  is_error: boolean;
  result: string;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
}

export function callClaude(prompt: string): BatchResult {
  let raw: string;
  try {
    raw = execSync(
      `claude -p --model claude-sonnet-4-6 --output-format json --json-schema '${OUTPUT_SCHEMA}'`,
      {
        input: prompt,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'inherit'],
        maxBuffer: 10 * 1024 * 1024,
      }
    );
  } catch (err) {
    throw new Error(`claude CLI failed: ${(err as Error).message}`);
  }

  let envelope: ClaudeEnvelope;
  try {
    envelope = JSON.parse(raw.trim()) as ClaudeEnvelope;
  } catch {
    console.error('[error] Failed to parse claude envelope:');
    console.error(raw.trim().slice(0, 500));
    throw new Error('Failed to parse claude CLI JSON envelope');
  }

  if (envelope.is_error) {
    throw new Error(`Claude returned an error: ${envelope.result}`);
  }

  let review: ReviewOutput;
  try {
    review = JSON.parse(envelope.result) as ReviewOutput;
  } catch {
    console.error('[error] Claude result is not valid JSON:');
    console.error(envelope.result.slice(0, 500));
    throw new Error('Failed to parse Claude review JSON');
  }

  const usage: TokenUsage = {
    inputTokens: envelope.usage.input_tokens,
    outputTokens: envelope.usage.output_tokens,
    cacheReadTokens: envelope.usage.cache_read_input_tokens,
    cacheCreationTokens: envelope.usage.cache_creation_input_tokens,
    costUSD: envelope.total_cost_usd,
  };

  return { review, usage };
}

export function mergeResults(results: BatchResult[]): { review: ReviewOutput; totalUsage: TokenUsage } {
  const verdictPriority: Record<string, number> = {
    REQUEST_CHANGES: 2,
    COMMENT: 1,
    APPROVE: 0,
  };

  let topVerdict: ReviewOutput['verdict'] = 'APPROVE';
  const summaries: string[] = [];
  const allComments = results.flatMap((r) => r.review.comments);
  const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUSD: 0 };

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
    review: { summary: summaries.join('\n\n'), verdict: topVerdict, comments: allComments },
    totalUsage,
  };
}
