// (c) JFrog Ltd. (2026)
import type { Config, Plugin } from '@opencode-ai/plugin';
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const LOG_FILE = join(process.cwd(), '.opencode', 'event-log.txt');

// dist/index.js -> ../skills after build/install; src/index.ts -> ../skills in dev.
const BUNDLED_SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');

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
type ConfigWithSkills = Config & { skills?: { paths?: string[] } };

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

      // Register the JFrog Platform remote MCP server. OpenCode handles OAuth lazily on first use,
      // so no auth config is needed and there is no network call on load.
      const platformUrl = process.env.JFROG_URL ?? process.env.JFROG_PLATFORM_URL;
      if (platformUrl) {
        const host = platformUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
        const url = `https://${host}/mcp`;
        cfg.mcp = cfg.mcp ?? {};
        // Non-destructive: never overwrite a user-defined `jfrog` MCP entry.
        if (!cfg.mcp.jfrog) {
          cfg.mcp.jfrog = { type: 'remote', url, enabled: true };
          log('registered jfrog MCP: ' + url);
        }
      } else {
        log('JFROG_URL/JFROG_PLATFORM_URL not set; skipping JFrog MCP registration');
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
