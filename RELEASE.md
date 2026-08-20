# Release Process

This project cuts releases from the `version` field in [`package.json`](package.json).
Every push to `main` compares that version against the latest `vX.Y.Z` tag:

- **Newer than latest tag** → build a GitHub Release and dispatch npm publishing.
- **Equal to latest tag** → fail with a clear "already released" error.
- **Older than latest tag** → fail with a revert warning.

There is no commit-message marker, no manual tag push, and no release-please bot.

## Cutting a release

1. In your PR, bump the `version` field in `package.json` to a not-yet-released semver.
2. Merge to `main`.

[`.github/workflows/release.yml`](.github/workflows/release.yml) creates the GitHub Release
(`gh release create --target`, with `--generate-notes`), then dispatches
[`publish-as-is.yml`](.github/workflows/publish-as-is.yml) for npm OIDC trusted publishing.

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
tag). `CHANGELOG.md` is not auto-updated.
