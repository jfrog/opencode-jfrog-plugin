import type { Plugin, PluginInput } from '@opencode-ai/plugin';
import { appendFileSync, createWriteStream, readFileSync, existsSync, mkdirSync } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { dirname, join } from 'path';

const LOG_FILE = join(process.cwd(), '.opencode', 'event-log.txt');
const SKILLS_REGISTRY_URL = 'https://releases.jfrog.io/artifactory/jfrog-skills/';
const INSTRUCTIONS_REGISTRY_URL =
  'https://releases.jfrog.io/artifactory/run/ai/integrations/opencode/JFROG-INTEGRATION-MANAGEMENT.md';

const fetchAndSaveFile = async (
  url: string,
  destPath: string,
  log: (msg: string) => void
): Promise<{ success: boolean; error?: string }> => {
  const dir = dirname(destPath);
  log('Fetching file from ' + url + ' and saving to ' + destPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  // fetch largfile using stream and save to file
  const response = await fetch(url);
  if (!response.body) {
    return { success: false, error: `No response body from ${url}` };
  }
  const writer = createWriteStream(destPath);
  await pipeline(
    Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
    writer
  );
  return { success: true };
};

const extractZip = async (
  $: any,
  directory: any,
  skillZipFile: string,
  skillName: string,
  skillZipDir: string,
  log: (msg: string) => void
): Promise<{ success: boolean; error?: string }> => {
  // extract zip file, and check command response
  const unzipResponse =
    await $`unzip -o ${skillZipFile} -d ${directory}/.opencode/skills/${skillName}`
      .nothrow()
      .quiet();
  if (unzipResponse.exitCode !== 0) {
    log(`Failed to extract JFrog ${skillName} skill: ${unzipResponse.stderr}`);
    return {
      success: false,
      error: `Failed to extract JFrog ${skillName} skill: ${unzipResponse.stderr}`,
    };
  }
  log(`JFrog ${skillName} skill extracted!`);
  // remove zip file and its version directory
  await $`rm -fR ${skillZipDir}`;
  log(`Jfrog ${skillName} skill directory removed!`);
  return { success: true };
};

const setupPackageManagers = async (
  client: any,
  $: any,
  directory: any,
  _sessionId: unknown,
  log: (msg: string) => void
) => {
  // check if jfrog-cli is installed using jf --version

  let jfVersion: { exitCode: number } | undefined;
  try {
    jfVersion = await $`jf --version`.nothrow().quiet();
  } catch (e) {
    log('jf version command threw: ' + e);
    return {
      success: false,
      message: 'Jfrog cli is not installed, please use the jfrog-cli skill to install it',
    };
  }

  if (!jfVersion || jfVersion.exitCode !== 0) {
    log('jf version command failed');
    return {
      success: false,
      message: 'Jfrog cli is not installed, please use the jfrog-cli skill to install it',
    };
  }
  const packageManagersFile = join(directory, '.jfrog', 'local', 'package-managers.json');
  if (!existsSync(packageManagersFile)) {
    return {
      success: false,
      message:
        'Jfrog packages are not setup, please use the jfrog-setup-package-managers skill to complete setup. type /skill and select jfrog-setup-package-managers',
    };
  }

  const packageManagersConfig = JSON.parse(readFileSync(packageManagersFile, 'utf8'));
  const configuredPackageManagers = packageManagersConfig.configuredPackageManagers;
  if (!configuredPackageManagers) {
    return {
      success: false,
      message:
        'Jfrog packages are not setup, please use the jfrog-setup-package-managers skill to complete setup. type /skill and select jfrog-cli',
    };
  }

  const results: {
    success: { packageManager: string }[];
    error: { packageManager: string; error: string }[];
  } = { success: [], error: [] };
  for (const packageManager in configuredPackageManagers) {
    const packageManagerConfig = configuredPackageManagers[packageManager];
    const result =
      await $`jf setup ${packageManager} --server-id ${packageManagerConfig.serverId} --repo ${packageManagerConfig.repository}`
        .nothrow()
        .quiet();
    if (result.exitCode !== 0) {
      results.error.push({ packageManager: packageManager, error: result.stderr });
    } else {
      results.success.push({ packageManager: packageManager });
    }
  }

  var errorMessages = '';
  if (results.error.length > 0) {
    errorMessages =
      'Failed to configure package managers:' +
      results.error.map((e) => e.packageManager + ' - ' + e.error).join(', ');
  }
  var successMessages = '';
  if (results.success.length > 0) {
    successMessages =
      'Package managers configured successfully:' +
      results.success.map((s) => s.packageManager).join(', ');
  }
  var success = true;
  if (results.error.length > 0) {
    success = false;
  }
  log('return message=' + errorMessages + successMessages);

  return { success: success, message: errorMessages + ' ' + successMessages };
};
const pullSkills = async (
  $: PluginInput['$'],
  directory: string,
  log: (msg: string) => void
): Promise<{ success: boolean; failedSkills?: string[] }> => {
  const failedSkills: string[] = [];
  // pull JFrog instructions from Artifactory
  const jfroginstructionExists =
    await $`test -f ${directory}/.jfrog/instructions/JFROG-INTEGRATION-MANAGEMENT.md`
      .nothrow()
      .quiet();
  if (jfroginstructionExists.exitCode !== 0) {
    log('JFrog integration management instructions not found, importing them locally!');
    const result = await fetchAndSaveFile(
      `${INSTRUCTIONS_REGISTRY_URL}`,
      `${directory}/.jfrog/instructions/JFROG-INTEGRATION-MANAGEMENT.md`,
      log
    );
    if (!result.success) {
      log(
        'Failed to import JFrog integration management instructions for Opencode: ' + result.error
      );
      failedSkills.push('JFROG-INTEGRATION-MANAGEMENT');
    }
    log('JFrog integration management instructions imported!');
  }

  // add array of skills to pull with their versions
  const skillsToPull = [
    { name: 'skill-install', version: '0.0.1' },
    { name: 'skill-publish', version: '0.0.1' },
    { name: 'jfrog-cli', version: '0.0.1' },
    { name: 'opencode-jfrog-mcp', version: '0.0.1' },
    { name: 'jfrog-setup-package-managers', version: '0.0.1' },
    { name: 'jfrog-curation', version: '0.0.1' },
    { name: 'jfrog-packages', version: '0.0.1' },
  ];
  for (const skill of skillsToPull) {
    const skillExists = await $`test -d ${directory}/.opencode/skills/${skill.name}/`
      .nothrow()
      .quiet();
    if (skillExists.exitCode !== 0) {
      log('JFrog skill not found, importing them locally!');
      const skillName = skill.name;
      const skillVersion = skill.version;
      const skillZipDir = `${directory}/.opencode/skills/${skillName}/${skillVersion}`;
      const skillZipFile = `${skillZipDir}/${skillName}-${skillVersion}.zip`;
      const result = await fetchAndSaveFile(
        `${SKILLS_REGISTRY_URL}/${skillName}/${skillVersion}/${skillName}-${skillVersion}.zip`,
        `${skillZipFile}`,
        log
      );
      if (!result.success) {
        log('Failed to import JFrog mcp skill: ' + result.error);
        failedSkills.push(skillName);
      } else {
        const unzipResult = await extractZip(
          $,
          directory,
          skillZipFile,
          skillName,
          skillZipDir,
          log
        );
        if (!unzipResult.success) {
          log(`Failed to extract ${skillName} skill: ${unzipResult.error}`);
          failedSkills.push(skillName);
        }
      }
      log(`${skillName} skill extracted!`);
    }
  }
  // return success if no failed skills, otherwise return failed skills
  if (failedSkills.length > 0) {
    return { success: false, failedSkills: failedSkills };
  } else {
    return { success: true };
  }
};

/** OpenCode loads plugins via the `server` export (see `PluginModule` in @opencode-ai/plugin). */
const jfrogOpencodePlugin: Plugin = async ({ client, $, directory }) => {
  const logDir = dirname(LOG_FILE);
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  const log = (message: string) => {
    //check if JFROG_DEBUG environment variable is set to true
    if (process.env.JFROG_DEBUG_LOGS === 'true') {
      appendFileSync(LOG_FILE, message + '\n', 'utf-8');
    }
  };
  log('JfrogOpencodePlugin starting...');
  // check if JFrog skills management exists and if they do not, import them locally
  await pullSkills($, directory, log);
  // TODO add user message if skills are not imported (inspect pullSkills result)

  return {
    config: async (config) => {
      config.instructions = config.instructions || [];
      if (
        config.instructions.indexOf('.jfrog/instructions/JFROG-INTEGRATION-MANAGEMENT.md') === -1
      ) {
        config.instructions.push('.jfrog/instructions/JFROG-INTEGRATION-MANAGEMENT.md');
        log('jfrog integration management added to config');
      }
    },
    event: async ({ event }) => {
      if (event.type === 'session.created') {
        const sessionId = event.properties.info.id;
        // responses list
        const responses: { success: boolean; message: string }[] = [];

        var pkgMngrResponse: { success: boolean; message: string } | undefined;
        pkgMngrResponse = await setupPackageManagers(client, $, directory, sessionId, log);
        if (pkgMngrResponse) {
          responses.push(pkgMngrResponse);
        }
        log('pkgMngrResponse=' + pkgMngrResponse?.message);

        await client.tui.showToast({
          body: {
            message: responses
              .filter((s) => !s.success)
              .map((s) => s.message)
              .join('\n\n'),
            variant: 'error',
            duration: 10000,
          },
        });
      }
    },
  };
};

export const server = jfrogOpencodePlugin;
export const JfrogOpencodePlugin = jfrogOpencodePlugin;
