# JFrog Plugin for OpenCode

JFrog plugin for [OpenCode](https://opencode.ai/): artifact management, security
scanning, supply-chain best practices, and Agent Guard. The plugin ships the official
JFrog [Agent Skills](https://opencode.ai/docs/skills/) with the package and registers
them with OpenCode at load time, plus the JFrog Platform MCP server.

> **Related OpenCode work:** installation doc improvements ([AX-1780](https://jfrog-int.atlassian.net/browse/AX-1780)) and init support ([AX-2122](https://jfrog-int.atlassian.net/browse/AX-2122), [AX-2124](https://jfrog-int.atlassian.net/browse/AX-2124)).

## Features

The JFrog plugin provides the following capabilities, grouped by component:

| Component | Feature | Description |
| --- | --- | --- |
| **MCP** | JFrog Platform MCP server | Registers the remote JFrog Platform MCP (`https://${JFROG_PLATFORM_URL}/mcp`, OAuth) into OpenCode's `config.mcp.jfrog`. Authenticate once with `opencode mcp auth jfrog`. Opt out with `JFROG_MCP_DISABLE=true`. |
| **Skill** | JFrog Platform | Interact with Artifactory repositories, builds, permissions, users, access tokens, projects, release bundles, and platform administration via the JFrog CLI and REST/GraphQL APIs. Also covers security audits, CVE lookups, and Advanced Security exposure queries. |
| **Skill** | Package safety & download | Check whether npm, Maven, PyPI, Go, and other packages are safe, curated, or allowed, then download them through Artifactory remote caches or curation-aware package managers. |
| **Skill** | Agent Guard | OpenCode manages MCPs through the JFrog Agent Guard. Discover, install, configure, update, and remove MCP servers from the JFrog AI Catalog approved for your project, and authenticate to remote HTTP MCPs via OAuth, API key, or bearer token. |

The skills ship **with the plugin** (vendored and pinned) — they are **not** downloaded
at runtime, so the plugin works offline and the skill set is reproducible for a given
plugin version.

---

## Prerequisites

Before installing, make sure you have:

- **JFrog host** — A [JFrog Platform](https://jfrog.com) instance you can authenticate against, exposed to the plugin as `JFROG_PLATFORM_URL` (e.g. `mycompany.jfrog.io`). The JFrog Platform MCP server authenticates via OAuth (browser sign-in).
- **OpenCode** — Installed (verified against OpenCode **1.17.7** and newer, which honors `config.skills.paths` in object form).
- **Node.js** (≥ 18) — with `npx` on your `PATH` (used by the Agent Guard).
- **Skill runtime requirements** — `jf` CLI, `jq`, and `curl` on `PATH`, plus a configured JFrog CLI server. For the minimum versions, see the upstream skills [`Requirements`](https://github.com/jfrog/jfrog-skills/blob/v0.22.0/README.md#requirements). Configure the CLI with `jf login` / `jf config add` — see [Authentication](#authentication).
- **JFrog AI Catalog** (optional) — If you want to use the Agent Guard feature, your JFrog subscription needs to include the AI Catalog entitlement. Contact your JFrog account team if you're unsure whether it's enabled.
- **JFrog CLI ≥ 2.105.0** (optional) — If you want the Agent Guard to auto-resolve the credentials/server ID from the JFrog CLI configuration.
- **JFrog project** (optional) — If you want to use the Agent Guard feature.

---

## Installation

### Install the OpenCode plugin

The plugin is published to public npm as
[`@jfrog/opencode-jfrog-plugin`](https://www.npmjs.com/package/@jfrog/opencode-jfrog-plugin)
and listed on the [OpenCode ecosystem page](https://opencode.ai/docs/ecosystem). OpenCode has
no plugin marketplace — you install by referencing the npm package in your OpenCode config
(`opencode.json`):

```json
{
  "plugin": ["@jfrog/opencode-jfrog-plugin"]
}
```

OpenCode resolves the package from npm and loads it. To pin a specific version use
`"@jfrog/opencode-jfrog-plugin@<version>"`; omitting the version tracks the latest
release. For an organization-wide rollout, set the plugin in OpenCode's
[remote configuration](https://opencode.ai/docs/config/#remote) so every developer
gets it automatically.

**Restart OpenCode completely** after editing `opencode.json` or changing any JFrog
environment variable. Starting a new session, or reloading the window, is not enough —
the plugin reads its configuration at load time.

#### Config file location

| Platform | Path |
| --- | --- |
| macOS / Linux | `~/.config/opencode/opencode.json` |
| Windows | `%APPDATA%\opencode\opencode.json` |

OpenCode Desktop and the CLI share this config.

### Local development

Test an uncommitted checkout without publishing. Build the module, then point your
OpenCode config at the local build:

```bash
mise run build
```

```json
{
  "plugin": ["file:///absolute/path/to/opencode-jfrog-plugin/dist/index.js"]
}
```

Local paths must be absolute (`file://`) or start with `./` / `../` (resolved
relative to the config file). Restart OpenCode after a rebuild to pick up changes.

---

## How it works

The plugin is intentionally **thin**. On load it resolves its bundled `skills/`
directory (shipped inside the package) and registers it with OpenCode through the
`config` hook by adding it to `config.skills.paths`. OpenCode then discovers the
skills the same way it discovers any skill — via the `skill` tool and `/skills` — and
invokes them when relevant. There is no runtime download, unzip, or network call on
load.

The plugin is **self-contained**: everything it needs ships in the published npm tarball
(`dist/` + the vendored `skills/`), with no runtime downloads and no dependency on
`releases.jfrog.io` or any other external artifact host.

---

## Authentication

Configure the JFrog CLI so the skills and Agent Guard can reach your platform. Run
`jf login` for browser-based setup, or if you have never configured the JFrog CLI on
this machine:

1. Open your terminal.
2. Run:

   ```bash
   jf config add
   ```

3. Follow the interactive prompts to enter your JFrog platform URL and access token.

The JFrog Platform MCP server authenticates separately, via OAuth — see below.

---

## JFrog Platform MCP server

When `JFROG_PLATFORM_URL` is set, the plugin registers the **JFrog Platform remote MCP
server** (`https://${JFROG_PLATFORM_URL}/mcp`) into `config.mcp.jfrog`, so the JFrog
platform tools appear in OpenCode alongside the skills.

**Prerequisite — set the JFrog host:**

- `JFROG_PLATFORM_URL` — your JFrog platform host, e.g. `mycompany.jfrog.io` (bare host, no scheme — `https://` is added automatically).

**Authentication is OAuth only.** The plugin registers the entry with OAuth
auto-detection enabled. OpenCode discovers the OAuth authorization server advertised 
by the `/mcp` endpoint, and you sign in once through the browser:

```bash
opencode mcp auth jfrog     # runs the OAuth flow and stores the tokens
opencode mcp list           # jfrog should now show as connected
```

Related commands: `opencode mcp logout jfrog` and `opencode mcp debug jfrog`.

**Opt-out:** set `JFROG_MCP_DISABLE=true` to skip MCP registration entirely. You can
also scope the exposed tools via OpenCode's `tools` globbing. If you define your own
`mcp.jfrog` server in your config, the plugin leaves it untouched.

**Context cost:** the JFrog MCP exposes ~56 tools whose schemas are loaded into the
model context on every request (OpenCode has no lazy tool loading), measured at roughly
**+32K tokens per request**. If that overhead matters, disable it with
`JFROG_MCP_DISABLE=true` or narrow the surface with `tools` globbing. The bundled
**skills** do not carry this cost — only their short descriptions stay in context, and a
skill's body loads only when it is invoked.

---

## Verify

Verification is a required install step, not a troubleshooting fallback. After
restarting OpenCode, confirm all four:

1. OpenCode's startup output resolves `@jfrog/opencode-jfrog-plugin` without a plugin load error.
2. `/skills` in a session — `jfrog` and the other bundled skills are listed.
3. `opencode mcp list` — `jfrog` shows as connected after `opencode mcp auth jfrog`.
   (Skip this if you set `JFROG_MCP_DISABLE=true`.)
4. `jf rt ping` — succeeds against your configured JFrog server.

Skills loading while the MCP stays disconnected usually means `JFROG_PLATFORM_URL` was
set after OpenCode started, or the OAuth sign-in has not been completed. Setting
environment variables without a full restart does not repair it.

| Symptom | Do this | Do **not** do this |
| --- | --- | --- |
| MCP disconnected after install | Set `JFROG_PLATFORM_URL` in the environment that **launches** OpenCode, run `opencode mcp auth jfrog`, **quit and restart OpenCode**, then `opencode mcp list`. | Expect a new session or window reload to pick up env vars. |
| Skills load but MCP is missing | Confirm `JFROG_MCP_DISABLE` is not `true`, set the host before start, complete OAuth. | Set `JFROG_ACCESS_TOKEN` — MCP auth is OAuth only. |
| Config change not applied | Edit `opencode.json`, then fully quit and restart OpenCode. | Start a new chat without restarting. |

---

## Usage

Once configured, interact with the JFrog plugin through natural language. Examples are
grouped by capability.

### JFrog Platform skill

| Ask the agent… | What happens |
| --- | --- |
| "List my Artifactory repositories." | Returns repositories via the JFrog CLI. |
| "Upload this build to Artifactory." | Publishes build artifacts and metadata. |
| "Run a security audit on this project." | Runs an Xray / Advanced Security audit and summarizes findings. |
| "Show me details on CVE-2021-23337." | Looks up CVE details in JFrog Advanced Security. |
| "Create a scoped access token for CI." | Creates an access token with the requested scope. |
| "Promote this release bundle to production." | Uses Lifecycle / Distribution APIs to promote the bundle. |

### Package safety & download skill

| Ask the agent… | What happens |
| --- | --- |
| "Is `lodash@4.17.21` safe to install?" | Checks JFrog Public Catalog signals and curation policy for the package. |
| "Is this Maven package approved for use?" | Checks curation entitlement and policy for the requested package. |
| "Download `requests` via JFrog." | Resolves the package through an Artifactory remote cache or curation-aware package manager. |

### MCP server management (Agent Guard)

| Ask the agent… | What happens |
| --- | --- |
| "Which MCP servers can I install?" | Returns all MCP servers approved for your current project that you can install. |
| "What MCP servers do I already have?" | Returns only the MCP servers already installed on your machine. |
| "Show me the details for the filesystem MCP server." | Returns detailed metadata, required configuration (environment variables, runtime arguments), and active tool policies for a given server. |
| "Add the GitHub MCP server." | Installs an approved MCP server and syncs its tool policies locally. Secrets are requested via a CLI command — never in chat. |
| "Update the environment variables for the Slack MCP." | Replaces the configuration for an already-installed server without removing and reinstalling it. |
| "Remove the Slack MCP server." | Removes the server and its stored credentials from your local setup. |
| "Log in to the remote Jira MCP server using OAuth." | Authenticates with a remote HTTP-based MCP server (OAuth, API key, or bearer token). |

### How secrets are handled

When an MCP server requires a sensitive configuration value, the agent cannot set it
directly. Instead, it returns a CLI command for you to copy and run in your terminal.
Secrets such as API keys, tokens, and connection strings are never exposed in the agent
chat history.

---

## Troubleshooting

The plugin does not log by default. To enable debug logging:

```bash
export JFROG_DEBUG_LOGS=true
```

Logs are written to `<project-root>/.opencode/event-log.txt`.

- **"bundled skills not found"** (a toast in the TUI and/or an `ERROR` line in the log) — the installed package is incomplete or corrupted; reinstall `@jfrog/opencode-jfrog-plugin`.
- **`401` / SSE error** for the JFrog MCP in `opencode mcp list` (or the TUI) — you have not completed the OAuth sign-in, or the stored OAuth session expired. Run `opencode mcp auth jfrog` to (re)authenticate, and confirm `JFROG_PLATFORM_URL` points at the platform you signed in to. Use `opencode mcp debug jfrog` to inspect the OAuth connection, or `opencode mcp logout jfrog` to clear a stale session and re-auth.

For MCP-registry issues, see the [JFrog MCP Registry troubleshooting guide](https://docs.jfrog.com/ai-ml/docs/mcp-registry-troubleshooting).

---

## Updating the vendored skills

The `skills/` tree is vendored from
[`jfrog/jfrog-skills`](https://github.com/jfrog/jfrog-skills) at the version pinned in
[`sync-skills-vendor.json`](sync-skills-vendor.json). To pull a newer upstream release:

1. Bump `pin` in `sync-skills-vendor.json` to the new tag (e.g. `v0.23.0`).
2. Re-sync and commit the refreshed tree:

   ```bash
   node scripts/sync-skills.mjs   # or: mise run sync-skills
   ```

   It downloads the pinned tarball from `codeload.github.com` and replaces the
   directories listed in `paths` (today: `skills/`).
3. Update the pinned-version link in the [Prerequisites](#prerequisites) section so the
   skill runtime requirements point at the new tag.
4. Cut a plugin release so the new skills ship to users (see [Release](#release)).
   Until a release is published, installed plugins keep using the previously vendored
   skills.

CI runs `mise run sync-skills:check`, which re-vendors and fails if the committed
`skills/` tree drifts from the pin. See [`VENDOR.md`](VENDOR.md) for the full picture.

---

## Upgrading from < 0.0.3

This release changes behavior in ways that are **not** backward compatible:

- **Skill catalog changed.** The previous Artifactory skills — `skill-install`, `skill-publish`, `jfrog-cli`, `opencode-jfrog-mcp`, `jfrog-curation`, `jfrog-packages` — are replaced by the canonical vendored skills above. Invocations of the removed skill names no longer exist; that functionality now folds into the `jfrog` skill.
- **Package-manager auto-setup was removed.** Earlier versions ran `jf setup <pm>` automatically on session start; that is gone. Durable package-manager setup is provided by the `jfrog-setup-package-managers` skill.
- **Old skills are not auto-cleaned.** The plugin no longer touches `~/.config/opencode/skills`. If you used a version < 0.0.3, remove the old managed skill directories yourself under `~/.config/opencode/skills`.
- **No more runtime artifacts.** The plugin no longer injects instructions files or writes local package-manager state, and it no longer downloads skills at runtime.
- **Dependencies resolve from public npm.** Internal registry references were removed; the build and CI now resolve from public npm.

---

## Development

Tasks are run with [mise](https://mise.jdx.dev/):

- `mise run build` — build the module
- `mise run test` — run the test suite
- `mise run typecheck` — type-check with `tsc --noEmit`
- `mise run lint` — lint with ESLint
- `mise run lint:fix` — auto-fix lint issues
- `mise run format` — format with Prettier
- `mise run sync-skills` — re-vendor the bundled skills (see [VENDOR.md](VENDOR.md))

---

## Release

Releases are automated with [release-please](https://github.com/googleapis/release-please):
merge Conventional-Commit PRs (`feat:`, `fix:`, …) to `main`, and release-please opens a
release PR that bumps the version and updates the changelog. Merging that PR tags the
release and publishes to npm. See [RELEASE.md](RELEASE.md) for details.

> Do **not** hand-edit the `version` in `package.json` — release-please manages it.

---

## Contributing

Contributions are welcome! See [`CONTRIBUTING.md`](CONTRIBUTING.md). Please file issues
or open pull requests on the GitHub repository.

## Security

See [`SECURITY.md`](SECURITY.md) for how to report vulnerabilities.

## License

See the [LICENSE](LICENSE) file for details.

## Compatibility

Verified against OpenCode **1.17.7** and newer (the first version confirmed to honor
`config.skills.paths` in object form). Older versions are not supported.
