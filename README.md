# pr-audit

CLI tool that fetches a GitHub PR, sends its diff to Claude for review, and posts the results back as a native GitHub PR review with inline comments and a summary.

No API keys required — uses your existing `claude` CLI auth and `gh` CLI auth.

## Prerequisites

- [Claude Code CLI](https://claude.ai/code) — installed and authenticated
- [GitHub CLI](https://cli.github.com/) (`gh`) — installed and authenticated
- Node.js 18+, pnpm

## Install

```bash
pnpm install
pnpm build
pnpm link --global
```

## Usage

```bash
pr-audit owner/repo#123
pr-audit https://github.com/owner/repo/pull/123

# Use a different Claude model (default: claude-sonnet-4-6)
pr-audit owner/repo#123 --model claude-opus-4-5

# Use a specific Anthropic API key (otherwise uses existing claude CLI auth)
pr-audit owner/repo#123 --auth-token sk-ant-...
```

## How it works

1. Fetches PR metadata and squashed base→HEAD diff via `gh` CLI
2. Filters out lock files and generated files
3. Prints a cost estimate based on diff size before any Claude calls
4. Chunks the diff into batches (≤1000 rendered lines each), truncating files over 600 added lines with a notice so Claude knows the file is partial
5. Sends each batch to Claude (`claude -p`) with a structured JSON prompt — failed batches are retried up to 3 times with exponential backoff
6. Synthesizes all batch summaries into a single coherent review summary via a final Claude call
7. Posts one native GitHub PR review with inline comments and the synthesized summary

## Run logs

Every run is logged to `~/.pr-audit/logs/` with the filename pattern:

```
YYYY-MM-DDTHH-MM-SS_OWNER_REPO_PRNUM.log
```

Each log captures the full execution trace at two levels:

- **INFO** — high-level flow: PR metadata, batch sizes, verdict, comment count, total cost
- **DEBUG** — full detail: Claude prompts, raw API responses, token usage per batch, individual comments, GitHub review payload

The log file path is printed at the end of every run.

```bash
# View latest run
cat ~/.pr-audit/logs/$(ls -1t ~/.pr-audit/logs/ | head -1)

# View only errors across all runs
grep "\[ERROR\]" ~/.pr-audit/logs/*.log

# View summaries across all runs
grep -A 5 "RUN SUMMARY" ~/.pr-audit/logs/*.log
```

## Development

```bash
pnpm dev owner/repo#123   # run with tsx (no build needed)
pnpm build                # compile to dist/
```
