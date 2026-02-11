'use strict';

const { spawn } = require('child_process');

function runGit(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      reject(new Error(`Failed to run git: ${error.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        const message = stderr.trim() || `git ${args.join(' ')} failed`;
        reject(new Error(message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

async function getHeadCommit(repoPath) {
  return runGit(['rev-parse', 'HEAD'], { cwd: repoPath });
}

module.exports = {
  runGit,
  getHeadCommit,
};
