#!/usr/bin/env node
import { fetchPr } from './github.js';
import { parseDiffString, chunkFiles, validateComments } from './diff.js';
import { buildPrompt, callClaude, mergeReviews } from './claude.js';
import { postReview } from './github.js';
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

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: pr-audit <owner/repo#123 | PR URL>');
    process.exit(1);
  }

  const ref = parseArg(arg);
  console.log(`Fetching PR ${ref.owner}/${ref.repo}#${ref.number}...`);

  const prData = fetchPr(ref);
  console.log(`  Title: ${prData.title}`);

  const files = parseDiffString(prData.diff);
  if (files.length === 0) {
    console.log('No reviewable files found in diff. Exiting.');
    process.exit(0);
  }
  console.log(`  Files to review: ${files.length}`);

  const batches = chunkFiles(files);
  console.log(`  Batches: ${batches.length}`);

  const reviews = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const totalChanged = batch.reduce((s, f) => s + f.changedLineCount, 0);
    console.log(`\nReviewing batch ${i + 1}/${batches.length} (${totalChanged} changed lines)...`);

    const prompt = buildPrompt(prData, batch);
    const review = callClaude(prompt);
    reviews.push(review);

    if (i < batches.length - 1) {
      await sleep(500);
    }
  }

  const merged = mergeReviews(reviews);

  // Validate all comments against all files
  const validComments = validateComments(merged.comments, files);
  if (validComments.length < merged.comments.length) {
    console.warn(
      `[warn] Dropped ${merged.comments.length - validComments.length} comment(s) with invalid line refs`
    );
  }

  console.log(`\nPosting review (${merged.verdict})...`);
  postReview(ref, prData.headRefOid, merged, validComments);
}

main().catch((err) => {
  console.error('[fatal]', err instanceof Error ? err.message : err);
  process.exit(1);
});
