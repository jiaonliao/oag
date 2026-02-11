'use strict';

const inquirer = require('inquirer');
const { saveConfig } = require('./config');

async function ensureRemote(config) {
  if (config && config.remote && config.remote.url) {
    return config.remote;
  }

  const answer = await inquirer.prompt([
    {
      type: 'input',
      name: 'url',
      message: 'Remote registry URL',
      validate: (value) => {
        if (!value || !String(value).trim()) {
          return 'Remote URL is required';
        }
        return true;
      },
      filter: (value) => String(value || '').trim(),
    },
    {
      type: 'input',
      name: 'branch',
      message: 'Remote branch',
      default: 'main',
      filter: (value) => String(value || '').trim() || 'main',
    },
  ]);

  config.remote = {
    url: answer.url,
    branch: answer.branch || 'main',
  };

  await saveConfig(config);
  return config.remote;
}

module.exports = {
  ensureRemote,
};

