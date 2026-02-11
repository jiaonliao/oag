'use strict';

const fs = require('fs/promises');
const path = require('path');

async function isEmptyDir(dirPath) {
  const entries = await fs.readdir(dirPath);
  return entries.length === 0;
}

// Remove empty directories from startDir upwards, stopping before stopDir.
async function pruneEmptyDirs(startDir, stopDir) {
  if (!startDir || !stopDir) {
    return;
  }

  const resolvedStart = path.resolve(startDir);
  const resolvedStop = path.resolve(stopDir);
  const rel = path.relative(resolvedStop, resolvedStart);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return;
  }

  let current = resolvedStart;
  while (true) {
    if (current === resolvedStop) {
      break;
    }

    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        break;
      }
      throw error;
    }

    if (!stat.isDirectory()) {
      break;
    }

    let empty = false;
    try {
      empty = await isEmptyDir(current);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        break;
      }
      throw error;
    }

    if (!empty) {
      break;
    }

    try {
      await fs.rmdir(current);
    } catch (error) {
      if (error && (error.code === 'ENOTEMPTY' || error.code === 'ENOENT')) {
        break;
      }
      throw error;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
}

module.exports = {
  pruneEmptyDirs,
};

