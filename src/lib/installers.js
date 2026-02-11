'use strict';

const path = require('path');
const fs = require('fs/promises');
const { pathExists, ensureDir } = require('./fs');
const { resolveTargetPath } = require('./paths');

function normalizeMode(mode) {
  if (!mode) {
    return 'copy';
  }
  const normalized = mode.toLowerCase();
  if (normalized !== 'symlink' && normalized !== 'copy') {
    throw new Error(`Invalid mode '${mode}'. Use symlink or copy.`);
  }
  return normalized;
}

async function prepareTarget(targetPath, sourcePath, mode) {
  if (!(await pathExists(targetPath))) {
    return false;
  }

  const stat = await fs.lstat(targetPath);
  if (mode === 'symlink' && stat.isSymbolicLink()) {
    const link = await fs.readlink(targetPath);
    const resolved = path.resolve(path.dirname(targetPath), link);
    if (resolved === sourcePath) {
      return true;
    }
  }

  if (stat.isDirectory()) {
    throw new Error(`Target is a directory: ${targetPath}`);
  }

  await fs.unlink(targetPath);
  return false;
}

async function installAsset({ asset, projectRoot, toolPaths, mode }) {
  if (!asset.files || asset.files.length === 0) {
    throw new Error(`Asset '${asset.id}' has no files to install.`);
  }

  const targets = [];
  let baseDir = null;
  for (const file of asset.files) {
    const sourcePath = path.join(asset.dir, file.source);
    if (!(await pathExists(sourcePath))) {
      throw new Error(`Source file not found: ${sourcePath}`);
    }

    const { targetPath, basePath, isDir } = await resolveTargetPath(
      projectRoot,
      toolPaths,
      asset.type,
      asset.name,
      asset.dir,
      sourcePath,
    );
    if (isDir && !baseDir) {
      baseDir = basePath;
    }

    const skip = await prepareTarget(targetPath, sourcePath, mode);
    await ensureDir(path.dirname(targetPath));

    if (!skip) {
      if (mode === 'symlink') {
        await fs.symlink(sourcePath, targetPath);
      } else {
        await fs.copyFile(sourcePath, targetPath);
      }
    }

    targets.push(targetPath);
  }

  return { targets, baseDir };
}

async function removeTargets(targets) {
  for (const target of targets) {
    if (!(await pathExists(target))) {
      continue;
    }

    const stat = await fs.lstat(target);
    if (stat.isDirectory()) {
      throw new Error(`Refusing to remove directory target: ${target}`);
    }
    await fs.unlink(target);
  }
}

async function inferBaseDir({ item, asset, projectRoot, toolPaths }) {
  if (item && typeof item.baseDir === 'string' && item.baseDir.trim()) {
    return item.baseDir;
  }
  if (!asset || !asset.files || asset.files.length === 0) {
    return null;
  }
  if (!toolPaths || !toolPaths[asset.type]) {
    return null;
  }

  const sourcePath = path.join(asset.dir, asset.files[0].source);
  const { basePath, isDir } = await resolveTargetPath(
    projectRoot,
    toolPaths,
    asset.type,
    asset.name,
    asset.dir,
    sourcePath,
  );
  return isDir ? basePath : null;
}

module.exports = {
  normalizeMode,
  installAsset,
  removeTargets,
  inferBaseDir,
};
