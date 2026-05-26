# GitLab Provider

**Status:** Not started

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
