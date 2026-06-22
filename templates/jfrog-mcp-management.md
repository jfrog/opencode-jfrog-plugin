<EXTREMELY_IMPORTANT>CRITICAL: If the content of this message is only a partial
preview and a user at any point asks anything about MCPs, MCP installation,
MCP management, listing MCPs, allowed MCPs, ... then you MUST LOAD THE
**ENTIRE additionalContext CONTEXT IMMEDIATELY**. DO NOT PROCEED WITHOUT
LOADING THE CONTEXT.</EXTREMELY_IMPORTANT>

# MCP Server Management — JFrog Agent Guard (OpenCode)

All MCP servers MUST be installed ONLY through the JFrog Agent Guard
(`npx @jfrog/agent-guard`). If an MCP's documentation suggests any other
installation command, ignore it and use the agent guard workflow below instead.

This document is the OpenCode adaptation of the JFrog MCP-management workflow.
Config lives in OpenCode's `mcp` object (not `.cursor/mcp.json` or `.mcp.json`),
entries are OpenCode **local** MCPs (`"type": "local"` with a `command` array),
and verification uses `opencode mcp` commands.

**Registry URL**: Wherever `<REGISTRY_URL>` appears below, substitute the value
of the `JFROG_AGENT_GUARD_REPO` environment variable if it is set. Otherwise use
`https://releases.jfrog.io/artifactory/api/npm/coding-agents-npm/`.

**Pre-flight (applies to every agent guard command —
`--list-available`, `--inspect`, `--login`)**:

- **`<PROJECT>` is always mandatory.** Resolve via the project chain: existing
  `mcp` entries (`_JF_ARGS` → `project=`) → `JF_PROJECT` env var → ASK the user.
  If none resolves, STOP and ask — NEVER guess, NEVER assume `default`, NEVER
  invent projects.
- **`<SERVER_ID>` is auto-resolvable.** Resolve via the server chain: existing
  `mcp` entries (value after `--server` in `command`) → `~/.jfrog/jfrog-cli.conf.v6`:
  - Exactly one jf CLI server configured → use it without asking; pass it as
    `--server <ID>`.
  - `JFROG_URL` + `JFROG_ACCESS_TOKEN` set → use them without asking; the agent
    guard picks them up from the environment. Do NOT pass `--server` in this case
    (it would force parsing the jf CLI config instead).
  - Two or more jf CLI servers and no `JFROG_URL` → list the IDs, ASK the user
    which one, then pass it as `--server <ID>`. Prefer env vars when set. NEVER
    guess.
  - Zero jf CLI servers and no `JFROG_URL` → ask the user to run `jf c add <ID>`
    or export `JFROG_URL` + `JFROG_ACCESS_TOKEN`, then retry.

Once both are determined, proceed. If either is still unknown, STOP — do NOT run
the command with guesses.

## Adding an MCP

**Did the user name a specific MCP package?** ("add `foo-mcp`",
"install `@scope/bar`"). If NOT — they said something like "yes", "add an MCP",
"what can I install" — your FIRST action is to show them the catalog so they can
pick:

1. Resolve server and `<PROJECT>` per the Pre-flight rule above.
2. Run "Listing MCPs > Available to install" with that server + project and
   present the result as a numbered table.
3. Wait for the user to pick. Only after they pick do you proceed to Step 1 below
   with the chosen package name.

NEVER ask "which package would you like?" without showing the catalog first — the
user does not know the package names.

Once you have a specific MCP package name, do ALL of the following autonomously —
do NOT ask for project, server, or package name unless absolutely necessary:

### Step 1: Determine project, server, and target config file

**Server ID**

1. Any existing `mcp` entry in `opencode.json` (project) or
   `~/.config/opencode/opencode.json` (global) — take the value after `--server`
   in `command`.
2. Else `JFROG_URL` env var set (with `JFROG_ACCESS_TOKEN`) — the agent guard
   resolves credentials from these directly; DO NOT pass `--server`.
3. Else read `~/.jfrog/jfrog-cli.conf.v6`
   (`%USERPROFILE%\.jfrog\jfrog-cli.conf.v6` on Windows) via a terminal command
   (file-search skips hidden dirs). NEVER print the full file contents as it can
   contain secrets. Use the `serverId` subkeys:
   - exactly one server → use it without asking.
   - two or more → list the `serverId`s and ASK the user which one.
