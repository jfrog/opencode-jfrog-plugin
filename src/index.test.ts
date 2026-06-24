// (c) JFrog Ltd. (2026)
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
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

type McpEntry = {
  type?: string;
  url?: string;
  oauth?: boolean;
  enabled?: boolean;
  headers?: Record<string, string>;
};

function mcpOf(config: Config): Record<string, McpEntry> | undefined {
  return (config as { mcp?: Record<string, McpEntry> }).mcp;
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

  it('shows the `jf setup` nudge only once across multiple config calls', async () => {
    const client = createClient();
    const hooks = await server(pluginInput(client));
    const config = {} as Config;
    await hooks.config?.(config);
    await hooks.config?.(config);
    const showToast = client.tui.showToast as unknown as ReturnType<typeof mock>;
    const nudges = showToast.mock.calls.filter((args) => {
      const message = (args[0] as { body?: { message?: string } })?.body?.message ?? '';
      return message.includes('jf setup');
    });
    expect(nudges.length).toBe(1);
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

// JFrog Platform remote MCP injection via the config hook (token auth, headless).
describe('JfrogOpencodePlugin JFrog remote MCP injection', () => {
  const ENV_KEYS = [
    'JFROG_URL',
    'JF_URL',
    'JFROG_PLATFORM_URL',
    'JFROG_ACCESS_TOKEN',
    'JF_ACCESS_TOKEN',
    'JFROG_MCP_DISABLE',
  ];
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  async function runConfig(): Promise<Config> {
    const hooks = await server(pluginInput());
    const config = {} as Config;
    await hooks.config?.(config);
    return config;
  }

  it('injects a remote jfrog MCP when JFROG_URL + JFROG_ACCESS_TOKEN are set', async () => {
    process.env.JFROG_URL = 'https://example.jfrog.io';
    process.env.JFROG_ACCESS_TOKEN = 'jwt-token';
    const jfrog = mcpOf(await runConfig())?.jfrog;
    expect(jfrog).toBeDefined();
    expect(jfrog?.type).toBe('remote');
    expect(jfrog?.url).toBe('https://example.jfrog.io/mcp');
    expect(jfrog?.oauth).toBe(false);
    expect(jfrog?.enabled).toBe(true);
  });

  it('references the token via {env:} and never embeds the raw token value', async () => {
    process.env.JFROG_URL = 'https://example.jfrog.io';
    process.env.JFROG_ACCESS_TOKEN = 'SUPER_SECRET_TOKEN_VALUE';
    const config = await runConfig();
    expect(mcpOf(config)?.jfrog?.headers?.Authorization).toBe('Bearer {env:JFROG_ACCESS_TOKEN}');
    expect(JSON.stringify(config)).not.toContain('SUPER_SECRET_TOKEN_VALUE');
  });

  it('normalizes scheme and trailing slash in the host', async () => {
    process.env.JFROG_URL = 'https://x.jfrog.io/';
    process.env.JFROG_ACCESS_TOKEN = 'jwt-token';
    expect(mcpOf(await runConfig())?.jfrog?.url).toBe('https://x.jfrog.io/mcp');
  });

  it('accepts the legacy JF_URL host name', async () => {
    process.env.JF_URL = 'legacy.jfrog.io';
    process.env.JFROG_ACCESS_TOKEN = 'jwt-token';
    expect(mcpOf(await runConfig())?.jfrog?.url).toBe('https://legacy.jfrog.io/mcp');
  });

  it('accepts the cursor-compat JFROG_PLATFORM_URL host name', async () => {
    process.env.JFROG_PLATFORM_URL = 'cursor.jfrog.io';
    process.env.JFROG_ACCESS_TOKEN = 'jwt-token';
    expect(mcpOf(await runConfig())?.jfrog?.url).toBe('https://cursor.jfrog.io/mcp');
  });

  it('uses {env:JF_ACCESS_TOKEN} when only the legacy token name is set', async () => {
    process.env.JFROG_URL = 'https://example.jfrog.io';
    process.env.JF_ACCESS_TOKEN = 'jwt-token';
    expect(mcpOf(await runConfig())?.jfrog?.headers?.Authorization).toBe(
      'Bearer {env:JF_ACCESS_TOKEN}'
    );
  });

  it('skips injection when the host is missing', async () => {
    process.env.JFROG_ACCESS_TOKEN = 'jwt-token';
    expect(mcpOf(await runConfig())).toBeUndefined();
  });

  it('skips injection when the token is missing', async () => {
    process.env.JFROG_URL = 'https://example.jfrog.io';
    expect(mcpOf(await runConfig())).toBeUndefined();
  });

  it('skips injection when JFROG_MCP_DISABLE=true', async () => {
    process.env.JFROG_URL = 'https://example.jfrog.io';
    process.env.JFROG_ACCESS_TOKEN = 'jwt-token';
    process.env.JFROG_MCP_DISABLE = 'true';
    expect(mcpOf(await runConfig())).toBeUndefined();
  });

  it('does not overwrite a user-defined jfrog MCP entry', async () => {
    process.env.JFROG_URL = 'https://example.jfrog.io';
    process.env.JFROG_ACCESS_TOKEN = 'jwt-token';
    const existing: McpEntry = { type: 'remote', url: 'https://user.example/mcp', enabled: false };
    const hooks = await server(pluginInput());
    const config = { mcp: { jfrog: existing } } as unknown as Config;
    await hooks.config?.(config);
    expect(mcpOf(config)?.jfrog).toEqual(existing);
  });

  it('is idempotent across repeated config calls', async () => {
    process.env.JFROG_URL = 'https://example.jfrog.io';
    process.env.JFROG_ACCESS_TOKEN = 'jwt-token';
    const hooks = await server(pluginInput());
    const config = {} as Config;
    await hooks.config?.(config);
    const first = mcpOf(config)?.jfrog;
    await hooks.config?.(config);
    expect(mcpOf(config)?.jfrog).toEqual(first);
  });
});
