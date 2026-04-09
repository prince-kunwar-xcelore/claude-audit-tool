# Plan: `pr-audit` — GitHub PR Review CLI using Claude

## Context
Build a standalone CLI tool that fetches a GitHub PR, sends its diff to Claude for review, then posts the results back as a native GitHub PR review (inline comments + summary). Uses existing `gh` CLI auth — no new token setup required.

---

## Project Location
`/home/dell-4xz8ls3/Projects/Personal/pr-audit/`

---

## Tech Stack
- **Runtime:** Node.js + TypeScript (ESM, `"type": "module"`)
- **Package manager:** pnpm (matches existing projects)
- **GitHub auth:** `gh` CLI via `child_process.execSync` — no Octokit needed
- **AI:** `claude -p` CLI (Claude Code non-interactive mode) — uses existing Claude.ai subscription, no API key
- **Diff parsing:** `parse-diff` npm package (has built-in TS types)
- **CLI parsing:** `process.argv` directly — no `commander` (single arg, no flags)

---

## File Structure
```
pr-audit/
├── package.json
├── tsconfig.json
├── .gitignore
└── src/
    ├── index.ts            # CLI entry: parse args, orchestrate
    ├── types.ts            # Shared interfaces
    ├── github.ts           # gh CLI calls: fetch PR data, post review
    ├── diff.ts             # Unified diff → per-file line maps, chunking
    └── claude.ts           # Build prompt, call claude -p, parse response
```

---

## Invocation
```bash
pr-audit owner/repo#123
pr-audit https://github.com/owner/repo/pull/123
```

---

## Data Flow

```
1. PARSE ARGS      index.ts
   └── Regex extract: owner, repo, PR number from arg

2. FETCH PR DATA   github.ts
   ├── gh pr view --json title,body,headRefOid
   └── gh pr diff --patch  →  raw unified diff string

3. PARSE DIFF      diff.ts
   ├── parse-diff(rawDiff) → File[]
   ├── Filter out: lock files, *.min.js, dist/**, .next/**
   ├── Build commentableLines: Set<number> per file (lines in diff context)
   └── Chunk files into batches of ≤600 changed lines

4. CLAUDE REVIEW   claude.ts  (one call per batch)
   ├── Build full prompt string (system rules + PR content)
   ├── execSync: claude -p  (prompt piped via stdin)
   └── Parse stdout → { summary, verdict, comments[] }

5. MAP COMMENTS    diff.ts
   └── Validate each comment's line against commentableLines set

6. POST REVIEW     github.ts
   └── gh api POST /repos/{owner}/{repo}/pulls/{n}/reviews --input -
```

---

## Claude Invocation

**How it works:**
```ts
const prompt = buildPrompt(prData, files);
const result = execSync(`claude -p`, {
  input: prompt,          // pipe prompt via stdin
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'inherit']  // stderr passthrough for auth errors
});
```

`claude -p` reads from stdin when no prompt arg is given, runs non-interactively, and writes the response to stdout. Uses the user's existing Claude Code auth (Claude.ai subscription).

**Prompt instructs Claude to output ONLY valid JSON:**
```
You are a senior software engineer reviewing a GitHub PR.
Output ONLY valid JSON — no prose, no markdown fences.

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
- Ignore style/formatting
- Be concise (1-3 sentences per comment)
```

---

## GitHub Review API

- Use `line` + `side: "RIGHT"` (modern API, not deprecated `position`)
- Only comment on lines present in the diff (context or added lines)
- Post a **single** review per PR (merge all batch results first)
- Payload posted via `gh api --method POST ... --input -` with JSON on stdin

```json
{
  "commit_id": "<headRefOid>",
  "body": "<Claude summary>",
  "event": "REQUEST_CHANGES",
  "comments": [{ "path": "...", "line": 42, "side": "RIGHT", "body": "..." }]
}
```

---

## Large Diff Handling

- **Threshold:** 600 changed lines per Claude call (quality limit, not token limit)
- **Strategy:** chunk by whole files (never split a file mid-way)
- **Oversized single files:** truncate patch to first 600 changed lines, add note
- **Lock files / generated files:** skip entirely before chunking
- **Multiple batches:** add 500ms delay between Claude calls; merge all comments before posting one final review

---

## Implementation Order

1. `src/types.ts` — interfaces: `PrRef`, `PrData`, `ParsedFile`, `ReviewComment`, `ReviewOutput`
2. `src/diff.ts` — pure data: diff parsing, line map, file filtering, chunking
3. `src/github.ts` — `fetchPr()` + `postReview()` wrappers around `gh` CLI
4. `src/claude.ts` — `buildPrompt()`, `callClaude()`, `parseClaudeResponse()`
5. `src/index.ts` — wire all modules, `#!/usr/bin/env node` shebang
6. `package.json` + `tsconfig.json` — bin entry, build scripts

---

## Verification
```bash
cd pr-audit
pnpm install
pnpm build
node dist/index.js owner/repo#1   # test with a real PR
```

Check: review appears on the PR with inline comments and a summary body.

---

## Key Pitfalls
- **`claude -p` stdin:** use `execSync('claude -p', { input: prompt, encoding: 'utf8' })` — no shell needed
- **`gh api` stdin:** use `execSync('gh api ...', { input: Buffer.from(json) })` — not a shell pipe
- **Claude not logged in:** `execSync` stderr passthrough will surface auth errors naturally
- **Invalid JSON from Claude:** wrap `JSON.parse` in try/catch, log raw stdout on failure
- **Line not in diff:** drop the comment silently, log a warning — prevents 422 from GitHub
- **Empty comments array:** handle cleanly — post `APPROVE` review with summary only
- **No `ANTHROPIC_API_KEY` needed:** the tool relies solely on `claude` CLI being installed and authenticated
