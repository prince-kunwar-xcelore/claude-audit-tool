# Additional Review Engines

**Status:** Analysis done, not started

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
