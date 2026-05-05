# opencode-jfrog-plugin

JFrog Plugin for seamless integration to Opencode
This plugin is intended for use by JFrog Customers also using Opencode.

## Prerequisites
### General:
- [JFrog Platform](https://jfrog.com) installed
- [Opencode](https://opencode.ai/) installed

### MCP Registry:
- Access to the corporate JFrog Platform with the AI Catalog enabled.
- A project with at least one allowed MCP server.

### Curation:
- JFrog Enterprise+ or a Unified Security Bundle
- Xray deployment
- Curation configuration on the used remote repositories


> This is a Bun module created from the [bun-module](https://github.com/zenobi-us/bun-module) template

## Installation
Add the opencode-jfrog-plugin into your opencode config.
Preferably set the plugin globally for all their developers using the Opencode remote configuration, visit [opencode remote configuration](https://opencode.ai/docs/config/#remote) for more details.

The plugin configuration looks like this:
```
"plugin": [
   "@jfrog/opencode-jfrog-plugin@0.0.1"
 ],
```

## How this works
Once opencode starts it runs the plugin. The plugin then:
1. Pulls a few base skills that allow the integration from the developer opencode instance into JFrog (can be found under `~/.config/opencode/skills`)
2. Pulls integration instructions adding LLM hints on how to integrate with JFrog (can be found under `<project-root>/.jfrog/instructions`)
3. Appends integration instructions into the runtime opencode config

Once the skills and instructions are set, every relevant task (package management, skills and MCP handling) is integrated into JFrog.
Once the user tries to resolve dependencies, handle packages, install MCP servers, and pull a skill, the system will verify integration prerequisites (JFrog CLI is installed and configured and `<project-root>/.jfrog/local/package-managers.json` is available) and will perform the task using JFrog capabilities.

While the skills run, they make sure that JFrog CLI is installed and configured, and that package managers are configured against the JFrog platform.

## Usage
Developers who get the plugin through their corporate opencode configuration, or add it manually into their device configuration will automatically get the JFrog integration up and are expected to be asked for completion of package management setup when needed.

This can be handled manually or when a task requires it.
### Manually
Within opencode, type `/skills` and select the `jfrog-setup-package-managers` skill to complete package management and project setup.
### Automatically
Within opencode, when tasks require a JFrog skill, the triggered skill will guide the user through the needed setup.

### Integration setup artifacts
LLM instructions are automatically created at `<project-root>/.jfrog/instructions`
Package management mappings are created at `<project-root>/.jfrog/local/package-managers.json`
Skills are created under `~/.config/opencode/skills`

## Troubleshooting
The JFrog plugin pulls a minimal set of JFrog integration skills and LLM instructions that allow for the integration. It also adds the instructions file into the opencode project configuration file.
The plugin does not log by default, but allows debug logs for troubleshooting the JFrog setup process.
To enable opencode-jfrog-plugin debug logging, run `export JFROG_DEBUG_LOGS=true` before running opencode.

## Development

- `mise run build` - Build the module
- `mise run test` - Run tests
- `mise run lint` - Lint code
- `mise run lint:fix` - Fix linting issues
- `mise run format` - Format code with Prettier

## Release

See the [RELEASE.md](RELEASE.md) file for instructions on how to release a new version of the module.

## Contributing

Contributions are welcome! Please file issues or submit pull requests on the GitHub repository.

## License

See the [LICENSE](LICENSE) file for details.
