import { describe, it, expect } from 'vitest';
import './setup.js';
import { resolveProvider } from '../src/provider.js';

describe('resolveProvider', () => {
  describe('GitHub shorthand', () => {
    it('parses owner/repo#123', () => {
      const { provider, ref } = resolveProvider('octocat/hello-world#42');
      expect(provider.name).toBe('GitHub');
      expect(ref.slug).toBe('octocat/hello-world');
      expect(ref.number).toBe(42);
    });

    it('parses org/repo#1', () => {
      const { ref } = resolveProvider('my-org/my-repo#1');
      expect(ref.slug).toBe('my-org/my-repo');
      expect(ref.number).toBe(1);
    });
  });

  describe('GitHub URL', () => {
    it('parses full GitHub PR URL', () => {
      const { provider, ref } = resolveProvider('https://github.com/facebook/react/pull/99');
      expect(provider.name).toBe('GitHub');
      expect(ref.slug).toBe('facebook/react');
      expect(ref.number).toBe(99);
    });
  });

  describe('GitLab shorthand', () => {
    it('detects GitLab pattern with !', () => {
      expect(() => resolveProvider('group/project!10')).toThrow('Unsupported provider');
    });
  });

  describe('GitLab URL', () => {
    it('detects GitLab URL pattern', () => {
      expect(() => resolveProvider('https://gitlab.com/group/project/-/merge_requests/5')).toThrow('Unsupported provider');
    });
  });

  describe('invalid input', () => {
    it('throws on bare repo name', () => {
      expect(() => resolveProvider('my-repo')).toThrow('Invalid reference');
    });

    it('throws on empty string', () => {
      expect(() => resolveProvider('')).toThrow('Invalid reference');
    });

    it('throws on random URL', () => {
      expect(() => resolveProvider('https://example.com/foo')).toThrow('Invalid reference');
    });
  });

  describe('provider hint override', () => {
    it('throws when hint overrides to unsupported provider', () => {
      expect(() => resolveProvider('octocat/hello-world#42', 'gitlab')).toThrow('Unsupported provider');
    });
  });
});
