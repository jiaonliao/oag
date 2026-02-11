'use strict';

const path = require('path');
const { ensureDir, pathExists } = require('./fs');
const { runGit } = require('./git');
const { withSpinner } = require('./progress');

async function ensureRegistrySynced({ registryRoot, remote }) {
  if (!remote || !remote.url) {
    throw new Error('No remote configured.');
  }

  const branch = remote.branch || 'main';
  const repoPath = path.join(registryRoot, 'repo');

  if (!(await pathExists(repoPath))) {
    await ensureDir(registryRoot);
    await withSpinner('Cloning registry...', () =>
      runGit([
        'clone',
        '--branch',
        branch,
        '--single-branch',
        remote.url,
        repoPath,
      ])
    );
    return { repoPath, action: 'cloned' };
  }

  // Validate it's a git repo.
  if (!(await pathExists(path.join(repoPath, '.git')))) {
    throw new Error(`Registry path exists but is not a git repo: ${repoPath}`);
  }

  // Ensure origin points at the configured remote URL.
  const remotesRaw = await runGit(['remote'], { cwd: repoPath });
  const remotes = new Set(remotesRaw.split('\n').map((line) => line.trim()).filter(Boolean));
  if (!remotes.has('origin')) {
    await runGit(['remote', 'add', 'origin', remote.url], { cwd: repoPath });
  } else {
    await runGit(['remote', 'set-url', 'origin', remote.url], { cwd: repoPath });
  }

  await withSpinner('Updating registry...', async () => {
    await runGit(['fetch', 'origin', '--prune'], { cwd: repoPath });
    await runGit(['reset', '--hard', `origin/${branch}`], { cwd: repoPath });
    await runGit(['clean', '-fd'], { cwd: repoPath });
  });

  return { repoPath, action: 'updated' };
}

module.exports = {
  ensureRegistrySynced,
};
