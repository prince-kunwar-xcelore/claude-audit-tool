# pr-audit

CLI tool that reviews pull requests / merge requests using AI and posts results back as native reviews with inline comments.

## Architecture

```
src/
  index.ts              CLI entry point, orchestration loop
  types.ts              Shared types: PrRef, PrData, ReviewOutput, BatchResult, etc.
  provider.ts           GitProvider interface + resolveProvider() auto-detection
  engine.ts             ReviewEngine interface + resolveEngine() factory
  claude.ts             Prompt building (buildPrompt, buildSynthesisPrompt) + mergeResults
  diff.ts               Unified diff parsing, file filtering, chunking, comment validation
  logger.ts             Dual-stream logging (console + file)
  providers/
    github.ts           GitHubProvider — fetches via `gh` CLI, posts via GitHub API
  engines/
    claude-cli.ts       ClaudeCliEngine — calls `claude -p` CLI
    mock.ts             MockEngine — canned responses for testing
  mocks/
    provider.ts         MockProvider — canned PR data for testing
```

## Key Abstractions

**GitProvider** (`src/provider.ts`):
- `fetchPr(ref: PrRef): PrData` — get PR metadata + unified diff
- `postReview(ref, headSha, review, comments)` — post review back to platform
- Auto-detected from input: `owner/repo#123` → GitHub, `group/project!123` → GitLab

**ReviewEngine** (`src/engine.ts`):
- `review(prompt, model): BatchResult` — structured JSON review of a diff batch
- `synthesize(prompt, model): string` — plain text summary synthesis
- `defaultModel` — each engine knows its default (e.g. `claude-sonnet-4-6`)

## Data Flow

```
parseArgs → resolveProvider + resolveEngine
  → provider.fetchPr()
  → parseDiffString() → chunkFiles()
  → for each batch: buildPrompt() → engine.review()
  → mergeResults()
  → if multi-batch: buildSynthesisPrompt() → engine.synthesize()
  → validateComments()
  → provider.postReview()
```

## CLI Flags

```
pr-audit <ref> [--engine <engine>] [--model <model>] [--auth-token <token>] [--provider <provider>]
```

- `--engine`: Review engine (default: `claude-cli`). Required if `--model` is set.
- `--model`: Model override. Uses engine's `defaultModel` if omitted.
- `--auth-token`: Auth token passed to the engine (e.g. Claude CLI credentials).
- `--provider`: Explicit git provider override (default: auto-detected from input).

## Tech Stack

- TypeScript (ESM, strict mode, target ES2022)
- pnpm, compiled with tsc to `dist/`
- Runtime dependency: `parse-diff`
- Testing: `vitest`
- External CLIs: `gh` (GitHub), `claude` (Claude Code), `glab` (GitLab, future)

## Build & Run

```bash
pnpm install && pnpm build       # compile
pnpm dev owner/repo#123          # run with tsx (no build needed)
pnpm link --global               # install as global CLI
```

## Logs

Written to `~/.pr-audit/logs/YYYY-MM-DDTHH-MM-SS_SLUG_NUM.log` with INFO + DEBUG levels.

## Tests

```bash
pnpm test                        # run once
pnpm test:watch                  # watch mode
```

Tests use `MockEngine` and `MockProvider` for isolation. The null logger is injected via `test/setup.ts`.

## Maintenance

After any change that affects CLI usage, flags, architecture, build commands, or tech stack, update both `CLAUDE.md` and `README.md` to reflect the change.

## Pending Work

See `plans/` for outstanding tasks:
- `plans/gitlab-provider.md` — GitLab provider implementation
- `plans/additional-engines.md` — OpenAI, Ollama, Anthropic API engines
