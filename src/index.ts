// (c) JFrog Ltd. (2026)
import type { Config, Plugin } from '@opencode-ai/plugin';
import {
  accessSync,
  appendFileSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'fs';
import { delimiter, dirname, join } from 'path';
import { fileURLToPath } from 'url';

// ── Constants ─────────────────────────────────────────────────────────────────

const LOG_FILE = join(process.cwd(), '.opencode', 'event-log.txt');

// Works for both src/index.ts (dev) and dist/index.js (installed): `..` lands on skills/ in both.
const BUNDLED_SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');

// Env var holding the JFrog platform host for the MCP URL, e.g. `mycompany.jfrog.io`
const HOST_ENV_VAR = 'JFROG_PLATFORM_URL';

const JF_CLI_INSTALL_HINT =
  'JFrog: the `jf` CLI was not found on your PATH. Install it ' +
  '(https://jfrog.com/getting-started-with-jfrog-cli/) to run JFrog commands and `jf setup <pm>`.';

// ── Types ─────────────────────────────────────────────────────────────────────

type Logger = (_message: string) => void;
type Toast = (_message: string, _variant: 'error' | 'info') => void;
type ConfigWithJfrog = Config & {
  skills?: { paths?: string[] };
  mcp?: Record<string, unknown>;
};
type McpCredentials = { baseUrl: string };
type McpServer = NonNullable<Config['mcp']>[string];

// ── Pure helpers ────────────────────────────────────────────────────────────────

const isNonEmptyDir = (dir: string): boolean => {
  try {
    return existsSync(dir) && statSync(dir).isDirectory() && readdirSync(dir).length > 0;
  } catch {
    return false;
  }
};

/**
 * True if `cmd` is found as an executable on PATH. Cheap synchronous scan; spawns no subprocess.
 * Cross-platform: uses the OS PATH delimiter and probes Windows executable extensions.
 */
const commandExists = (cmd: string): boolean => {
  const names = process.platform === 'win32' ? [`${cmd}.exe`, `${cmd}.cmd`, `${cmd}.bat`] : [cmd];
  return (process.env.PATH ?? '').split(delimiter).some((dir) =>
    !dir
      ? false
      : names.some((name) => {
          try {
            accessSync(join(dir, name), constants.X_OK);
            return true;
          } catch {
            return false;
          }
        })
  );
};

// Preserve an explicit http/https scheme (default https when none); strip trailing slashes.
const toBaseUrl = (raw: string): string => {
  const trimmed = raw.replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

const isJfCommand = (command: string): boolean => /(?:^|[\s;&|(])jf(?:\s|$)/.test(command);

/**
 * Resolve the JFrog MCP host from `JFROG_PLATFORM_URL`.
 * Returns undefined when MCP is disabled or the host is absent.
 */
const resolveMcpCredentials = (): McpCredentials | undefined => {
  if (process.env.JFROG_MCP_DISABLE === 'true') {
    return undefined;
  }
  const host = process.env[HOST_ENV_VAR];
  return host ? { baseUrl: toBaseUrl(host) } : undefined;
};

/**
 * Build the OpenCode remote-MCP entry for the JFrog Platform MCP (OAuth only).
 *
 */
const mcpServerEntry = ({ baseUrl }: McpCredentials): McpServer => ({
  type: 'remote',
  url: `${baseUrl}/mcp`,
  enabled: true,
});

// ── Config mutators (side-effecting, but localized) ───────────────────────────────

// The config hook runs multiple times per session; surface the broken-package error only once.
let skillsErrorShown = false;

/** Register the bundled skills dir. Returns false (and toasts once) when the package is broken. */
const registerSkills = (cfg: ConfigWithJfrog, log: Logger, toast: Toast): boolean => {
  cfg.skills = cfg.skills ?? {};
  cfg.skills.paths = cfg.skills.paths ?? [];

  if (!isNonEmptyDir(BUNDLED_SKILLS_DIR)) {
    if (!skillsErrorShown) {
      skillsErrorShown = true;
      const message =
        `JFrog: bundled skills not found at ${BUNDLED_SKILLS_DIR}. ` +
        'The plugin package may be broken; reinstall @jfrog/opencode-jfrog-plugin.';
      log('ERROR ' + message);
      toast(message, 'error');
    }
    return false;
  }

  if (!cfg.skills.paths.includes(BUNDLED_SKILLS_DIR)) {
    cfg.skills.paths.push(BUNDLED_SKILLS_DIR);
  }
  log('config.skills.paths=' + JSON.stringify(cfg.skills.paths));
  return true;
};

/** Inject the JFrog Platform remote MCP. No network on load; never clobbers a user-defined `jfrog`. */
const registerMcp = (cfg: ConfigWithJfrog, log: Logger): void => {
  const credentials = resolveMcpCredentials();
  if (!credentials) {
    log(
      'mcp: jfrog remote MCP not registered (need JFROG_PLATFORM_URL; or JFROG_MCP_DISABLE=true)'
    );
    return;
  }

  cfg.mcp = cfg.mcp ?? {};
  if (cfg.mcp.jfrog) {
    return;
  }
  cfg.mcp.jfrog = mcpServerEntry(credentials);
  log(`mcp: registered jfrog remote MCP (OAuth) at ${credentials.baseUrl}/mcp`);
};

// ── Plugin ────────────────────────────────────────────────────────────────────

/** OpenCode loads plugins via the `server` export (see `PluginModule` in @opencode-ai/plugin). */
const jfrogOpencodePlugin: Plugin = async ({ client }) => {
  if (!existsSync(dirname(LOG_FILE))) {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
  }

  const log: Logger = (message) => {
    if (process.env.JFROG_DEBUG_LOGS === 'true') {
      appendFileSync(LOG_FILE, message + '\n', 'utf-8');
    }
  };

  // Fire-and-forget: in headless sessions showToast never resolves, awaiting it would hang the hook.
  const toast: Toast = (message, variant) => {
    void client.tui
      .showToast({ body: { message, variant, duration: 10000 } })
      .catch(() => undefined);
  };

  log('JfrogOpencodePlugin starting...');

  // Detect the JFrog CLI ONCE at load (cached for the session) so the per-tool hook stays a cheap
  // boolean check. MCP setup issues (missing env, OAuth not completed, 401) are surfaced by OpenCode's
  // own `mcp list`/TUI and documented in the README — the plugin does not nag for those.
  const hasJfCli = commandExists('jf');
  log('jf CLI on PATH: ' + hasJfCli);

  // Nudge to install the CLI just-in-time — on the first `jf` command — at most once per session. A
  // tool hook fires mid-session (TUI live); a config-hook toast would be dropped at bootstrap before
  // the TUI subscribes to events.
  let installHintShown = false;
  const adviseInstallOnce = (): void => {
    if (installHintShown || hasJfCli) {
      return;
    }
    installHintShown = true;
    toast(JF_CLI_INSTALL_HINT, 'info');
  };

  return {
    config: async (config) => {
      const cfg = config as ConfigWithJfrog;
      // Skills and MCP are independent features — register both even if one is broken.
      registerSkills(cfg, log, toast);
      registerMcp(cfg, log);
    },
    'tool.execute.before': async (input, output) => {
      if (installHintShown || hasJfCli || input.tool !== 'bash') {
        return;
      }
      const command = String((output.args as { command?: string })?.command ?? '');
      if (isJfCommand(command)) {
        adviseInstallOnce();
      }
    },
  };
};

export const server = jfrogOpencodePlugin;
export const JfrogOpencodePlugin = jfrogOpencodePlugin;
