# pr-audit

CLI tool that fetches a PR/MR, sends its diff to Claude for review, and posts the results back as a native review with inline comments and a summary.

Supports multiple git providers — currently GitHub, with GitLab coming soon.

No API keys required — uses your existing `claude` CLI auth and provider CLI auth.

## Prerequisites

- [Claude Code CLI](https://claude.ai/code) — installed and authenticated
- A supported git provider CLI, installed and authenticated:
  - **GitHub**: [GitHub CLI](https://cli.github.com/) (`gh`)
  - **GitLab** (coming soon): [GLab CLI](https://gitlab.com/gitlab-org/cli) (`glab`)
- Node.js 18+, pnpm

## Install

```bash
pnpm install
pnpm build
pnpm link --global
```

## Usage

```bash
# GitHub
pr-audit owner/repo#123
pr-audit https://github.com/owner/repo/pull/123

# GitLab (coming soon)
pr-audit group/project!123
pr-audit https://gitlab.com/group/project/-/merge_requests/123

# Options
pr-audit owner/repo#123 --model claude-opus-4-5        # different Claude model (default: claude-sonnet-4-6)
pr-audit owner/repo#123 --auth-token sk-ant-...        # specific auth token
pr-audit owner/repo#123 --provider github              # explicit provider override
```

The provider is auto-detected from the input format (`#` → GitHub, `!` → GitLab, URL hostname). Use `--provider` to override when needed (e.g. self-hosted instances).

## How it works

1. Detects the git provider from the input format and fetches PR/MR metadata + diff via the provider's CLI
2. Filters out lock files and generated files
3. Prints a cost estimate based on diff size before any Claude calls
4. Chunks the diff into batches (≤1000 rendered lines each), truncating files over 600 added lines with a notice so Claude knows the file is partial
5. Sends each batch to Claude (`claude -p`) with a structured JSON prompt — failed batches are retried up to 3 times with exponential backoff
6. Synthesizes all batch summaries into a single coherent review summary via a final Claude call
7. Posts a native review with inline comments and the synthesized summary back to the provider

## Run logs

Every run is logged to `~/.pr-audit/logs/` with the filename pattern:

```
YYYY-MM-DDTHH-MM-SS_SLUG_PRNUM.log
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
