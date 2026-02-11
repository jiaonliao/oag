'use strict';

const fs = require('fs/promises');
const path = require('path');
const { pathExists } = require('./fs');

async function resolveTargetPath(projectRoot, toolPaths, assetType, assetName, assetDir, sourcePath) {
  const mapping = toolPaths[assetType];
  if (!mapping) {
    throw new Error(`Missing path mapping for type '${assetType}'`);
  }

  const hasTrailingSlash = mapping.endsWith('/') || mapping.endsWith(path.sep);
  const normalizedMapping = mapping.replace(/[\\/]+$/, '');
  const targetBase = path.join(projectRoot, normalizedMapping);

  let isDir = hasTrailingSlash;
  if (!isDir) {
    if (await pathExists(targetBase)) {
      const stat = await fs.lstat(targetBase);
      isDir = stat.isDirectory();
    } else {
      isDir = path.extname(normalizedMapping) === '';
    }
  }

  if (!isDir) {
    return { targetPath: targetBase, basePath: targetBase, isDir: false };
  }

  if (!assetName) {
    throw new Error(`Missing asset name for type '${assetType}'`);
  }

  const relativePath = path.relative(assetDir, sourcePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Source path is outside asset directory: ${sourcePath}`);
  }

  const assetBase = path.join(targetBase, assetName);
  const targetPath = path.join(assetBase, relativePath);

  return { targetPath, basePath: assetBase, isDir: true };
}

module.exports = {
  resolveTargetPath,
};
