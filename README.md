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
```

## How it works

1. Fetches PR metadata and unified diff via `gh` CLI
2. Filters out lock files and generated files
3. Chunks the diff into batches of ≤600 changed lines
4. Sends each batch to Claude (`claude -p`) with a structured prompt
5. Merges results and posts a single review to GitHub via the PR Reviews API

## Development

```bash
pnpm dev owner/repo#123   # run with tsx (no build needed)
pnpm build                # compile to dist/
```
