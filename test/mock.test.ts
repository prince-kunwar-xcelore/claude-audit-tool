import { describe, it, expect } from 'vitest';
import './setup.js';
import { MockEngine } from '../src/engines/mock.js';
import { MockProvider } from '../src/mocks/provider.js';
import { parseDiffString, validateComments } from '../src/diff.js';
import { buildPrompt, mergeResults } from '../src/claude.js';
import type { ReviewOutput, ReviewComment, BatchResult } from '../src/types.js';

describe('MockEngine', () => {
  it('returns default APPROVE result', () => {
    const engine = new MockEngine();
    const result = engine.review('test prompt', 'mock-model');
    expect(result.review.verdict).toBe('APPROVE');
    expect(result.review.comments).toHaveLength(0);
  });

  it('records calls', () => {
    const engine = new MockEngine();
    engine.review('prompt1', 'model1');
    engine.synthesize('prompt2', 'model2');
    expect(engine.calls).toHaveLength(2);
    expect(engine.calls[0]).toEqual({ method: 'review', prompt: 'prompt1', model: 'model1' });
    expect(engine.calls[1]).toEqual({ method: 'synthesize', prompt: 'prompt2', model: 'model2' });
  });

  it('returns custom review result', () => {
    const custom: BatchResult = {
      review: {
        summary: 'Found issues',
        verdict: 'REQUEST_CHANGES',
        comments: [{ path: 'x.ts', line: 1, severity: 'critical', body: 'bug' }],
      },
      usage: { inputTokens: 200, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0, costUSD: 0.05 },
    };
    const engine = new MockEngine(custom);
    const result = engine.review('p', 'm');
    expect(result.review.verdict).toBe('REQUEST_CHANGES');
    expect(result.review.comments).toHaveLength(1);
  });

  it('returns custom synthesis result', () => {
    const engine = new MockEngine(undefined, 'Custom synthesis.');
    expect(engine.synthesize('p', 'm')).toBe('Custom synthesis.');
  });
});

describe('MockProvider', () => {
  it('returns default PR data', () => {
    const provider = new MockProvider();
    const pr = provider.fetchPr({ slug: 'test/repo', number: 1 });
    expect(pr.title).toBe('Mock PR');
    expect(pr.headSha).toBe('abc123');
    expect(pr.diff).toContain('const b = 2');
  });

  it('records postReview calls', () => {
    const provider = new MockProvider();
    const ref = { slug: 'test/repo', number: 1 };
    const review: ReviewOutput = { summary: 'ok', verdict: 'APPROVE', comments: [] };
    provider.postReview(ref, 'sha1', review, []);
    expect(provider.reviewCalls).toHaveLength(1);
    expect(provider.reviewCalls[0].ref).toEqual(ref);
    expect(provider.reviewCalls[0].review.verdict).toBe('APPROVE');
  });
});

describe('end-to-end with mocks', () => {
  it('full pipeline: fetch, parse, review, merge, post', () => {
    const provider = new MockProvider();
    const engine = new MockEngine();
    const ref = { slug: 'test/repo', number: 1 };

    const prData = provider.fetchPr(ref);
    const files = parseDiffString(prData.diff);
    expect(files.length).toBeGreaterThan(0);

    const prompt = buildPrompt(prData, files, provider.reviewTerm);
    expect(prompt).toContain('Mock PR');

    const batchResult = engine.review(prompt, engine.defaultModel);
    const { review } = mergeResults([batchResult]);
    const validComments = validateComments(review.comments, files);

    provider.postReview(ref, prData.headSha, review, validComments);

    expect(provider.reviewCalls).toHaveLength(1);
    expect(provider.reviewCalls[0].headSha).toBe('abc123');
    expect(provider.reviewCalls[0].review.verdict).toBe('APPROVE');
    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0].method).toBe('review');
  });

  it('multi-batch pipeline with synthesis', () => {
    const commentsA: ReviewComment[] = [{ path: 'a.ts', line: 1, severity: 'warning', body: 'w' }];
    const resultA: BatchResult = {
      review: { summary: 'batch A', verdict: 'COMMENT', comments: commentsA },
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0, costUSD: 0.01 },
    };
    const resultB: BatchResult = {
      review: { summary: 'batch B', verdict: 'REQUEST_CHANGES', comments: [] },
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0, costUSD: 0.01 },
    };

    const engine = new MockEngine(resultA);
    engine.review('p1', 'm');

    const engine2 = new MockEngine(resultB);
    engine2.review('p2', 'm');

    const { review, totalUsage } = mergeResults([resultA, resultB]);
    expect(review.verdict).toBe('REQUEST_CHANGES');
    expect(review.comments).toHaveLength(1);
    expect(totalUsage.inputTokens).toBe(200);
    expect(totalUsage.costUSD).toBeCloseTo(0.02);
  });
});
