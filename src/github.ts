import { execSync } from 'child_process';
import type { PrRef, PrData, ReviewComment, ReviewOutput } from './types.js';

export function fetchPr(ref: PrRef): PrData {
  const { owner, repo, number } = ref;
  const repoSlug = `${owner}/${repo}`;

  const metaRaw = execSync(
    `gh pr view ${number} --repo ${repoSlug} --json title,body,headRefOid`,
    { encoding: 'utf8' }
  );
  const meta = JSON.parse(metaRaw) as { title: string; body: string; headRefOid: string };

  const diff = execSync(`gh pr diff ${number} --repo ${repoSlug} --patch`, {
    encoding: 'utf8',
  });

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

  const json = JSON.stringify(payload);

  execSync(
    `gh api --method POST /repos/${owner}/${repo}/pulls/${number}/reviews --input -`,
    {
      input: Buffer.from(json),
      stdio: ['pipe', 'inherit', 'inherit'],
    }
  );

  console.log(`\nReview posted: ${review.verdict} (${comments.length} inline comment(s))`);
}
