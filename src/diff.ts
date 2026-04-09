import parseDiff from 'parse-diff';
import type { ParsedFile, ReviewComment } from './types.js';
import { log } from './logger.js';

const SKIP_PATTERNS = [
  /package-lock\.json$/,
  /pnpm-lock\.yaml$/,
  /yarn\.lock$/,
  /\.lock$/,
  /\.min\.js$/,
  /^dist\//,
  /^\.next\//,
  /^build\//,
  /^out\//,
];

const MAX_ADDITIONS_PER_FILE = 600;      // per-file truncation: max added lines before cutting
const MAX_RENDERED_LINES_PER_BATCH = 1000; // per-batch limit: total lines actually sent to Claude

function shouldSkip(path: string): boolean {
  return SKIP_PATTERNS.some((p) => p.test(path));
}

function countChangedLines(chunks: parseDiff.Chunk[]): number {
  let count = 0;
  for (const chunk of chunks) {
    for (const change of chunk.changes) {
      if (change.type === 'add') count++;
    }
  }
  return count;
}

function countRenderedLines(chunks: parseDiff.Chunk[]): number {
  let count = 0;
  for (const chunk of chunks) {
    count += chunk.changes.length; // add + del + normal (context) — what actually goes to Claude
  }
  return count;
}

function buildCommentableLines(chunks: parseDiff.Chunk[]): Set<number> {
  const lines = new Set<number>();
  for (const chunk of chunks) {
    for (const change of chunk.changes) {
      if (change.type === 'add') {
        lines.add(change.ln);
      } else if (change.type === 'normal') {
        lines.add(change.ln2);
      }
    }
  }
  return lines;
}

function truncateChunks(chunks: parseDiff.Chunk[], maxChanged: number): parseDiff.Chunk[] {
  const result: parseDiff.Chunk[] = [];
  let count = 0;

  for (const chunk of chunks) {
    if (count >= maxChanged) break;
    const trimmedChanges: parseDiff.Change[] = [];
    for (const change of chunk.changes) {
      if (change.type === 'add') {
        if (count >= maxChanged) break;
        count++;
      }
      trimmedChanges.push(change);
    }
    result.push({ ...chunk, changes: trimmedChanges });
  }

  return result;
}

export function parseDiffString(rawDiff: string): ParsedFile[] {
  const files = parseDiff(rawDiff);
  const result: ParsedFile[] = [];

  for (const file of files) {
    const path = file.to ?? file.from ?? '';
    if (!path || path === '/dev/null') continue;
    if (shouldSkip(path)) {
      log.debug(`Skipping file: ${path}`);
      continue;
    }

    let chunks = file.chunks;
    let changedLineCount = countChangedLines(chunks);
    const truncated = changedLineCount > MAX_ADDITIONS_PER_FILE;

    if (truncated) {
      chunks = truncateChunks(chunks, MAX_ADDITIONS_PER_FILE);
      changedLineCount = MAX_ADDITIONS_PER_FILE;
    }

    result.push({
      path,
      chunks,
      commentableLines: buildCommentableLines(chunks),
      changedLineCount,
      renderedLineCount: countRenderedLines(chunks),
      truncated,
    });
  }

  return result;
}

export function chunkFiles(files: ParsedFile[]): ParsedFile[][] {
  const batches: ParsedFile[][] = [];
  let current: ParsedFile[] = [];
  let currentCount = 0;

  for (const file of files) {
    if (currentCount + file.renderedLineCount > MAX_RENDERED_LINES_PER_BATCH && current.length > 0) {
      batches.push(current);
      current = [];
      currentCount = 0;
    }
    current.push(file);
    currentCount += file.renderedLineCount;
  }

  if (current.length > 0) batches.push(current);

  return batches;
}

export function validateComments(
  comments: ReviewComment[],
  files: ParsedFile[]
): ReviewComment[] {
  const lineMap = new Map<string, Set<number>>();
  for (const file of files) {
    lineMap.set(file.path, file.commentableLines);
  }

  return comments.filter((c) => {
    const lines = lineMap.get(c.path);
    if (!lines) {
      log.warn(`[warn] dropping comment — unknown file: ${c.path}`);
      return false;
    }
    if (!lines.has(c.line)) {
      log.warn(`[warn] dropping comment — line ${c.line} not in diff: ${c.path}`);
      return false;
    }
    return true;
  });
}

export function renderDiffForPrompt(files: ParsedFile[]): string {
  const parts: string[] = [];

  for (const file of files) {
    parts.push(`--- ${file.path}`);
    for (const chunk of file.chunks) {
      parts.push(chunk.content);
      for (const change of chunk.changes) {
        const prefix =
          change.type === 'add' ? '+' : change.type === 'del' ? '-' : ' ';
        parts.push(`${prefix}${change.content.slice(1)}`);
      }
    }
    if (file.truncated) {
      parts.push(`\\ [file truncated — showing first ${MAX_ADDITIONS_PER_FILE} added lines only, remainder not reviewed]`);
    }
  }

  return parts.join('\n');
}
