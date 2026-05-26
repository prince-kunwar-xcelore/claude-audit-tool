# Write Tests

**Status:** Not started

**Files:** `test/` directory (new)

Mocks exist (`src/engines/mock.ts`, `src/mocks/provider.ts`) but no test files yet. Tests to write:

- **Diff parsing** — `parseDiffString()`, `chunkFiles()`, `validateComments()` with fixture diffs
- **Prompt building** — `buildPrompt()`, `buildSynthesisPrompt()` output correctness
- **Result merging** — `mergeResults()` verdict priority, token aggregation
- **Provider resolution** — `resolveProvider()` with GitHub URLs, shorthand, GitLab patterns, invalid input
- **Engine resolution** — `resolveEngine()` valid/invalid names, `--model` requires `--engine` guard
- **End-to-end** — full pipeline using MockProvider + MockEngine, verify postReview is called with correct args

Need to pick a test runner (vitest recommended — fast, ESM-native, TS support out of box).
