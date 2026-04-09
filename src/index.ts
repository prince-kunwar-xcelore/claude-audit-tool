#!/usr/bin/env node
import process from 'node:process';
import { fetchPr } from './github.js';
import { parseDiffString, chunkFiles, validateComments } from './diff.js';
import { buildPrompt, callClaude, mergeResults } from './claude.js';
import { postReview } from './github.js';
import { initLogger, log } from './logger.js';
import type { PrRef } from './types.js';

function parseArg(arg: string): PrRef {
  // owner/repo#123
  const shortMatch = arg.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (shortMatch) {
    return { owner: shortMatch[1], repo: shortMatch[2], number: parseInt(shortMatch[3], 10) };
  }

  // https://github.com/owner/repo/pull/123
  const urlMatch = arg.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2], number: parseInt(urlMatch[3], 10) };
  }

  throw new Error(
    `Invalid PR reference: "${arg}"\nExpected: owner/repo#123 or https://github.com/owner/repo/pull/123`
  );
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => T, retries = 3, label = ''): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return fn();
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = 2 ** attempt * 1000; // 2s, 4s
      log.warn(`${label} attempt ${attempt}/${retries} failed — retrying in ${delay / 1000}s...`);
      await sleep(delay);
    }
  }
  throw new Error('unreachable');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const modelIdx = args.indexOf('--model');
  const model = modelIdx !== -1 ? (args[modelIdx + 1] ?? 'claude-sonnet-4-6') : 'claude-sonnet-4-6';
  const positional = args.filter((_, i) => i !== modelIdx && i !== modelIdx + 1);
  const arg = positional[0];

  if (!arg) {
    console.error('Usage: pr-audit <owner/repo#123 | PR URL> [--model <model>]');
    process.exit(1);
  }

  const ref = parseArg(arg);
  const label = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}_${ref.owner}_${ref.repo}_${ref.number}`;
  initLogger(label);

  log.section('RUN START');
  log.debug(`Command: ${process.argv.join(' ')}`);
  log.info(`Model:    ${model}`);
  log.info(`Fetching PR ${ref.owner}/${ref.repo}#${ref.number}...`);
  console.log(`Logging to ${log.filePath}`);

  const prData = fetchPr(ref);
  log.info(`  Title: ${prData.title}`);
  log.debug(`  Body: ${prData.body.slice(0, 300)}${prData.body.length > 300 ? '…' : ''}`);
  log.debug(`  headRefOid: ${prData.headRefOid}`);

  const files = parseDiffString(prData.diff);
  if (files.length === 0) {
    log.info('No reviewable files found in diff. Exiting.');
    await log.close();
    process.exit(0);
  }
  log.info(`  Files to review: ${files.length}`);
  log.debug(`  Files: ${files.map((f) => f.path).join(', ')}`);

  const batches = chunkFiles(files);
  log.info(`  Batches: ${batches.length}`);

  const results = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const totalChanged = batch.reduce((s, f) => s + f.changedLineCount, 0);

    log.section(`Batch ${i + 1} / ${batches.length}`);
    log.info(`Reviewing batch ${i + 1}/${batches.length} (${totalChanged} changed lines)...`);
    log.debug(`  Files in batch: ${batch.map((f) => `${f.path} (${f.changedLineCount} lines)`).join(', ')}`);

    const prompt = buildPrompt(prData, batch);
    const result = await withRetry(
      () => callClaude(prompt, model),
      3,
      `Batch ${i + 1}/${batches.length}`
    );
    results.push(result);

    const u = result.usage;
    const tokenLine =
      `  Tokens: ${u.inputTokens} in / ${u.outputTokens} out` +
      (u.cacheReadTokens ? ` / ${u.cacheReadTokens} cache-read` : '') +
      `  Cost: $${u.costUSD.toFixed(4)}`;
    log.info(tokenLine);

    if (i < batches.length - 1) {
      await sleep(500);
    }
  }

  const { review: merged, totalUsage } = mergeResults(results);

  if (batches.length > 1) {
    const totalLine =
      `Total — Tokens: ${totalUsage.inputTokens} in / ${totalUsage.outputTokens} out` +
      (totalUsage.cacheReadTokens ? ` / ${totalUsage.cacheReadTokens} cache-read` : '') +
      `  Cost: $${totalUsage.costUSD.toFixed(4)}`;
    log.info(totalLine);
  }

  const validComments = validateComments(merged.comments, files);
  if (validComments.length < merged.comments.length) {
    log.warn(`[warn] Dropped ${merged.comments.length - validComments.length} comment(s) with invalid line refs`);
  }

  log.section('POSTING REVIEW');
  log.info(`Posting review (${merged.verdict})...`);
  postReview(ref, prData.headRefOid, merged, validComments);

  log.section('RUN SUMMARY');
  log.info(`Verdict:   ${merged.verdict}`);
  log.info(`Comments:  ${validComments.length} posted, ${merged.comments.length - validComments.length} dropped`);
  log.info(`Total cost: $${totalUsage.costUSD.toFixed(4)}`);
  log.info(`Log file:  ${log.filePath}`);

  await log.close();
}

main().catch(async (err) => {
  log.error(`[fatal] ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  await log.close();
  process.exit(1);
});
