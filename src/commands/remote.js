'use strict';

const { loadConfig, saveConfig } = require('../lib/config');

function registerRemoteCommands(program) {
  const remote = program.command('remote').description('Manage remote');

  remote
    .command('add <url> [branch]')
    .description('Add remote repository')
    .action(async (url, branch) => {
      const config = await loadConfig();
      config.remote = {
        url,
        branch: branch || 'main',
      };
      await saveConfig(config);
      console.log(`Remote saved: ${url}`);
    });
}

module.exports = {
  registerRemoteCommands,
};
