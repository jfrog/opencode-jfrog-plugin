# Release Process

This project cuts releases from the `version` field in [`package.json`](package.json).
Every push to `main` compares that version against the latest `vX.Y.Z` tag:

- **Newer than latest tag** → create a GitHub Release and dispatch npm publishing.
- **Equal to latest tag** → fail with a clear "already released" error.
- **Older than latest tag** → fail with a revert warning.

There is no commit-message marker, no manual tag push, and no release-please bot.

> **Note:** v0.3.1 is the first version released end to end through this path. Watch that run
> before trusting it unattended.

## Cutting a release

1. In your PR, bump the `version` field in `package.json` to a not-yet-released semver
   (`mise run version` bumps the patch; `--bump minor` / `--bump major` for the rest).
2. Merge to `main`.

[`.github/workflows/release.yml`](.github/workflows/release.yml) creates the GitHub Release
(`gh release create --target`, with `--generate-notes`), then dispatches
[`publish-as-is.yml`](.github/workflows/publish-as-is.yml) for npm OIDC trusted publishing. The
dispatch carries the released commit SHA, so the published tarball is built from exactly that
commit even if `main` has moved on.

## NPM Trusted Publishing

This project uses [NPM Trusted Publishing](https://docs.npmjs.com/trusted-publishers) with GitHub
Actions. No npm tokens are needed — authentication is handled automatically via OIDC.

**Trusted publisher configuration:**

- **Workflow filename**: `publish-as-is.yml` (not `publish.yml`)

When a release succeeds, the publish workflow:

1. Builds the module (`mise run build`)
2. Publishes to npm with OIDC authentication (`mise run publish`)

## First release / npm setup

Before automated publishes work, the package must exist on npmjs.com and trusted publishing must
be configured. See npm's [Trusted Publishers](https://docs.npmjs.com/trusted-publishers) docs.

## Changelog

Release notes come from `gh release create --generate-notes` (merged PRs/commits since the last
tag). `CHANGELOG.md` is frozen as of v0.3.0 and is no longer updated.
