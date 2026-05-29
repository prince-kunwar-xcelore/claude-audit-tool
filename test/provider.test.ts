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
    it('parses group/project!10', () => {
      const { provider, ref } = resolveProvider('group/project!10');
      expect(provider.name).toBe('GitLab');
      expect(ref.slug).toBe('group/project');
      expect(ref.number).toBe(10);
    });

    it('parses nested group/subgroup/project!5', () => {
      const { provider, ref } = resolveProvider('group/subgroup/project!5');
      expect(provider.name).toBe('GitLab');
      expect(ref.slug).toBe('group/subgroup/project');
      expect(ref.number).toBe(5);
    });
  });

  describe('GitLab URL', () => {
    it('parses full GitLab MR URL', () => {
      const { provider, ref } = resolveProvider('https://gitlab.com/group/project/-/merge_requests/5');
      expect(provider.name).toBe('GitLab');
      expect(ref.slug).toBe('group/project');
      expect(ref.number).toBe(5);
    });

    it('parses nested group GitLab MR URL', () => {
      const { ref } = resolveProvider('https://gitlab.com/group/subgroup/project/-/merge_requests/7');
      expect(ref.slug).toBe('group/subgroup/project');
      expect(ref.number).toBe(7);
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
    it('uses hint to override auto-detected provider', () => {
      const { provider } = resolveProvider('octocat/hello-world#42', 'gitlab');
      expect(provider.name).toBe('GitLab');
    });

    it('throws when hint names an unknown provider', () => {
      expect(() => resolveProvider('octocat/hello-world#42', 'bitbucket')).toThrow('Unsupported provider');
    });
  });
});
