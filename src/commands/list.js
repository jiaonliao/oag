'use strict';

const { loadConfig, resolveRegistryPath } = require('../lib/config');
const { ensureRemote } = require('../lib/remoteEnsure');
const { loadAssets } = require('../lib/registry');
const { ensureRegistrySynced } = require('../lib/registrySync');

function registerListCommand(program) {
  program
    .command('list')
    .description('List available assets')
    .option('--type <type>', 'Filter by type')
    .option('--tool <name>', 'Filter by tool')
    .action(async (options) => {
      const requestedType = typeof options.type === 'string' ? options.type.toLowerCase() : null;
      if (requestedType === 'hook' || requestedType === 'hooks') {
        throw new Error("Type 'hook' has been removed and is no longer supported.");
      }

      const config = await loadConfig();
      const remote = await ensureRemote(config);

      const registryRoot = resolveRegistryPath(config);
      const { repoPath } = await ensureRegistrySynced({ registryRoot, remote });

      let assets = await loadAssets(repoPath);

      if (options.type) {
        assets = assets.filter((asset) => asset.type === options.type);
      }

      if (options.tool) {
        assets = assets.filter((asset) => !asset.tools || asset.tools.includes(options.tool));
      }

      assets.sort((a, b) => a.id.localeCompare(b.id));

      if (assets.length === 0) {
        console.log('No assets found.');
        return;
      }

      for (const asset of assets) {
        const label = asset.description ? `${asset.id} - ${asset.description}` : asset.id;
        console.log(label);
      }
    });
}

module.exports = {
  registerListCommand,
};
