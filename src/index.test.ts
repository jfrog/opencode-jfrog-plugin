// (c) JFrog Ltd. (2026)
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
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
  // Migration runs at load and reads HOME; isolate it from the real home dir.
  let homeDir: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    prevHome = process.env.HOME;
    homeDir = mkdtempSync(join(tmpdir(), 'jfrog-plugin-home-'));
    process.env.HOME = homeDir;
  });

  afterEach(() => {
    if (prevHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = prevHome;
    }
    rmSync(homeDir, { recursive: true, force: true });
  });

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

// V5 — migration safety: the one-time cleanup runs at load and must be conservative.
describe('JfrogOpencodePlugin migration safety (V5)', () => {
  let homeDir: string;
  let prevHome: string | undefined;
  let skillsRoot: string;

  beforeEach(() => {
    prevHome = process.env.HOME;
    homeDir = mkdtempSync(join(tmpdir(), 'jfrog-plugin-home-'));
    process.env.HOME = homeDir;
    skillsRoot = join(homeDir, '.config', 'opencode', 'skills');
  });

  afterEach(() => {
    if (prevHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = prevHome;
    }
    rmSync(homeDir, { recursive: true, force: true });
  });

  function seedSkill(relPath: string): void {
    const full = join(skillsRoot, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, '# fixture skill\n');
  }

  it('removes only version-nested managed skills; keeps flat, unrelated, and unknown-shape dirs', async () => {
    // Managed + version-nested -> should be REMOVED.
    seedSkill(join('jfrog-cli', '0.0.1', 'SKILL.md'));
    // Managed name but FLAT (could be the user's own) -> KEPT.
    seedSkill(join('jfrog-curation', 'SKILL.md'));
    // Unrelated user skill -> KEPT.
    seedSkill(join('my-own-skill', 'SKILL.md'));
    // Managed name, unknown shape (no SKILL.md anywhere) -> KEPT.
    mkdirSync(join(skillsRoot, 'opencode-jfrog-mcp'), { recursive: true });

    await server(pluginInput());

    expect(existsSync(join(skillsRoot, 'jfrog-cli'))).toBe(false);
    expect(existsSync(join(skillsRoot, 'jfrog-curation', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(skillsRoot, 'my-own-skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(skillsRoot, 'opencode-jfrog-mcp'))).toBe(true);
  });

  it('does not throw when the skills root does not exist', async () => {
    expect(existsSync(skillsRoot)).toBe(false);
    const hooks = await server(pluginInput());
    expect(hooks.config).toBeDefined();
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
