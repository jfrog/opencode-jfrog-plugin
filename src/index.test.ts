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

function instructionsOf(config: Config): string[] {
  return (config as { instructions?: string[] }).instructions ?? [];
}

function hasMcpTemplate(config: Config): boolean {
  return instructionsOf(config).some((p) => p.endsWith('templates/jfrog-mcp-management.md'));
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

// Agent Guard (Claude model): gated injection of the MCP-management instructions template.
describe('JfrogOpencodePlugin Agent Guard injection (gated)', () => {
  const ENV_KEYS = [
    'HOME',
    'JFROG_URL',
    'JF_URL',
    'JFROG_ACCESS_TOKEN',
    'JF_ACCESS_TOKEN',
    '_JF_AGENT_GUARD_FORCE_DISABLE',
    'JF_AGENT_GUARD_FORCE_ENABLE',
  ];
  let homeDir: string;
  let savedEnv: Record<string, string | undefined>;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    homeDir = mkdtempSync(join(tmpdir(), 'jfrog-plugin-home-'));
    process.env.HOME = homeDir;
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const key of ENV_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    rmSync(homeDir, { recursive: true, force: true });
  });

  function setFetch(impl: (url: string) => Promise<Response>): ReturnType<typeof mock> {
    const fetchMock = mock((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      return impl(url);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  function settingResponse(value: boolean): Response {
    return new Response(JSON.stringify({ settings: { mcpGatewayPluginEnabled: { value } } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  async function runConfig(): Promise<Config> {
    const hooks = await server(pluginInput());
    const config = {} as Config;
    await hooks.config?.(config);
    return config;
  }

  it('injects the template when the account setting is enabled', async () => {
    process.env.JFROG_URL = 'https://example.jfrog.io';
    process.env.JFROG_ACCESS_TOKEN = 'tok';
    setFetch(() => Promise.resolve(settingResponse(true)));
    expect(hasMcpTemplate(await runConfig())).toBe(true);
  });

  it('honors legacy JF_URL/JF_ACCESS_TOKEN names', async () => {
    process.env.JF_URL = 'https://example.jfrog.io';
    process.env.JF_ACCESS_TOKEN = 'tok';
    setFetch(() => Promise.resolve(settingResponse(true)));
    expect(hasMcpTemplate(await runConfig())).toBe(true);
  });

  it('does not inject when the account setting is disabled', async () => {
    process.env.JFROG_URL = 'https://example.jfrog.io';
    process.env.JFROG_ACCESS_TOKEN = 'tok';
    setFetch(() => Promise.resolve(settingResponse(false)));
    expect(hasMcpTemplate(await runConfig())).toBe(false);
  });

  it('fails closed on a non-ok response', async () => {
    process.env.JFROG_URL = 'https://example.jfrog.io';
    process.env.JFROG_ACCESS_TOKEN = 'tok';
    setFetch(() => Promise.resolve(new Response('nope', { status: 500 })));
    expect(hasMcpTemplate(await runConfig())).toBe(false);
  });

  it('does not call the settings API or inject when the token is missing', async () => {
    process.env.JFROG_URL = 'https://example.jfrog.io';
    const fetchMock = setFetch(() => Promise.resolve(settingResponse(true)));
    expect(hasMcpTemplate(await runConfig())).toBe(false);
    expect(fetchMock.mock.calls.length).toBe(0);
  });

  it('fails closed (and does not throw) when the request errors/aborts', async () => {
    process.env.JFROG_URL = 'https://example.jfrog.io';
    process.env.JFROG_ACCESS_TOKEN = 'tok';
    setFetch(() => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    expect(hasMcpTemplate(await runConfig())).toBe(false);
  });

  it('honors _JF_AGENT_GUARD_FORCE_DISABLE (no API call, no injection)', async () => {
    process.env.JFROG_URL = 'https://example.jfrog.io';
    process.env.JFROG_ACCESS_TOKEN = 'tok';
    process.env._JF_AGENT_GUARD_FORCE_DISABLE = 'true';
    const fetchMock = setFetch(() => Promise.resolve(settingResponse(true)));
    expect(hasMcpTemplate(await runConfig())).toBe(false);
    expect(fetchMock.mock.calls.length).toBe(0);
  });

  it('honors JF_AGENT_GUARD_FORCE_ENABLE (injects without the API check)', async () => {
    process.env.JF_AGENT_GUARD_FORCE_ENABLE = 'true';
    const fetchMock = setFetch(() => Promise.resolve(settingResponse(false)));
    expect(hasMcpTemplate(await runConfig())).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(0);
  });

  it('does not duplicate the template path on repeated config calls', async () => {
    process.env.JF_AGENT_GUARD_FORCE_ENABLE = 'true';
    setFetch(() => Promise.resolve(settingResponse(true)));
    const hooks = await server(pluginInput());
    const config = {} as Config;
    await hooks.config?.(config);
    await hooks.config?.(config);
    const count = instructionsOf(config).filter((p) =>
      p.endsWith('templates/jfrog-mcp-management.md')
    ).length;
    expect(count).toBe(1);
  });

  it('does not inject any config.mcp entry', async () => {
    process.env.JF_AGENT_GUARD_FORCE_ENABLE = 'true';
    setFetch(() => Promise.resolve(settingResponse(true)));
    const config = await runConfig();
    expect((config as { mcp?: unknown }).mcp).toBeUndefined();
  });
});
