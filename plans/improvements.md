# pr-audit Improvement Plan

## Priority Order

---

### 1. Fix `--patch` flag (file count inflation)

**Problem:** `gh pr diff --patch` returns intermediate per-commit diffs, inflating file count from 24 to 94 for a typical PR. GitHub's UI shows the net result (base → HEAD), which is what we want.

**Fix:** Drop `--patch` from `github.ts`. `gh pr diff` without the flag returns the correct squashed diff.

```diff
- const diff = execSync(`gh pr diff ${number} --repo ${repoSlug} --patch`, {
+ const diff = execSync(`gh pr diff ${number} --repo ${repoSlug}`, {
```

---

### 2. Retry logic on batch failure

**Problem:** If one batch fails (transient API error, rate limit, etc.), the entire run dies and results from already-completed batches are lost.

**Fix:** Wrap `callClaude()` in a retry loop with exponential backoff (e.g. 3 attempts: 2s → 4s → 8s). Only throw after all retries are exhausted.

```
attempt 1 → fail → wait 2s
attempt 2 → fail → wait 4s
attempt 3 → fail → throw
```

---

### 3. Fix batch size measurement

**Problem:** `countChangedLines()` only counts `add` type lines, but the prompt rendered to Claude includes context lines (unchanged lines around each hunk). A "600 changed line" batch can be 2–3x larger in actual tokens. Batches can silently exceed Claude's context budget.

**Fix:** Measure batch size by total lines rendered in the prompt (additions + context lines), not just additions. Update `countChangedLines()` or introduce a `countRenderedLines()` helper used in `chunkFiles()`.

---

### 4. Handle large file truncation transparently

**Problem:** Files with >600 changed lines are silently truncated. Claude reviews partial code without knowing it's incomplete — it can miss bugs in the truncated half or make incorrect assumptions.

**Fix:** Either:
- Split oversized files into sub-batches (preferred), or
- Append a comment in the rendered diff: `// [truncated — showing first 600 of N changed lines]`

so Claude knows the file is partial.

---

### 5. Synthesized final summary

**Problem:** Merging N batch summaries by concatenating with `\n\n` produces a wall of text posted to GitHub. Nine summaries = nine separate paragraphs, potentially repetitive.

**Fix:** After all batches complete, collect all batch summaries and make one final Claude call to synthesize them into a single coherent review summary. The batch summaries become input context, not the final output.

```
batches 1..N → individual summaries
→ final Claude call: "synthesize these into one concise review summary"
→ single summary posted to GitHub
```

---

### 6. Cost estimate before running

**Problem:** On large PRs the tool silently spends money with no forewarning. Users have no way to gauge cost before committing.

**Fix:** After parsing the diff but before calling Claude, estimate token count from rendered prompt size and print an estimated cost range. Optionally prompt `Proceed? (y/n)` when estimated cost exceeds a configurable threshold (e.g. `$0.50`).

---

### 7. Configurable model

**Problem:** `claude-sonnet-4-6` is hardcoded. No way to use a cheaper model for low-stakes PRs or a more capable one for critical reviews.

**Fix:** Add a `--model` CLI flag (default: `claude-sonnet-4-6`). Pass it through to `callClaude()`.

```bash
pr-audit owner/repo#123 --model claude-opus-4-5
```

---

## Summary Table

| # | Issue | Impact | Effort |
|---|-------|--------|--------|
| 1 | `--patch` flag inflates file count | High — wastes tokens, wrong batching | Trivial |
| 2 | No retry on batch failure | High — one transient error kills the run | Low |
| 3 | Batch size measured in additions only | Medium — batches can exceed context budget | Low |
| 4 | Large files silently truncated | Medium — Claude reviews incomplete code | Medium |
| 5 | Naive summary concatenation | Medium — poor UX on GitHub review | Medium |
| 6 | No cost estimate | Low — surprise spend on large PRs | Low |
| 7 | Hardcoded model | Low — flexibility | Trivial |
