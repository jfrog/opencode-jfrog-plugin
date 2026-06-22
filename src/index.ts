// (c) JFrog Ltd. (2026)
import type { Config, Plugin } from '@opencode-ai/plugin';
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const LOG_FILE = join(process.cwd(), '.opencode', 'event-log.txt');

// dist/index.js -> ../skills after build/install; src/index.ts -> ../skills in dev.
const BUNDLED_SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');

// Same resolution as the skills dir: dist/index.js -> ../templates, src/index.ts -> ../templates.
const MCP_MANAGEMENT_TEMPLATE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'templates',
  'jfrog-mcp-management.md'
);

const ACCOUNT_SETTING_PATH =
  '/ml/core/api/v1/administration/account-settings/mcp_gateway_plugin_enabled';

// Skills previously managed (downloaded/unzipped) by older versions of this plugin.
const OLD_MANAGED_SKILLS = [
  'skill-install',
  'skill-publish',
  'jfrog-cli',
  'opencode-jfrog-mcp',
  'jfrog-setup-package-managers',
  'jfrog-curation',
  'jfrog-packages',
];

type Logger = (_message: string) => void;
type ConfigWithSkills = Config & { skills?: { paths?: string[] }; instructions?: string[] };

type AccountSettingResponse = {
  settings?: { mcpGatewayPluginEnabled?: { value?: boolean } };
};

// New JFROG_* env names take precedence over the legacy JF_* names.
const readEnv = (newName: string, oldName: string): string | undefined =>
  process.env[newName] ?? process.env[oldName];

/**
 * Gate Agent Guard on the account setting, mirroring the Claude plugin. Bounded (5s) and FAIL-CLOSED:
 * any missing token, error, timeout, or non-ok response is treated as "not enabled" so load never hangs.
 */
const isAgentGuardEnabled = async (log: Logger): Promise<boolean> => {
  const baseUrl = readEnv('JFROG_URL', 'JF_URL');
  const token = readEnv('JFROG_ACCESS_TOKEN', 'JF_ACCESS_TOKEN');
  if (!baseUrl || !token) {
    log('agent-guard: JFROG_URL/JFROG_ACCESS_TOKEN not set; skipping gateway setting check');
    return false;
  }
  const url = baseUrl.replace(/\/+$/, '') + ACCOUNT_SETTING_PATH;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      log(`agent-guard: settings request returned HTTP ${response.status}`);
      return false;
    }
    const data = (await response.json()) as AccountSettingResponse;
    return data?.settings?.mcpGatewayPluginEnabled?.value === true;
  } catch (e) {
    const reason = e instanceof Error && e.name === 'AbortError' ? 'timeout' : String(e);
    log('agent-guard: settings request failed: ' + reason);
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

/** Resolve whether to inject the MCP-management template, honoring the force flags first. */
const shouldInjectAgentGuard = async (log: Logger): Promise<boolean> => {
  if (process.env._JF_AGENT_GUARD_FORCE_DISABLE === 'true') {
    log('agent-guard: force-disabled; skipping MCP-management instructions');
    return false;
  }
  if (process.env.JF_AGENT_GUARD_FORCE_ENABLE === 'true') {
    log(
      'agent-guard: force-enabled; injecting MCP-management instructions without the setting check'
    );
    return true;
  }
  return isAgentGuardEnabled(log);
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

const isDir = (dir: string): boolean => {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

/** Old layout stored skills under <name>/<version>/SKILL.md. Detect any version-nested SKILL.md. */
const hasVersionNestedSkill = (dir: string): boolean => {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return false;
  }
  for (const entry of entries) {
    const sub = join(dir, entry);
    if (isDir(sub) && existsSync(join(sub, 'SKILL.md'))) {
      return true;
    }
  }
  return false;
};

/**
 * Conservative one-time cleanup of skills installed by the old runtime-download plugin.
 * Removes ONLY version-nested managed dirs; never touches flat skills (possibly user-authored)
 * or unknown shapes. Never throws.
 */
const migrateLegacyManagedSkills = (log: Logger): void => {
  const home = process.env.HOME;
  if (!home) {
    log('migration: HOME not set, skipping legacy skill migration');
    return;
  }
  const skillsRoot = join(home, '.config', 'opencode', 'skills');
  if (!existsSync(skillsRoot)) {
    return;
  }
  for (const name of OLD_MANAGED_SKILLS) {
    const dir = join(skillsRoot, name);
    if (!isDir(dir)) {
      continue;
    }
    // Flat skill (could be the user's own) -> never touch.
    if (existsSync(join(dir, 'SKILL.md'))) {
      log(`migration: keeping flat skill ${name} (has SKILL.md)`);
      continue;
    }
    // Old version-nested managed layout -> remove.
    if (hasVersionNestedSkill(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true });
        log(`migration: removed legacy version-nested managed skill ${name}`);
      } catch (e) {
        const reason = e instanceof Error ? e.toString() : String(e);
        log(`migration: failed to remove ${name}: ${reason}`);
      }
      continue;
    }
    // Unknown shape (no SKILL.md anywhere) -> leave it.
    log(`migration: leaving ${name} (unknown shape, no SKILL.md)`);
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

  migrateLegacyManagedSkills(log);

  return {
    config: async (config) => {
      const cfg = config as ConfigWithSkills;
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

      // Agent Guard (Claude model): when the account setting is enabled, inject the MCP-management
      // template so the agent installs catalog MCPs via `npx @jfrog/agent-guard`. The plugin itself
      // does NOT register any config.mcp entry. Gating is bounded + fail-closed (never hangs load).
      if (await shouldInjectAgentGuard(log)) {
        cfg.instructions = cfg.instructions ?? [];
        if (!cfg.instructions.includes(MCP_MANAGEMENT_TEMPLATE)) {
          cfg.instructions.push(MCP_MANAGEMENT_TEMPLATE);
          log('agent-guard: injected MCP-management template: ' + MCP_MANAGEMENT_TEMPLATE);
        }
      }

      // R2 interim nudge until package-manager setup is handled by a skill.
      toast(
        'JFrog: run `jf setup <pm>` to configure package managers against Artifactory.',
        'info'
      );
    },
  };
};

export const server = jfrogOpencodePlugin;
export const JfrogOpencodePlugin = jfrogOpencodePlugin;
