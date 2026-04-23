import { execSync } from 'child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PrData, ParsedFile, ReviewOutput, TokenUsage, BatchResult } from './types.js';
import { renderDiffForPrompt } from './diff.js';
import { log } from './logger.js';

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
  structured_output?: ReviewOutput;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
}

/**
 * Write credentials to a temp HOME directory so the claude CLI can find them
 * in ~/.claude/.credentials.json. Returns the temp dir path; caller must clean up.
 *
 * Accepts either a full credentials JSON string (from claude-token-proxy ≥ v2)
 * or a bare access token (legacy). The CLI requires the complete credentials
 * object (accessToken, expiresAt, scopes, etc.) — a bare token causes
 * "Not logged in" errors.
 */
function makeTempHome(credentialsOrToken: string): string {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-home-'));
  const claudeDir = path.join(tempHome, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true, mode: 0o700 });

  // Detect whether we received full credentials JSON or a bare token string
  let credentialsJson: string;
  try {
    const parsed = JSON.parse(credentialsOrToken);
    if (parsed?.claudeAiOauth?.accessToken) {
      // Full credentials object — use as-is
      credentialsJson = credentialsOrToken;
    } else {
      // Some other JSON — treat the raw string as a token
      credentialsJson = JSON.stringify({
        claudeAiOauth: {
          accessToken: credentialsOrToken,
          expiresAt: Date.now() + 24 * 3600 * 1000,
        },
      });
    }
  } catch {
    // Not JSON — treat as a bare access token (legacy proxy)
    credentialsJson = JSON.stringify({
      claudeAiOauth: {
        accessToken: credentialsOrToken,
        expiresAt: Date.now() + 24 * 3600 * 1000,
      },
    });
  }

  fs.writeFileSync(
    path.join(claudeDir, '.credentials.json'),
    credentialsJson,
    { mode: 0o600 }
  );
  return tempHome;
}

export function callClaude(prompt: string, model: string, authToken = ''): BatchResult {
  log.debug(`Claude prompt:\n${prompt}`);

  let tempHome: string | null = null;
  const env = authToken
    ? (() => { tempHome = makeTempHome(authToken); return { ...process.env, HOME: tempHome }; })()
    : process.env;

  let raw: string;
  try {
    raw = execSync(
      `claude -p --model ${model} --output-format json --json-schema '${OUTPUT_SCHEMA}'`,
      {
        input: prompt,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 10 * 1024 * 1024,
        timeout: 5 * 60 * 1000, // 5 min hard cap per batch
        env,
      }
    );
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    log.error(`claude CLI error: ${e.message}`);
    if (e.stderr) log.error(`stderr: ${e.stderr.trim()}`);
    if (e.stdout) log.error(`stdout: ${e.stdout.trim()}`);
    throw err;
  } finally {
    if (tempHome) fs.rmSync(tempHome, { recursive: true, force: true });
  }

  log.debug(`Claude raw envelope:\n${raw.trim()}`);

  let envelope: ClaudeEnvelope;
  try {
    envelope = JSON.parse(raw.trim()) as ClaudeEnvelope;
  } catch {
    log.error('[error] Failed to parse claude envelope:');
    log.error(raw.trim().slice(0, 500));
    throw new Error('Failed to parse claude CLI JSON envelope');
  }

  if (envelope.is_error) {
    throw new Error(`Claude returned an error: ${envelope.result}`);
  }

  // --json-schema puts the parsed output in structured_output; result is empty
  let review: ReviewOutput;
  if (envelope.structured_output) {
    review = envelope.structured_output;
  } else {
    try {
      review = JSON.parse(envelope.result) as ReviewOutput;
    } catch {
      log.error('[error] Claude result is not valid JSON:');
      log.error(envelope.result.slice(0, 500));
      throw new Error('Failed to parse Claude review JSON');
    }
  }

  log.debug(`Claude parsed ${review.comments.length} comment(s), verdict: ${review.verdict}`);
  for (const c of review.comments) {
    log.debug(`  [${c.severity}] ${c.path}:${c.line} — ${c.body}`);
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

export function synthesizeSummaries(
  prTitle: string,
  summaries: string[],
  verdict: ReviewOutput['verdict'],
  model: string,
  authToken = ''
): string {
  const prompt = `You are a senior software engineer. A GitHub PR was reviewed in ${summaries.length} batches.
Below are the individual batch summaries. Write a single concise overall review summary (2-4 sentences) that synthesizes the key findings. Do not repeat yourself. Focus on the most important issues found.

PR Title: ${prTitle}
Overall verdict: ${verdict}

Batch summaries:
${summaries.map((s, i) => `[Batch ${i + 1}]: ${s}`).join('\n\n')}

Output ONLY the summary text — no JSON, no markdown, no labels.`;

  log.debug(`Synthesis prompt:\n${prompt}`);

  let tempHome: string | null = null;
  const env = authToken
    ? (() => { tempHome = makeTempHome(authToken); return { ...process.env, HOME: tempHome }; })()
    : process.env;

  let raw: string;
  try {
    raw = execSync(`claude -p --model ${model}`, {
      input: prompt,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
      timeout: 2 * 60 * 1000, // 2 min cap for synthesis
      env,
    });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    log.error(`claude CLI error (synthesis): ${e.message}`);
    if (e.stderr) log.error(`stderr: ${e.stderr.trim()}`);
    throw err;
  } finally {
    if (tempHome) fs.rmSync(tempHome, { recursive: true, force: true });
  }

  const summary = raw.trim();
  log.debug(`Synthesized summary:\n${summary}`);
  return summary;
}

export function mergeResults(results: BatchResult[]): { review: ReviewOutput; totalUsage: TokenUsage } {
  const verdictPriority = {
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
