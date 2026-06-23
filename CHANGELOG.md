# Changelog

## [0.0.2](https://github.com/jfrog/opencode-jfrog-plugin/compare/v0.0.1...v0.0.2) (2026-06-23)


### ⚠ BREAKING CHANGES

* skill catalog reduced from 7 Artifactory skills (skill-install, skill-publish, jfrog-cli, opencode-jfrog-mcp, jfrog-setup-package-managers, jfrog-curation, jfrog-packages) to 2 canonical skills (jfrog, jfrog-package-safety-and-download); the removed skill names no longer exist and fold into the jfrog skill. Package-manager auto-setup on session start is removed (interim jf setup nudge; durable recovery upstream). Old version-nested skills under ~/.config/opencode/skills are auto-cleaned by a one-time migration. The instructions file and package-managers.json are no longer written, and there is no runtime skills download. Dependencies/CI now resolve from public npm.

### Features

* align OpenCode plugin with Cursor model (vendored skills, thin config-hook, CI hardening) ([#16](https://github.com/jfrog/opencode-jfrog-plugin/issues/16)) ([de03bef](https://github.com/jfrog/opencode-jfrog-plugin/commit/de03bef7af627ba4d11ffd42dfc5f064d179a350))


### Bug Fixes

* Versioning of instructions, publish script ([#14](https://github.com/jfrog/opencode-jfrog-plugin/issues/14)) ([2146d7f](https://github.com/jfrog/opencode-jfrog-plugin/commit/2146d7fb1a414fce93f3012ce9e83d33bbd3e812))


### Miscellaneous Chores

* release 0.0.2 ([#11](https://github.com/jfrog/opencode-jfrog-plugin/issues/11)) ([a9c807e](https://github.com/jfrog/opencode-jfrog-plugin/commit/a9c807e5f0316f1cfa294625fdd8d8669557cc70))

## Changelog

All notable changes to this project will be documented here by Release Please.
