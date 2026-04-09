import { execSync } from 'child_process';
import type { PrRef, PrData, ReviewComment, ReviewOutput } from './types.js';
import { log } from './logger.js';

export function fetchPr(ref: PrRef): PrData {
  const { owner, repo, number } = ref;
  const repoSlug = `${owner}/${repo}`;

  log.debug(`gh pr view ${number} --repo ${repoSlug} --json title,body,headRefOid`);
  const metaRaw = execSync(
    `gh pr view ${number} --repo ${repoSlug} --json title,body,headRefOid`,
    { encoding: 'utf8' }
  );
  const meta = JSON.parse(metaRaw) as { title: string; body: string; headRefOid: string };
  log.debug(`PR metadata: ${JSON.stringify({ title: meta.title, headRefOid: meta.headRefOid, bodyLength: meta.body?.length ?? 0 })}`);

  log.debug(`gh pr diff ${number} --repo ${repoSlug} --patch`);
  const diff = execSync(`gh pr diff ${number} --repo ${repoSlug} --patch`, {
    encoding: 'utf8',
  });
  log.debug(`Diff fetched: ${diff.length} bytes`);

  return {
    title: meta.title,
    body: meta.body ?? '',
    headRefOid: meta.headRefOid,
    diff,
  };
}

export function postReview(
  ref: PrRef,
  headRefOid: string,
  review: ReviewOutput,
  comments: ReviewComment[]
): void {
  const { owner, repo, number } = ref;
  const endpoint = `/repos/${owner}/${repo}/pulls/${number}/reviews`;

  const payload = {
    commit_id: headRefOid,
    body: review.summary,
    event: review.verdict,
    comments: comments.map((c) => ({
      path: c.path,
      line: c.line,
      side: 'RIGHT',
      body: `**[${c.severity}]** ${c.body}`,
    })),
  };

  log.debug(`GitHub review payload:\n${JSON.stringify(payload, null, 2)}`);

  let response: string;
  try {
    response = execSync(`gh api --method POST ${endpoint} --input -`, {
      input: Buffer.from(JSON.stringify(payload)),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    log.error(`GitHub API error: ${e.message}`);
    if (e.stderr) log.error(`stderr: ${e.stderr.trim()}`);
    if (e.stdout) log.error(`stdout: ${e.stdout.trim()}`);
    throw err;
  }

  log.debug(`GitHub response:\n${response}`);
  log.info(`Review posted: ${review.verdict} (${comments.length} inline comment(s))`);
}
