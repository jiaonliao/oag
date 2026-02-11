'use strict';

const path = require('path');
const { loadConfig, resolveRegistryPath } = require('../lib/config');
const { ensureRemote } = require('../lib/remoteEnsure');
const { ensureRegistrySynced } = require('../lib/registrySync');
const { loadAssets } = require('../lib/registry');
const { getHeadCommit } = require('../lib/git');
const { updateInstalledAssets } = require('../lib/update');

async function safeGetCommit(repoPath) {
  try {
    return await getHeadCommit(repoPath);
  } catch (error) {
    return 'unknown';
  }
}

function formatSkippedList(items, formatLine) {
  if (items.length === 0) {
    return;
  }
  for (const item of items) {
    console.log(formatLine(item));
  }
}

function registerUpdateCommand(program) {
  program
    .command('update')
    .description('Update installed assets')
    .option('--tool <name>', 'Tool name')
    .option('--project <path>', 'Project root path')
    .option('--mode <mode>', 'Install mode (symlink|copy)')
    .action(async (options) => {
      const config = await loadConfig();
      const remote = await ensureRemote(config);

      const projectRoot = path.resolve(options.project || process.cwd());

      const registryRoot = resolveRegistryPath(config);
      const { repoPath } = await ensureRegistrySynced({ registryRoot, remote });
      const assets = await loadAssets(repoPath);
      const commit = await safeGetCommit(repoPath);

      const summary = await updateInstalledAssets({
        projectRoot,
        tool: options.tool,
        mode: options.mode,
        config,
        assets,
        commit,
      });

      if (summary.totalItems === 0) {
        if (options.tool) {
          console.log(`No installed assets for tool '${options.tool}'.`);
        } else {
          console.log('No installed assets found.');
        }
        return;
      }

      if (summary.skippedNoToolConfig.length > 0) {
        console.log(`Skipped ${summary.skippedNoToolConfig.length} tools with no config:`);
        for (const toolName of summary.skippedNoToolConfig) {
          console.log(`- ${toolName}`);
        }
      }

      if (summary.skippedMissing.length > 0) {
        console.log(`Missing ${summary.skippedMissing.length} assets (skipped):`);
        formatSkippedList(summary.skippedMissing, (entry) => `- ${entry.tool}: ${entry.id}`);
      }

      if (summary.skippedNoMapping.length > 0) {
        console.log(`Skipped ${summary.skippedNoMapping.length} assets with no path mapping:`);
        formatSkippedList(
          summary.skippedNoMapping,
          (entry) => `- ${entry.tool}: ${entry.id} (type: ${entry.type})`
        );
      }

      if (summary.skippedLegacyHook.length > 0) {
        console.log(
          `Skipped ${summary.skippedLegacyHook.length} legacy hook assets (hook type is no longer supported):`
        );
        formatSkippedList(summary.skippedLegacyHook, (entry) => `- ${entry.tool}: ${entry.id}`);
      }

      if (summary.updated === 0) {
        console.log('No assets updated.');
        return;
      }

      console.log(`Updated ${summary.updated} assets.`);
    });
}

module.exports = {
  registerUpdateCommand,
};