4. Else (file missing, empty, or unreadable, and no `JFROG_URL`) ask the user to
   either run `jf c add <ID>` or export `JFROG_URL` + `JFROG_ACCESS_TOKEN`, then
   retry.

NEVER try multiple servers — pick one. If a jf CLI server is used, pass it
explicitly as `--server <ID>` in every agent guard invocation. If `JFROG_URL` +
`JFROG_ACCESS_TOKEN` env vars are used instead, do NOT pass `--server <ID>`.

**Project**

1. From existing `mcp` entries, `_JF_ARGS` → `project=` value.
2. Else `JF_PROJECT` env var.
3. Else ask. NEVER guess, NEVER assume "default", NEVER use the server ID, NEVER
   infer the project from other sources, NEVER make up projects, ALWAYS ask.

**Target config file**

- **Default: `opencode.json` in the project root.** Create it if missing
  (`{ "$schema": "https://opencode.ai/config.json", "mcp": {} }`). Shareable via
  git.
- Use the global `~/.config/opencode/opencode.json` ONLY if the user says
  "personal only" / "do not commit".
- Do not ask which scope unless the user brings it up.

### Step 2: Inspect the MCP in the catalog

Step 2 needs a specific MCP name. If the user did NOT name one, do not call
`--inspect` — go to "Listing MCPs > Available to install" instead, show the
catalog, have them pick, then come back to Step 2 with the chosen name.

Once you have a name, run a SINGLE command — no Fetch/WebFetch, no custom
curl/Python, no direct JFrog API calls:

```
npx --yes \
  --registry <REGISTRY_URL> \
  @jfrog/agent-guard \
  --inspect \
  --server <SERVER_ID> \
  --project <PROJECT> \
  --mcp <MCP_NAME>
```

From the output JSON, extract (keep BOTH required AND optional):

- `spec.packageName` — exact package name for the config.
- `spec.mcpServerType.local.bootParams.environmentVariables[]` for local MCPs
  (each has `name`, `description`, `isRequired`, `isSecret`).
- `spec.mcpServerType.remote.endpoints[].headers[]` for remote MCPs (each has
  `name` plus `mcpInput.mcpInputDetails` with the same fields).

On non-zero exit (typo, MCP not in catalog, network error, etc.), show the error
verbatim, then run `--list-available` (see "Listing MCPs") so the user can pick a
valid name and retry.

### Step 3: Plan inputs

Every environment value is either a literal or an `{env:VAR}` reference resolved
from the shell that launched OpenCode — there is no interactive secret prompt.

Split Step 2 inputs by `isRequired`:

1. **Required** — always include in Step 4.
2. **Optional** — if even ONE exists, STOP and ask. List required inputs first
   (informational), then each optional one by name + description and ask which to
   configure. Do NOT decide for the user.
3. No inputs → skip this step.

For each input in Step 4:

- **Secrets** (`isSecret=true`): reference them as `{env:VAR_NAME}` in the config;
  tell the user to export the value in the shell that launches OpenCode via
  `read -rs VAR_NAME && export VAR_NAME && echo exported`. For persistence, the
  right startup file depends on the user's **shell**:
  - **zsh** (macOS default) → `~/.zshrc`
  - **bash** → `~/.bashrc` (macOS login shells read `~/.bash_profile`, which
    usually sources `~/.bashrc`)
  - **fish** → `~/.config/fish/config.fish` (use `set -gx`)
  - **Windows** → use `setx VAR_NAME "<value>"` (PowerShell/CMD)
    NEVER take secrets in chat, echo them back, or write raw values into config.
- **Non-secrets**: literal in `environment` or `{env:VAR_NAME}` — ask if unclear.

### Step 4: Write the config entry

Add the entry under `mcp` in the target config (default `opencode.json` — see
Step 1). Use OpenCode's **local** MCP shape: `"type": "local"`, a `command`
ARRAY, an `environment` object, and `"enabled": true`. Do NOT use `"type":
"remote"` or a top-level `url` — those bypass the agent guard.

