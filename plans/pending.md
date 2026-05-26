# Pending Tasks

## 1. GitLab Provider

**Status:** Not started
**Issue:** —
**Files:** `src/providers/gitlab.ts`, `src/provider.ts` (register in `resolveProvider`)

Implement `GitLabProvider` class implementing `GitProvider`. Key differences from GitHub:

- Uses `glab` CLI (`glab mr view`, `glab mr diff`)
- MR metadata: `description` (not `body`), `diff_refs.head_sha` (not `headRefOid`)
- No atomic review API — post inline comments as discussion threads (`/projects/:id/merge_requests/:iid/discussions`), summary as a note, approval via `/approve` endpoint
- `REQUEST_CHANGES` has no GitLab equivalent — post summary with "Changes Requested" heading
- Need `base_sha`/`start_sha` from `diff_refs` for inline comments — store in `PrData.providerMeta`
- Project ID must be URL-encoded in API paths (`group%2Fproject`)
- Self-hosted support via `GITLAB_HOST` env var (handled by `glab` CLI)

Auto-detection already wired: `group/project!123` and `gitlab.com` URLs match in `resolveProvider()` but `createProvider()` throws "unsupported" until this is built.

---

## 2. Write Tests

**Status:** Not started
**Issue:** —
**Files:** `test/` directory (new)

Mocks exist (`src/engines/mock.ts`, `src/mocks/provider.ts`) but no test files yet. Tests to write:

- **Diff parsing** — `parseDiffString()`, `chunkFiles()`, `validateComments()` with fixture diffs
- **Prompt building** — `buildPrompt()`, `buildSynthesisPrompt()` output correctness
- **Result merging** — `mergeResults()` verdict priority, token aggregation
- **Provider resolution** — `resolveProvider()` with GitHub URLs, shorthand, GitLab patterns, invalid input
- **Engine resolution** — `resolveEngine()` valid/invalid names, `--model` requires `--engine` guard
- **End-to-end** — full pipeline using MockProvider + MockEngine, verify postReview is called with correct args

Need to pick a test runner (vitest recommended — fast, ESM-native, TS support out of box).

---

## 3. Additional Review Engines

**Status:** Analysis done, not started
**Issue:** —
**Files:** `src/engines/<name>.ts`, `src/engine.ts` (register in `resolveEngine`)

The `ReviewEngine` interface is ready. Potential engines:

| Engine | `review()` | `synthesize()` | Auth | Structured output |
|--------|-----------|----------------|------|-------------------|
| **OpenAI API** | `POST /chat/completions` with `response_format` | Same endpoint | `OPENAI_API_KEY` | `response_format: { type: "json_schema" }` |
| **Ollama** | `POST /api/generate` with `format: "json"` | Same, no schema | None (local) | No schema enforcement — validate/retry |
| **Anthropic API** | Direct API with tool use | Direct API | `ANTHROPIC_API_KEY` | Via tool use or text parsing |

Each engine must:
- Implement `review(prompt, model): BatchResult` returning valid `ReviewOutput`
- Implement `synthesize(prompt, model): string` returning plain text
- Set `defaultModel` (e.g. `gpt-4o` for OpenAI, `llama3` for Ollama)
- Handle its own auth, retries, and response parsing
