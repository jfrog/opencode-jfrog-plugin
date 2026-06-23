// (c) JFrog Ltd. (2026)
import { describe, it, expect, mock } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config, PluginInput } from '@opencode-ai/plugin';
import { server, JfrogOpencodePlugin } from './index.ts';

function createClient(): PluginInput['client'] {
  return {
    tui: {
      showToast: mock(() => Promise.resolve()),
    },
  } as unknown as PluginInput['client'];
}

function pluginInput(client?: PluginInput['client']): PluginInput {
  return {
    client: client ?? createClient(),
    $: (() => {}) as unknown as PluginInput['$'],
    directory: process.cwd(),
    project: {} as PluginInput['project'],
    worktree: process.cwd(),
    experimental_workspace: { register: () => {} },
    serverUrl: new URL('http://127.0.0.1:4096'),
  } as unknown as PluginInput;
}

function skillsOf(config: Config): { paths?: string[] } | undefined {
  return (config as { skills?: { paths?: string[] } }).skills;
}

describe('jfrog opencode plugin exports', () => {
  it('exposes the same plugin as server and JfrogOpencodePlugin', () => {
    expect(server).toBe(JfrogOpencodePlugin);
  });
});

describe('JfrogOpencodePlugin config hook', () => {
  it('returns only a config hook (no event hook)', async () => {
    const hooks = await server(pluginInput());
    expect(hooks.config).toBeDefined();
    expect((hooks as { event?: unknown }).event).toBeUndefined();
  });

  it('adds the bundled skills dir to config.skills.paths (object form)', async () => {
    const hooks = await server(pluginInput());
    const config = {} as Config;
    await hooks.config?.(config);
    const skills = skillsOf(config);
    expect(skills).toBeDefined();
    expect(Array.isArray(skills?.paths)).toBe(true);
    expect(skills?.paths?.some((p) => p.endsWith('/skills'))).toBe(true);
  });

  it('does not duplicate the bundled skills path (idempotent)', async () => {
    const hooks = await server(pluginInput());
    const config = {} as Config;
    await hooks.config?.(config);
    await hooks.config?.(config);
    const bundled = (skillsOf(config)?.paths ?? []).filter((p) => p.endsWith('/skills'));
    expect(bundled.length).toBe(1);
  });
});

// V9 — vendored-content sanity: the committed skills/ tree must stay flat and well-formed.
describe('vendored skills content sanity (V9)', () => {
  const skillsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');
  const EXPECTED_SKILLS = ['jfrog', 'jfrog-package-safety-and-download'];

  function readFrontmatter(md: string): { name?: string; description?: string } {
    const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) {
      return {};
    }
    const block = match[1];
    const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const description = block.match(/^description:\s*(.+)$/m)?.[1]?.trim();
    return { name, description };
  }

  it('contains exactly the two vendored skills (flat layout)', () => {
    const dirs = readdirSync(skillsDir)
      .filter((entry) => statSync(join(skillsDir, entry)).isDirectory())
      .sort();
    expect(dirs).toEqual(EXPECTED_SKILLS);
  });

  for (const skill of EXPECTED_SKILLS) {
    it(`${skill}/SKILL.md has valid frontmatter with name == dir`, () => {
      const skillMd = join(skillsDir, skill, 'SKILL.md');
      expect(existsSync(skillMd)).toBe(true);
      const { name, description } = readFrontmatter(readFileSync(skillMd, 'utf8'));
      expect(name).toBeDefined();
      expect(description).toBeDefined();
      expect(name).toBe(skill);
    });
  }
});