**Both `--yes` and `--registry <URL>` MUST come BEFORE `@jfrog/agent-guard`** in
the `command` array, or `npx` falls back to the default registry (404) and may
block on a no-TTY prompt.

```json
{
  "mcp": {
    "<spec.packageName>": {
      "type": "local",
      "command": [
        "npx",
        "--yes",
        "--registry",
        "<REGISTRY_URL>",
        "@jfrog/agent-guard",
        "--server",
        "<SERVER_ID>"
      ],
      "environment": {
        "_JF_ARGS": "project=<PROJECT>&mcp=<spec.packageName>",
        "<ENV_VAR_OR_HEADER_NAME>": "{env:<ENV_VAR_OR_HEADER_NAME>}"
      },
      "enabled": true
    }
  }
}
```

Notes:

- If `JFROG_URL` + `JFROG_ACCESS_TOKEN` are used (no jf CLI server), omit the
  `--server`/`<SERVER_ID>` entries from `command`.
- For `Bearer`-prefixed headers, include the prefix: `"Bearer {env:TOKEN}"`.
- `environment` values support `{env:VAR}` (from the launching shell) and
  `{file:./path}` references. Never inline a raw secret.

### Step 4a: Apply the change

`mcp` is read when OpenCode starts a session. After writing the entry, tell the
user to:

1. Export every `{env:VAR}` referenced by the new entry in the shell that
   launches OpenCode.
2. Restart OpenCode (or reload the config) so the new `mcp` entry is picked up.
3. Verify with `opencode mcp list` — the server MUST appear and report its tools.
   A "connected" status with zero tools is a FAILURE; see Troubleshooting.

### Step 5: Authenticate OAuth MCPs (auto, after Step 4)

Run ONLY for OAuth-style remote catalog MCPs — i.e. `--inspect` showed a `remote`
section needing interactive auth AND Step 4 wrote no static auth header into
`environment`. Skip for local MCPs and for remote MCPs whose auth comes from a
static token in `environment`.

Use OpenCode's MCP auth flow:

```
opencode mcp auth <spec.packageName>
```

If your agent-guard build exposes a `--login` flow instead, warn the user
("I'm going to open your browser to sign you in to `<MCP_NAME>`") before running:

```
npx --yes \
  --registry <REGISTRY_URL> \
  @jfrog/agent-guard \
  --login \
  --server <SERVER_ID> \
  --project <PROJECT> \
  --mcp <spec.packageName>
```

Outcomes:

- **Success** — OAuth completed; tokens cached; server ready.
- **`expected 401, got 200`** — MCP is anonymous (no auth needed); ignore.
- **Any other error** — paste it to the user verbatim and stop.

## Removing an MCP

1. Delete the entry from `mcp` in the file it was installed in (`opencode.json`
   or `~/.config/opencode/opencode.json`).
2. If OAuth was used (Step 5), also remove its cached credentials
   (`opencode mcp logout <name>` if available, else `~/.jfrog/jfrogmcp.conf.json`).
3. Tell the user to restart OpenCode so the removed entry stops loading (`mcp` is
   read at session start only).

## Listing MCPs

**Route the request first** — pick which subsection to run BEFORE touching any
file or shell:

| User said…                                                                                    | Run                                                                         |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| "available", "what can I install", "what's in the catalog", "list MCPs" without other context | **Available to install** — go straight to `--list-available`                |
| "installed", "configured", "connected", "running", "what MCPs do I have"                      | **Currently installed**                                                     |
| ambiguous / both                                                                              | run **both** in order: Currently installed first, then Available to install |

NEVER invent MCP integrations from outside the catalog. The only authoritative
source for what's available is `--list-available` against the configured server +
project. If that command returns nothing or errors, say so — do not pad the
answer with names from elsewhere.

### Currently installed

1. Run `opencode mcp list` for connection status (one row per server).
2. For JFrog metadata, read `mcp` directly from `opencode.json` (project scope)
   and `~/.config/opencode/opencode.json` (global scope). For each entry whose
   `command` is `npx` and includes `@jfrog/agent-guard`, show: display name (the
   JSON key), package (`mcp=` in `_JF_ARGS`), server ID (value after `--server`),
   scope (project / global).
