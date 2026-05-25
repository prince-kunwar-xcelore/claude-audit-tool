import type { BatchResult } from './types.js';
import { ClaudeCliEngine } from './engines/claude-cli.js';

export interface ReviewEngine {
  readonly name: string;
  readonly defaultModel: string;

  review(prompt: string, model: string): BatchResult;
  synthesize(prompt: string, model: string): string;
}

export function resolveEngine(name: string, authToken = ''): ReviewEngine {
  switch (name) {
    case 'claude-cli':
      return new ClaudeCliEngine(authToken);
    default:
      throw new Error(`Unsupported engine: "${name}". Supported: claude-cli`);
  }
}
