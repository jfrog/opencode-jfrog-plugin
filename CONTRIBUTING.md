# Contributing

Thank you for your interest in contributing!

## Reporting Issues

- Search existing issues before opening a new one
- Include steps to reproduce, expected behavior, and actual behavior
- For bugs, include your environment (Bun version, OS, etc.)

> **Note:** Issues inactive for 60 days may be marked stale and closed after 7 days. Feel free to reopen if still relevant.

## Submitting Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes
4. Run tests and linting:
   ```bash
   mise run test
   mise run lint
   ```
5. Bump the `version` field in `package.json` — required on every PR to `main`; see [Releasing](#releasing)
6. Commit with a descriptive message ([Conventional Commits](https://www.conventionalcommits.org/)
   style is welcome, but nothing enforces it)
7. Push and open a Pull Request

## Pull Request Guidelines

- Keep PRs focused on a single change
- Include tests for new functionality
- Ensure all checks pass before requesting review

## Releasing

Releases are cut from the `version` field in `package.json`: merging a PR that bumps it to a
not-yet-released `X.Y.Z` creates the matching GitHub Release and publishes to npm. See
[RELEASE.md](./RELEASE.md) for the full flow.

Merging to `main` without a version bump fails the Release workflow. That is by design — the
failure reads "already released", and it is how a missing bump gets noticed instead of silently
shipping nothing.

## Code Style

This project uses ESLint and Prettier. Run `mise run lint:fix` to auto-fix issues.
See the [Development](./README.md#development) section in the README for the available tasks.
