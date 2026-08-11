// (c) JFrog Ltd. (2026)
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import {
  chmodSync,
  existsSync,
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

function toastCount(client: PluginInput['client'], substr: string): number {
  const showToast = client.tui.showToast as unknown as ReturnType<typeof mock>;
  return showToast.mock.calls.filter((args) =>
    String((args[0] as { body?: { message?: string } })?.body?.message ?? '').includes(substr)
  ).length;
}

async function runBash(hooks: Awaited<ReturnType<typeof server>>, command: string): Promise<void> {
  await hooks['tool.execute.before']?.(
    { tool: 'bash', sessionID: 's', callID: 'c' } as never,
    { args: { command } } as never
  );
}

describe('jfrog opencode plugin exports', () => {
  it('exposes the same plugin as server and JfrogOpencodePlugin', () => {
    expect(server).toBe(JfrogOpencodePlugin);
  });
});

describe('JfrogOpencodePlugin config hook', () => {
  it('returns config and tool.execute.before hooks', async () => {
    const hooks = await server(pluginInput());
    expect(hooks.config).toBeDefined();
    expect(hooks['tool.execute.before']).toBeDefined();
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

  it('does not toast a setup hint from the config hook', async () => {
    const client = createClient();
    const hooks = await server(pluginInput(client));
    await hooks.config?.({} as Config);
    expect(toastCount(client, 'JFrog:')).toBe(0);
  });
});

// Just-in-time setup hints surfaced from the tool hook on the first `jf` command.
describe('JFrog setup hints (tool.execute.before)', () => {
  const ENV_KEYS = [
    'PATH',
    'JFROG_URL',
    'JF_URL',
    'JFROG_PLATFORM_URL',
    'JFROG_ACCESS_TOKEN',
    'JF_ACCESS_TOKEN',
    'JFROG_MCP_DISABLE',
  ];
  let saved: Record<string, string | undefined>;
  let bin: string | undefined;

  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
    }
    // Default scenario: jf absent + MCP env absent.
    process.env.PATH = '';
    for (const key of ENV_KEYS.slice(1)) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    if (bin) {
      rmSync(bin, { recursive: true, force: true });
      bin = undefined;
    }
  });

  function installJf(): void {
    bin = mkdtempSync(join(tmpdir(), 'jfbin-'));
    const jfPath = join(bin, 'jf');
    writeFileSync(jfPath, '#!/bin/sh\n');
    chmodSync(jfPath, 0o755);
    process.env.PATH = bin;
  }

  it('hints to install the CLI when `jf` is missing (on a jf command)', async () => {
    const client = createClient();
    const hooks = await server(pluginInput(client));
    await runBash(hooks, 'jf rt ping');
    expect(toastCount(client, 'was not found on your PATH')).toBe(1);
  });

  it('shows NO hint when `jf` is present (MCP setup is surfaced by OpenCode + README, not toasts)', async () => {
    installJf();
    // Even a non-JWT token / missing env produces no toast — those are not the plugin's concern now.
    process.env.JFROG_URL = 'https://example.jfrog.io';
    process.env.JFROG_ACCESS_TOKEN = 'cmVmdGtuOnJlZmVyZW5jZQ';
    const client = createClient();
    const hooks = await server(pluginInput(client));
    await runBash(hooks, 'jf rt ping');
    expect(toastCount(client, 'JFrog:')).toBe(0);
  });

  it('shows only the install hint when `jf` is absent, regardless of MCP env', async () => {
    // PATH='' (jf absent) is the describe default.
    process.env.JFROG_URL = 'https://example.jfrog.io';
    process.env.JFROG_ACCESS_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.payload.sig';
    const client = createClient();
    const hooks = await server(pluginInput(client));
    await runBash(hooks, 'jf rt ping');
    expect(toastCount(client, 'was not found on your PATH')).toBe(1);
    expect(toastCount(client, 'JFrog:')).toBe(1);
  });

  it('shows at most one hint per session', async () => {
    const client = createClient();
    const hooks = await server(pluginInput(client));
    await runBash(hooks, 'jf rt ping');
    await runBash(hooks, 'jf c show');
    expect(toastCount(client, 'JFrog:')).toBe(1);
  });

  it('does not hint for non-jf bash commands', async () => {
    const client = createClient();
    const hooks = await server(pluginInput(client));
    await runBash(hooks, 'npm install lodash');
    await runBash(hooks, 'echo jfrog'); // `jf` is not a standalone command here
    expect(toastCount(client, 'JFrog:')).toBe(0);
  });

  it('does not hint for non-bash tools', async () => {
    const client = createClient();
    const hooks = await server(pluginInput(client));
    await hooks['tool.execute.before']?.(
      { tool: 'read', sessionID: 's', callID: 'c' } as never,
      { args: { command: 'jf rt ping' } } as never
    );
    expect(toastCount(client, 'JFrog:')).toBe(0);
  });
});

