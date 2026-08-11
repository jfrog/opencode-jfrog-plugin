# Vendoring the JFrog skills

This plugin ships the official JFrog Agent Skills **with the package** rather than downloading them at
runtime. The skills are copied (vendored) from
[`jfrog/jfrog-skills`](https://github.com/jfrog/jfrog-skills) at a pinned version and committed to this
repo under `skills/`.

Because the skills are bundled, **updating them requires a new plugin release** — there are no runtime
skill updates.

## Configuration: `sync-skills-vendor.json`

The vendoring source is declared in `sync-skills-vendor.json` at the repo root:

```json
{
  "repo": "jfrog/jfrog-skills",
  "pin": "v0.22.0",
  "paths": ["skills"]
}
```

| Field   | Meaning                                                                                     |
| ------- | ------------------------------------------------------------------------------------------- |
| `repo`  | The upstream GitHub repository (`owner/name`) to vendor from.                               |
| `pin`   | The exact upstream ref to vendor (a tag, e.g. `v0.16.0`). Pin to a tag for reproducibility. |
| `paths` | The paths within the upstream repo to copy into this repo root. Currently just `skills`.    |

## How the sync works

`scripts/sync-skills.mjs` (run via `mise run sync-skills`):

1. Downloads the upstream tarball from `codeload.github.com` for `repo` at `pin` (public, no auth).
2. Extracts it and strips the single top-level directory.
3. Copies each entry in `paths` into the repo root (replacing the existing copy).

The result is a flat, committed tree:

```
skills/
  jfrog/SKILL.md (+ references/ scripts/ assets/)
  jfrog-package-safety-and-download/SKILL.md
  jfrog-setup-package-managers/SKILL.md
  jfrog-ai-catalog-skills/SKILL.md
  jfrog-mcp-management/SKILL.md
  jfrog-reference-architecture/SKILL.md
```

> **Note:** the exact set of skill directories is whatever the pinned `jfrog/jfrog-skills` release
> ships under `skills/` — the sync copies the whole tree. `jfrog-mcp-management/` (JFrog Agent Guard
> MCP management, including the OpenCode harness) is included as of the pinned `v0.22.0`.

The script is dependency-free Node ESM and makes no changes outside the vendored `paths`.

## Bumping the pin

1. Edit `sync-skills-vendor.json` and set `pin` to the new upstream tag (e.g. `v0.12.0`).
2. Re-vendor:

   ```bash
   mise run sync-skills   # or, without mise: node scripts/sync-skills.mjs
   ```

3. Review the diff under `skills/` and commit the regenerated tree **together with** the updated
   `sync-skills-vendor.json`:

   ```bash
   git add sync-skills-vendor.json skills
   git commit -m "feat(skills): vendor jfrog-skills@v0.12.0"
   ```

4. Cut a plugin release so the new skills ship to users. Until a release is published, installed plugins
   keep using the previously vendored skills.

> CI runs `mise run sync-skills:check`, which re-vendors and fails if the committed `skills/` tree drifts
> from the pin. If that check fails on a PR, run `mise run sync-skills` and commit the result.

## Notes

- Keep `skills/` flat: `SKILL.md` must sit directly under `skills/<skill-name>/` (no version
  directory). The plugin and OpenCode discover skills by `{skill,skills}/**/SKILL.md`, with the skill
  name read from each `SKILL.md`'s YAML frontmatter.
- The vendored tree is byte-identical to the upstream `skills/` at the pinned tag; re-running the sync
  without changing the pin produces no diff (idempotent).
