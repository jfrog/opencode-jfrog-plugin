// (c) JFrog Ltd. (2026)
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config, PluginInput } from '@opencode-ai/plugin';
import { server, JfrogOpencodePlugin } from './index.ts';

function tpl(strings: TemplateStringsArray, values: unknown[]): string {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      out += String(values[i]);
    }
  }
  return out;
}

/** Minimal stand-in for BunShell used by the plugin (only `.nothrow().quiet()` chains). */
function createShellMock(options: { jfVersionExitCode?: number } = {}) {
  const jfVersionExitCode = options.jfVersionExitCode ?? 0;
  return function $(strings: TemplateStringsArray, ...values: unknown[]) {
    const cmd = tpl(strings, values);
    let exitCode = 0;
    let stderr = '';
    if (cmd.includes('jf --version')) {
      exitCode = jfVersionExitCode;
      if (jfVersionExitCode !== 0) {
        stderr = 'jf: command not found';
      }
    } else if (cmd.includes('test -d') && cmd.includes('.opencode/skills')) {
      exitCode = 1;
    }
    const result = { exitCode, stderr };
    return {
      nothrow() {
        return {
          quiet() {
            return Promise.resolve(result);
          },
        };
      },
    };
  } as unknown as PluginInput['$'];
}

describe('jfrog opencode plugin exports', () => {
  it('exposes the same plugin as server and JfrogOpencodePlugin', () => {
    expect(server).toBe(JfrogOpencodePlugin);
  });
});

describe('JfrogOpencodePlugin', () => {
  let projectRoot: string;
  let homeDir: string;
  let prevCwd: string;
  let prevHome: string | undefined;
  let originalFetch: typeof fetch;
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    prevCwd = process.cwd();
    prevHome = process.env.HOME;
    projectRoot = mkdtempSync(join(tmpdir(), 'jfrog-plugin-proj-'));
    homeDir = mkdtempSync(join(tmpdir(), 'jfrog-plugin-home-'));
    process.chdir(projectRoot);
    process.env.HOME = homeDir;
    mkdirSync(join(projectRoot, '.jfrog', 'instructions'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.jfrog', 'instructions', 'JFROG-INTEGRATION-MANAGEMENT.md'),
      '# test instructions\n'
    );
    mkdirSync(join(homeDir, '.config', 'opencode', 'skills'), { recursive: true });
    fetchMock = mock((input: string | Request) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('.zip') || url.includes('.zip')) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      return Promise.resolve(Response.json({ skills: [] }));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.chdir(prevCwd);
    if (prevHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = prevHome;
    }
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  });

  function createClient() {
    return {
      tui: {
        showToast: mock(() => Promise.resolve()),
      },
    } as unknown as PluginInput['client'];
  }

  function pluginInput($: PluginInput['$'], client?: PluginInput['client']): PluginInput {
    return {
      client: client ?? createClient(),
      $,
      directory: projectRoot,
      project: {} as PluginInput['project'],
      worktree: projectRoot,
      experimental_workspace: { register: () => {} },
      serverUrl: new URL('http://127.0.0.1:4096'),
    };
  }

  it('loads with pullSkills using stubbed fetch and returns hooks', async () => {
    const hooks = await server(pluginInput(createShellMock()));
    expect(hooks.config).toBeDefined();
    expect(hooks.event).toBeDefined();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
  });

  it('config adds JFrog integration instructions when missing', async () => {
    const hooks = await server(pluginInput(createShellMock()));
    const config = { instructions: [] as string[] };
    await hooks.config?.(config as Config);
    expect(config.instructions).toContain('.jfrog/instructions/JFROG-INTEGRATION-MANAGEMENT.md');
  });

  it('config does not duplicate the JFrog instructions path', async () => {
    const hooks = await server(pluginInput(createShellMock()));
    const path = '.jfrog/instructions/JFROG-INTEGRATION-MANAGEMENT.md';
    const config = { instructions: [path] };
    await hooks.config?.(config as Config);
    expect(config.instructions.filter((p) => p === path).length).toBe(1);
  });

  it('session.created shows error toast when jf CLI is missing', async () => {
    const client = createClient();
    const hooks = await JfrogOpencodePlugin(
      pluginInput(createShellMock({ jfVersionExitCode: 127 }), client)
    );

    await hooks.event?.({
      event: {
        type: 'session.created',
        properties: {
          info: {
            id: 'sess-1',
            projectID: 'proj-1',
            directory: projectRoot,
            title: 't',
            version: '1',
            time: { created: 0, updated: 0 },
          },
        },
      } as never,
    });

    expect(client.tui.showToast).toHaveBeenCalled();
    const showToast = client.tui.showToast as ReturnType<typeof mock>;
    const call = showToast.mock.calls[0]?.[0];
    expect(call?.body?.variant).toBe('error');
    expect(String(call?.body?.message)).toContain('Jfrog cli is not installed');
  });
});