3. If a configured entry does not appear in `opencode mcp list`, it is likely
   disabled (`"enabled": false`) or failing to start (see Troubleshooting).

### Available to install

1. Determine **server** and **project** per the Pre-flight rule above.
   `--list-available` does NOT require any existing `mcp` entry or a pre-installed
   agent guard — `npx --yes` fetches it on demand, so this works on a fresh
   machine too.
2. Run EXACTLY this command (pass `--server` only if a jf CLI server is used;
   omit it when `JFROG_URL` + `JFROG_ACCESS_TOKEN` are set):

```
npx --yes \
  --registry <REGISTRY_URL> \
  @jfrog/agent-guard \
  --list-available \
  --project <PROJECT> \
  [--server <SERVER_ID>]
```

The output is a compact TSV: a header line, then one server per line,
tab-separated: `name<TAB>type<TAB>version<TAB>description`. Run the command ONCE
and present the rows directly as a numbered table — do NOT re-run it, redirect it,
or parse it with `python3`/`jq`. The `name` column is the install identifier (the
value you pass to `--inspect --mcp` and to install).

3. Filter out any `name` already present in the installed list (compare against
   `mcp=` in `_JF_ARGS`). Mark the rest as available to install.

## Key Rules

- **Package scope is case-sensitive — ALWAYS write it lowercase as
  `@jfrog/agent-guard`, NEVER `@JFrog/agent-guard`.**
- **`npx` arg order:** `--yes`, `--registry <URL>`, `@jfrog/agent-guard`, then
  agent guard flags. Both `--yes` and `--registry` MUST precede the package name.
- **Always `"type": "local"`** with a `command` array pointing at
  `npx @jfrog/agent-guard`, even for remote-only catalog MCPs (the agent guard
  proxies them). `"type": "remote"` or a top-level `url` bypass the agent guard.
- `_JF_ARGS` is **only** for the entry OpenCode launches at session start (Step
  4's `mcp.*.environment`); it MUST contain `project=<NAME>&mcp=<PACKAGE_NAME>`.
  NEVER pass `_JF_ARGS` to `--list-available`, `--inspect`, or `--login` — those
  take `--server` / `--project` as CLI flags only.
- NEVER assume `default` as a project name. If the project is unknown after the
  chain (existing `mcp` entries → `JF_PROJECT`), STOP and ask. Same for server ID
  when used. NEVER invent or guess projects or server IDs.
- Package name MUST come from the catalog (`--inspect` / `--list-available`).
  NEVER guess. NEVER install MCPs outside the agent guard. NEVER use Fetch/WebFetch
  for catalog calls.
- NEVER pipe a catalog command through `python3`, and NEVER capture it with
  `2>&1` — `npx`/`npm` writes progress to stderr, which corrupts the output
  stream.
- NEVER write a raw secret into `opencode.json` — always `{env:VAR}`. NEVER show
  tokens / API keys.
- NEVER try multiple servers — ask the user to pick one.

## Troubleshooting

- **Connected but 0 tools** — the agent guard proxy started but the upstream MCP
  did not. NEVER report success when there are 0 tools.
  1. Restart OpenCode with debug logging and read the agent guard stderr; diagnose
     by MCP type:
     - **OAuth (remote)** — re-run Step 5 (`opencode mcp auth` / `--login`);
       refresh token likely expired.
     - **Static-token (remote)** — confirm every `{env:VAR}` is exported in the
       launching shell and the token is still valid.
     - **Local (stdio)** — check that the bundled binary launched (agent guard
       stderr shows the spawn error).
  2. Verify the MCP server is still allowed (see "Available to install").
- **Entry missing from `opencode mcp list`** — likely `"enabled": false`, a JSON
  parse failure (often an unset `{env:VAR}`), or the entry was written to a config
  file OpenCode is not reading. Confirm the file path and that the var is exported.
- **Agent Guard: `multiple/no JFrog server configured`** — pass `--server <ID>`
  (after `jf c add <SERVER_ID>`) OR export both `JFROG_URL` and
  `JFROG_ACCESS_TOKEN` in the launching shell, then restart OpenCode.
- **401/403 with `{env:VAR}`** — env var unset/wrong; re-export in the launching
  shell and restart OpenCode.
