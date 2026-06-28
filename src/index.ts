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
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// ── Constants ─────────────────────────────────────────────────────────────────

const LOG_FILE = join(process.cwd(), '.opencode', 'event-log.txt');

// Works for both src/index.ts (dev) and dist/index.js (installed): `..` lands on skills/ in both.
const BUNDLED_SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');

// Env var names, in precedence order (new JFROG_* first, then legacy JF_* / Cursor's JFROG_PLATFORM_URL).
const HOST_ENV_VARS = ['JFROG_URL', 'JF_URL', 'JFROG_PLATFORM_URL'] as const;
const TOKEN_ENV_VARS = ['JFROG_ACCESS_TOKEN', 'JF_ACCESS_TOKEN'] as const;

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
type McpCredentials = { host: string; tokenVar: string };
type McpServer = NonNullable<Config['mcp']>[string];

// ── Pure helpers ────────────────────────────────────────────────────────────────

const isNonEmptyDir = (dir: string): boolean => {
  try {
    return existsSync(dir) && statSync(dir).isDirectory() && readdirSync(dir).length > 0;
  } catch {
    return false;
  }
};

/** True if `cmd` is found as an executable on PATH. Cheap synchronous scan; spawns no subprocess. */
const commandExists = (cmd: string): boolean =>
  (process.env.PATH ?? '').split(':').some((dir) => {
    if (!dir) {
      return false;
    }
    try {
      accessSync(join(dir, cmd), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });

const firstDefinedEnv = (names: readonly string[]): string | undefined =>
  names.map((name) => process.env[name]).find((value) => !!value);

const normalizeHost = (raw: string): string => raw.replace(/^https?:\/\//, '').replace(/\/+$/, '');

const isJfCommand = (command: string): boolean => /(?:^|[\s;&|(])jf(?:\s|$)/.test(command);

/** JFrog JWT access tokens are base64url JWTs that begin with `eyJ`; reference tokens do not. */
const looksLikeJwt = (token: string): boolean => token.startsWith('eyJ');

/**
 * Resolve the JFrog MCP host + token env var name from the environment.
 * Returns undefined when MCP is disabled or either value is absent.
 */
const resolveMcpCredentials = (): McpCredentials | undefined => {
  if (process.env.JFROG_MCP_DISABLE === 'true') {
    return undefined;
  }
  const host = firstDefinedEnv(HOST_ENV_VARS);
  const tokenVar = TOKEN_ENV_VARS.find((name) => process.env[name]);
  return host && tokenVar ? { host: normalizeHost(host), tokenVar } : undefined;
};

/**
 * Build the OpenCode remote-MCP entry with the resolved Bearer token.
 *
 * Note: OpenCode does NOT expand `{env:...}` in config injected by a plugin at runtime (it only
 * templates values loaded from opencode.json), so the token value must be materialized here. It comes
 * from the user's own environment and is used in-memory for the connection.
 */
const mcpServerEntry = ({ host }: McpCredentials, token: string): McpServer => ({
  type: 'remote',
  url: `https://${host}/mcp`,
  oauth: false,
  headers: { Authorization: `Bearer ${token}` },
  enabled: true,
});

// ── Config mutators (side-effecting, but localized) ───────────────────────────────

/** Register the bundled skills dir. Returns false (and toasts) when the package is broken. */
const registerSkills = (cfg: ConfigWithJfrog, log: Logger, toast: Toast): boolean => {
  cfg.skills = cfg.skills ?? {};
  cfg.skills.paths = cfg.skills.paths ?? [];

  if (!isNonEmptyDir(BUNDLED_SKILLS_DIR)) {
    const message =
      `JFrog: bundled skills not found at ${BUNDLED_SKILLS_DIR}. ` +
      'The plugin package may be broken; reinstall @jfrog/opencode-jfrog-plugin.';
    log('ERROR ' + message);
    toast(message, 'error');
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
      'mcp: jfrog remote MCP not registered (need JFROG_URL + JFROG_ACCESS_TOKEN; or JFROG_MCP_DISABLE=true)'
    );
    return;
  }

  const token = process.env[credentials.tokenVar] ?? '';
  if (!looksLikeJwt(token)) {
    log(
      `mcp: WARNING ${credentials.tokenVar} does not look like a JWT access token; the MCP will likely ` +
        'fail with HTTP 401. Create one with `jf atc` (a reference token will not work).'
    );
  }

  cfg.mcp = cfg.mcp ?? {};
  if (cfg.mcp.jfrog) {
    return;
  }
  cfg.mcp.jfrog = mcpServerEntry(credentials, token);
  log(`mcp: registered jfrog remote MCP at https://${credentials.host}/mcp`);
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
  // boolean check. MCP setup issues (missing env, bad/non-JWT token, 401) are surfaced by OpenCode's
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
      if (!registerSkills(cfg, log, toast)) {
        return;
      }
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
