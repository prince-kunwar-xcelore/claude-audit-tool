import { describe, it, expect } from 'vitest';
import './setup.js';
import { resolveEngine } from '../src/engine.js';

describe('resolveEngine', () => {
  it('resolves claude-cli engine', () => {
    const engine = resolveEngine('claude-cli');
    expect(engine.name).toBe('Claude CLI');
  });

  it('throws on unknown engine', () => {
    expect(() => resolveEngine('unknown-engine')).toThrow('Unsupported engine');
  });

  it('passes auth token to claude-cli', () => {
    const engine = resolveEngine('claude-cli', 'my-token');
    expect(engine).toBeDefined();
  });
});
