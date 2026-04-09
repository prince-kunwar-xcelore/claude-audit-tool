export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

export interface PrData {
  title: string;
  body: string;
  headRefOid: string;
  diff: string;
}

export interface ParsedFile {
  path: string;
  chunks: import('parse-diff').Chunk[];
  commentableLines: Set<number>;
  changedLineCount: number;   // additions only — used for display
  renderedLineCount: number;  // all lines sent to Claude (additions + deletions + context)
  truncated: boolean;         // true if file was cut at MAX_ADDITIONS_PER_FILE
}

export interface ReviewComment {
  path: string;
  line: number;
  severity: 'critical' | 'warning' | 'suggestion';
  body: string;
}

export interface ReviewOutput {
  summary: string;
  verdict: 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES';
  comments: ReviewComment[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUSD: number;
}

export interface BatchResult {
  review: ReviewOutput;
  usage: TokenUsage;
}
