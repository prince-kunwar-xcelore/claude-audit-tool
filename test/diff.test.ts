import { describe, it, expect } from 'vitest';
import './setup.js';
import { parseDiffString, chunkFiles, validateComments, renderDiffForPrompt } from '../src/diff.js';
import type { ParsedFile, ReviewComment } from '../src/types.js';

const SIMPLE_DIFF = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 const a = 1;
+const b = 2;
 const c = 3;
`;

const MULTI_FILE_DIFF = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1,2 +1,3 @@
 const x = 1;
+const y = 2;
 const z = 3;
diff --git a/bar.ts b/bar.ts
--- a/bar.ts
+++ b/bar.ts
@@ -1,1 +1,2 @@
 const m = 10;
+const n = 20;
`;

const LOCKFILE_DIFF = `diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,3 +1,4 @@
 {}
+{"new": "dep"}
 {}
`;

const DELETE_ONLY_DIFF = `diff --git a/old.ts b/old.ts
deleted file mode 100644
--- a/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-const removed = true;
-const gone = true;
`;

describe('parseDiffString', () => {
  it('parses a simple diff into one file', () => {
    const files = parseDiffString(SIMPLE_DIFF);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('file.ts');
    expect(files[0].changedLineCount).toBe(1);
    expect(files[0].truncated).toBe(false);
  });

  it('parses multiple files', () => {
    const files = parseDiffString(MULTI_FILE_DIFF);
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe('foo.ts');
    expect(files[1].path).toBe('bar.ts');
  });

  it('skips lock files', () => {
    const files = parseDiffString(LOCKFILE_DIFF);
    expect(files).toHaveLength(0);
  });

  it('skips files in dist/', () => {
    const diff = SIMPLE_DIFF.replace(/file\.ts/g, 'dist/file.js');
    const files = parseDiffString(diff);
    expect(files).toHaveLength(0);
  });

  it('skips minified JS', () => {
    const diff = SIMPLE_DIFF.replace(/file\.ts/g, 'bundle.min.js');
    const files = parseDiffString(diff);
    expect(files).toHaveLength(0);
  });

  it('skips deleted files (/dev/null)', () => {
    const files = parseDiffString(DELETE_ONLY_DIFF);
    expect(files).toHaveLength(0);
  });

  it('builds commentable lines from adds and context', () => {
    const files = parseDiffString(SIMPLE_DIFF);
    const lines = files[0].commentableLines;
    expect(lines.has(2)).toBe(true);  // the added line
    expect(lines.has(1)).toBe(true);  // context line (ln2)
    expect(lines.has(3)).toBe(true);  // context line (ln2)
  });

  it('counts rendered lines (all changes including context)', () => {
    const files = parseDiffString(SIMPLE_DIFF);
    expect(files[0].renderedLineCount).toBe(3); // 2 context + 1 add
  });

  it('truncates files exceeding max additions', () => {
    const lines = Array.from({ length: 700 }, (_, i) => `+const v${i} = ${i};`);
    const bigDiff = `diff --git a/big.ts b/big.ts
--- a/big.ts
+++ b/big.ts
@@ -0,0 +1,700 @@
${lines.join('\n')}
`;
    const files = parseDiffString(bigDiff);
    expect(files).toHaveLength(1);
    expect(files[0].truncated).toBe(true);
    expect(files[0].changedLineCount).toBe(600);
  });

  it('returns empty array for empty diff', () => {
    expect(parseDiffString('')).toHaveLength(0);
  });
});

describe('chunkFiles', () => {
  function makeFile(renderedLineCount: number, name = 'f.ts'): ParsedFile {
    return {
      path: name,
      chunks: [],
      commentableLines: new Set(),
      changedLineCount: renderedLineCount,
      renderedLineCount,
      truncated: false,
    };
  }

  it('puts small files in a single batch', () => {
    const files = [makeFile(100, 'a.ts'), makeFile(200, 'b.ts')];
    const batches = chunkFiles(files);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });

  it('splits files exceeding batch limit into multiple batches', () => {
    const files = [makeFile(600, 'a.ts'), makeFile(600, 'b.ts')];
    const batches = chunkFiles(files);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(1);
    expect(batches[1]).toHaveLength(1);
  });

  it('handles a single file that fills an entire batch', () => {
    const files = [makeFile(1000, 'big.ts')];
    const batches = chunkFiles(files);
    expect(batches).toHaveLength(1);
  });

  it('handles a single file exceeding the batch limit', () => {
    const files = [makeFile(1500, 'huge.ts')];
    const batches = chunkFiles(files);
    expect(batches).toHaveLength(1);
  });

  it('returns empty array for no files', () => {
    expect(chunkFiles([])).toHaveLength(0);
  });
});

describe('validateComments', () => {
  it('keeps comments on valid lines', () => {
    const files = parseDiffString(SIMPLE_DIFF);
    const comments: ReviewComment[] = [
      { path: 'file.ts', line: 2, severity: 'warning', body: 'check this' },
    ];
    expect(validateComments(comments, files)).toHaveLength(1);
  });

  it('drops comments on unknown files', () => {
    const files = parseDiffString(SIMPLE_DIFF);
    const comments: ReviewComment[] = [
      { path: 'unknown.ts', line: 1, severity: 'warning', body: 'nope' },
    ];
    expect(validateComments(comments, files)).toHaveLength(0);
  });

  it('drops comments on lines not in the diff', () => {
    const files = parseDiffString(SIMPLE_DIFF);
    const comments: ReviewComment[] = [
      { path: 'file.ts', line: 999, severity: 'critical', body: 'bad line' },
    ];
    expect(validateComments(comments, files)).toHaveLength(0);
  });

  it('handles mix of valid and invalid comments', () => {
    const files = parseDiffString(SIMPLE_DIFF);
    const comments: ReviewComment[] = [
      { path: 'file.ts', line: 2, severity: 'suggestion', body: 'ok' },
      { path: 'file.ts', line: 999, severity: 'critical', body: 'bad' },
      { path: 'nope.ts', line: 1, severity: 'warning', body: 'bad' },
    ];
    const valid = validateComments(comments, files);
    expect(valid).toHaveLength(1);
    expect(valid[0].body).toBe('ok');
  });
});

describe('renderDiffForPrompt', () => {
  it('renders file header and changes', () => {
    const files = parseDiffString(SIMPLE_DIFF);
    const rendered = renderDiffForPrompt(files);
    expect(rendered).toContain('--- file.ts');
    expect(rendered).toContain('+const b = 2;');
  });

  it('includes truncation notice for truncated files', () => {
    const lines = Array.from({ length: 700 }, (_, i) => `+const v${i} = ${i};`);
    const bigDiff = `diff --git a/big.ts b/big.ts
--- a/big.ts
+++ b/big.ts
@@ -0,0 +1,700 @@
${lines.join('\n')}
`;
    const files = parseDiffString(bigDiff);
    const rendered = renderDiffForPrompt(files);
    expect(rendered).toContain('[file truncated');
  });

  it('does not include truncation notice for normal files', () => {
    const files = parseDiffString(SIMPLE_DIFF);
    const rendered = renderDiffForPrompt(files);
    expect(rendered).not.toContain('[file truncated');
  });
});
