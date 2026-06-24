// (c) JFrog Ltd. (2026)
import type { Config, Plugin } from '@opencode-ai/plugin';
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const LOG_FILE = join(process.cwd(), '.opencode', 'event-log.txt');

// dist/index.js -> ../skills after build/install; src/index.ts -> ../skills in dev.
const BUNDLED_SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');

type Logger = (_message: string) => void;
type ConfigWithJfrog = Config & {
  skills?: { paths?: string[] };
  mcp?: Record<string, unknown>;
};

const isNonEmptyDir = (dir: string): boolean => {
  if (!existsSync(dir)) {
    return false;
  }
  try {
    return statSync(dir).isDirectory() && readdirSync(dir).length > 0;
  } catch {
    return false;
  }
};

/** OpenCode loads plugins via the `server` export (see `PluginModule` in @opencode-ai/plugin). */
const jfrogOpencodePlugin: Plugin = async ({ client }) => {
  const logDir = dirname(LOG_FILE);
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  const log: Logger = (message) => {
    if (process.env.JFROG_DEBUG_LOGS === 'true') {
      appendFileSync(LOG_FILE, message + '\n', 'utf-8');
    }
  };
  // Fire-and-forget: showToast never resolves in headless sessions (no TUI to ack it), so awaiting it
  // would hang the config hook. Durable signals always go through log() regardless of UI.
  const toast = (message: string, variant: 'error' | 'info'): void => {
    void client.tui
      .showToast({ body: { message, variant, duration: 10000 } })
      .catch(() => undefined);
  };
  log('JfrogOpencodePlugin starting...');

  // The config hook can run multiple times per session; nudge the user only once.
  let nudgeShown = false;

  return {
    config: async (config) => {
      const cfg = config as ConfigWithJfrog;
      cfg.skills = cfg.skills ?? {};
      cfg.skills.paths = cfg.skills.paths ?? [];

      // Fail loud: a missing/empty bundled dir means a broken build/package.
      if (!isNonEmptyDir(BUNDLED_SKILLS_DIR)) {
        const message =
          `JFrog: bundled skills not found at ${BUNDLED_SKILLS_DIR}. ` +
          'The plugin package may be broken; reinstall @jfrog/opencode-jfrog-plugin.';
        log('ERROR ' + message);
        toast(message, 'error');
        return;
      }

      if (!cfg.skills.paths.includes(BUNDLED_SKILLS_DIR)) {
        cfg.skills.paths.push(BUNDLED_SKILLS_DIR);
      }
      log('config.skills.paths=' + JSON.stringify(cfg.skills.paths));

      // Register the JFrog Platform remote MCP (token auth, headless). Pure config mutation: no
      // network on load. The token is referenced via {env:} so the raw value never enters the config.
      const rawHost = process.env.JFROG_URL ?? process.env.JF_URL ?? process.env.JFROG_PLATFORM_URL;
      const tokenVar = process.env.JFROG_ACCESS_TOKEN
        ? 'JFROG_ACCESS_TOKEN'
        : process.env.JF_ACCESS_TOKEN
          ? 'JF_ACCESS_TOKEN'
          : undefined;
      const mcpDisabled = process.env.JFROG_MCP_DISABLE === 'true';

      if (rawHost && tokenVar && !mcpDisabled) {
        const host = rawHost.replace(/^https?:\/\//, '').replace(/\/+$/, '');
        const url = `https://${host}/mcp`;
        cfg.mcp = cfg.mcp ?? {};
        // Non-destructive: never clobber a user-defined `jfrog` MCP server.
        if (!cfg.mcp.jfrog) {
          cfg.mcp.jfrog = {
            type: 'remote',
            url,
            oauth: false,
            headers: { Authorization: `Bearer {env:${tokenVar}}` },
            enabled: true,
          };
          log('mcp: registered jfrog remote MCP at ' + url);
        }
      } else {
        log(
          'mcp: jfrog remote MCP not registered ' +
            '(need JFROG_URL + JFROG_ACCESS_TOKEN; or JFROG_MCP_DISABLE set)'
        );
      }

      // R2 interim nudge until package-manager setup is handled by a skill.
      if (!nudgeShown) {
        nudgeShown = true;
        toast(
          'JFrog: run `jf setup <pm>` to configure package managers against Artifactory.',
          'info'
        );
      }
    },
  };
};

export const server = jfrogOpencodePlugin;
export const JfrogOpencodePlugin = jfrogOpencodePlugin;
