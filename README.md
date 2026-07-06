# opencode-jfrog-plugin

JFrog integration for [OpenCode](https://opencode.ai/). The plugin ships the official JFrog
[Agent Skills](https://opencode.ai/docs/skills/) with the package and registers them with OpenCode at
load time, so JFrog capabilities are available to the agent out of the box.

## What's included

The plugin bundles three canonical skills, vendored (pinned) from
[`jfrog/jfrog-skills`](https://github.com/jfrog/jfrog-skills) and committed under `skills/`:

- **`jfrog`** — interact with the JFrog Platform via the JFrog CLI, MCP server, and REST/GraphQL APIs
  (Artifactory, Xray, builds, permissions, projects, release lifecycle, advanced security, and more).
- **`jfrog-package-safety-and-download`** — check package safety/curation status and download packages
  through JFrog.
- **`jfrog-ai-catalog-skills`** — discover, install, manage, and publish agent skills hosted in the
  JFrog AI Catalog via the JFrog CLI (`jf skills`) and JFrog Agent Guard.

The skills ship **with the plugin** (vendored and pinned). They are **not** downloaded at runtime, so
the plugin works offline and the skill set is reproducible for a given plugin version.

The plugin is **self-contained**: everything it needs is in the published npm tarball (`dist/` + the
vendored `skills/`). There are no runtime downloads and no dependency on `releases.jfrog.io` or any other
external artifact host.

## Prerequisites

- A [JFrog Platform](https://jfrog.com) instance you can authenticate against.
- [OpenCode](https://opencode.ai/) installed (verified against OpenCode **1.17.7** and newer, which
  honors `config.skills.paths` in object form).
- For running the skills at runtime, the following must be on your `PATH`:
  - [`jf`](https://jfrog.com/getting-started-with-jfrog-cli/) (JFrog CLI), `jq`, and `curl`.
  - A configured JFrog CLI server (e.g. via `jf login` / `jf config add`).

## Installation

The plugin is published to public npm as
[`@jfrog/opencode-jfrog-plugin`](https://www.npmjs.com/package/@jfrog/opencode-jfrog-plugin) and is
listed on the [OpenCode ecosystem page](https://opencode.ai/docs/ecosystem). OpenCode has no plugin
marketplace — you install by referencing the npm package in your OpenCode config.

Add the plugin to your OpenCode config (`opencode.json`):

```json
{
  "plugin": ["@jfrog/opencode-jfrog-plugin"]
}
```

OpenCode resolves the package from npm and loads it. To pin a specific version, use
`"@jfrog/opencode-jfrog-plugin@<version>"`; omitting the version tracks the latest release.

For an organization-wide rollout, set the plugin in OpenCode's
[remote configuration](https://opencode.ai/docs/config/#remote) so every developer gets it
automatically.

## How it works

The plugin is intentionally **thin**. On load it:

1. Resolves its bundled `skills/` directory (shipped inside the package).
2. Registers that directory with OpenCode through the `config` hook by adding it to
   `config.skills.paths`.

OpenCode then discovers the skills the same way it discovers any skill — they appear via the `skill`
tool and `/skills`, and the agent invokes them when relevant. There is no runtime download, unzip, or
network call on load.

## JFrog Platform MCP

When the environment is configured, the plugin also registers the **JFrog Platform remote MCP server**
(`https://<JFROG_URL>/mcp`) into `config.mcp.jfrog`, so the JFrog platform tools appear in OpenCode
alongside the skills.

**Prerequisites — both must be set:**

- `JFROG_URL` — your JFrog platform URL (e.g. `https://mycompany.jfrog.io`). The legacy `JF_URL` and the
  `JFROG_PLATFORM_URL` (Cursor-compat) names are also accepted.
- `JFROG_ACCESS_TOKEN` — a **JWT access token** created with `jf access-token-create` (or the legacy
  `JF_ACCESS_TOKEN`). This **must be a JWT access token, not a 64-character reference token** — reference
  tokens are rejected by the `/mcp` endpoint.

The MCP is authenticated with the token directly (`Authorization: Bearer …`, `oauth: false`), so it works
headlessly with no interactive browser sign-in. Registration is a pure config mutation — there is no
network call on plugin load.

**Opt-out:** set `JFROG_MCP_DISABLE=true` to skip MCP registration entirely. You can also scope the
exposed tools via OpenCode's `tools` globbing. If you define your own `mcp.jfrog` server in your config,
the plugin leaves it untouched.

**Context cost:** the JFrog MCP exposes ~56 tools whose schemas are loaded into the model context on
every request (OpenCode has no lazy tool loading), measured at roughly **+32K tokens per request** in
OpenCode (~44K in Cursor). The MCP is enabled by default for parity with the JFrog Cursor/Claude plugins;
if that overhead matters for your workflow, disable it with `JFROG_MCP_DISABLE=true` or narrow the
surface with `tools` globbing. The bundled **skills** do not carry this cost — only their short
descriptions stay in context, and a skill's body loads only when it is invoked.

**Token handling:** OpenCode does not expand `{env:…}` placeholders in config that a plugin injects at
runtime, so the plugin reads `JFROG_ACCESS_TOKEN` from the environment and sets the resolved
`Authorization: Bearer <token>` header directly. The token therefore lives in the in-memory session
config (sourced from your environment); the plugin itself never writes it to disk. Prefer a short-lived
token (`jf atc --expiry=…`).

## Updating the bundled skills

The skills are vendored at a pinned version. Updating them is a build-time step and **requires a new
plugin release** (there are no runtime skill updates). See [VENDOR.md](./VENDOR.md) for the pin-bump
workflow (`mise run sync-skills`).

## Troubleshooting

The plugin does not log by default. To enable debug logging:

```bash
export JFROG_DEBUG_LOGS=true
```

Logs are written to `<project-root>/.opencode/event-log.txt`.

If you see a **"bundled skills not found"** error (a toast in the TUI and/or an `ERROR` line in the log),
the installed package is incomplete or corrupted — reinstall `@jfrog/opencode-jfrog-plugin`.

If the JFrog MCP shows **`401` / an SSE error** in `opencode mcp list` (or the TUI), the `/mcp` endpoint
rejected the token. Make sure `JFROG_ACCESS_TOKEN` is a **JWT** access token (`jf atc`), not a 64-char
reference token, and that it was issued for the same platform as `JFROG_URL` (check `jf c show`). MCP
connection status is surfaced by OpenCode itself — this plugin only registers the server. With
`JFROG_DEBUG_LOGS=true`, a non-JWT token also produces a `WARNING` line in the event log.

## Upgrading from < 0.0.3

This release changes behavior in ways that are **not** backward compatible:

- **Skill catalog changed (7 → 3).** The previous Artifactory skills — `skill-install`,
  `skill-publish`, `jfrog-cli`, `opencode-jfrog-mcp`, `jfrog-setup-package-managers`, `jfrog-curation`,
  `jfrog-packages` — are replaced by the three canonical skills above. Invocations of the removed skill
  names no longer exist; that functionality now folds into the `jfrog` skill.
- **Package-manager auto-setup was removed.** Earlier versions ran `jf setup <pm>` automatically on
  session start. That is gone; the plugin now emits an interim one-line nudge to run
  `jf setup <pm>` yourself. Durable package-manager setup is being recovered upstream in
  `jfrog/jfrog-skills`.
- **Old skills are not auto-cleaned.** The plugin no longer touches `~/.config/opencode/skills`. If you
  used a version < 0.0.3, remove the old managed skill directories yourself (e.g. `skill-install`,
  `skill-publish`, `jfrog-cli`, `opencode-jfrog-mcp`, `jfrog-setup-package-managers`, `jfrog-curation`,
  `jfrog-packages`) under `~/.config/opencode/skills`.
- **No more runtime artifacts.** The plugin no longer injects an instructions file
  (`.jfrog/instructions/...`) or writes `.jfrog/local/package-managers.json`, and it no longer
  downloads skills at runtime.
- **Dependencies resolve from public npm.** Internal registry references were removed; the build and CI
  now resolve from public npm.

## Development

Tasks are run with [mise](https://mise.jdx.dev/):

- `mise run build` — build the module
- `mise run test` — run tests (`bun test`)
- `mise run typecheck` — type-check with `tsc --noEmit`
- `mise run lint` — lint with ESLint
- `mise run lint:fix` — auto-fix lint issues
- `mise run format` — format with Prettier
- `mise run sync-skills` — re-vendor the bundled skills (see [VENDOR.md](./VENDOR.md))

## Release

See [RELEASE.md](./RELEASE.md) for how to release a new version.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md). Please file issues or open pull
requests on the GitHub repository.

## License

See the [LICENSE](./LICENSE) file for details.

## Compatibility

Verified against OpenCode **1.17.7** and newer (the first version confirmed to honor
`config.skills.paths` in object form). Older versions are not supported.