// V9 — vendored-content sanity: the committed skills/ tree must stay flat and well-formed.
describe('vendored skills content sanity (V9)', () => {
  const skillsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');
  const EXPECTED_SKILLS = [
    'jfrog',
    'jfrog-ai-catalog-skills',
    'jfrog-mcp-management',
    'jfrog-package-safety-and-download',
    'jfrog-reference-architecture',
    'jfrog-setup-package-managers',
  ];

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

  it('contains exactly the vendored skills (flat layout)', () => {
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

  it('injects the resolved token into the Authorization header', async () => {
    // OpenCode does not expand {env:} in plugin-injected config, so the token value is materialized.
    process.env.JFROG_URL = 'https://example.jfrog.io';
    process.env.JFROG_ACCESS_TOKEN = 'eyJresolvedtokenvalue';
    const jfrog = mcpOf(await runConfig())?.jfrog;
    expect(jfrog?.headers?.Authorization).toBe('Bearer eyJresolvedtokenvalue');
  });

  it('normalizes scheme and trailing slash in the host', async () => {
    process.env.JFROG_URL = 'https://x.jfrog.io/';
    process.env.JFROG_ACCESS_TOKEN = 'jwt-token';
    expect(mcpOf(await runConfig())?.jfrog?.url).toBe('https://x.jfrog.io/mcp');
  });

  it('preserves an explicit http:// scheme (no silent https upgrade)', async () => {
    process.env.JFROG_URL = 'http://internal.corp/';
    process.env.JFROG_ACCESS_TOKEN = 'jwt-token';
    expect(mcpOf(await runConfig())?.jfrog?.url).toBe('http://internal.corp/mcp');
  });

  it('defaults to https:// when the host omits a scheme', async () => {
    process.env.JFROG_URL = 'bare.jfrog.io';
    process.env.JFROG_ACCESS_TOKEN = 'jwt-token';
    expect(mcpOf(await runConfig())?.jfrog?.url).toBe('https://bare.jfrog.io/mcp');
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

  it('uses the legacy JF_ACCESS_TOKEN value when only it is set', async () => {
    process.env.JFROG_URL = 'https://example.jfrog.io';
    process.env.JF_ACCESS_TOKEN = 'eyJlegacytokenvalue';
    const auth = mcpOf(await runConfig())?.jfrog?.headers?.Authorization;
    expect(auth).toBe('Bearer eyJlegacytokenvalue');
  });

  it('skips injection when the host is missing', async () => {
    process.env.JFROG_ACCESS_TOKEN = 'jwt-token';
    expect(mcpOf(await runConfig())).toBeUndefined();
  });

  it('skips injection when the token is missing', async () => {
    process.env.JFROG_URL = 'https://example.jfrog.io';
    expect(mcpOf(await runConfig())).toBeUndefined();
  });

  it('registers the MCP even when the token is not a JWT (shape only warns, never gates)', async () => {
    process.env.JFROG_URL = 'https://example.jfrog.io';
    process.env.JFROG_ACCESS_TOKEN = 'reference-token-not-a-jwt';
    const jfrog = mcpOf(await runConfig())?.jfrog;
    expect(jfrog).toBeDefined();
    expect(jfrog?.url).toBe('https://example.jfrog.io/mcp');
    expect(jfrog?.headers?.Authorization).toBe('Bearer reference-token-not-a-jwt');
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
