'use strict';

const fs = require('fs/promises');
const path = require('path');
const { pathExists } = require('./fs');

const TYPE_DIRS = {
  agent: 'agents',
  skill: 'skills',
  mcp: 'mcp',
  prompt: 'prompts',
};

async function loadAssets(registryPath) {
  const assets = [];
  for (const [type, dirName] of Object.entries(TYPE_DIRS)) {
    const list = await loadAssetsForType(registryPath, type, dirName);
    assets.push(...list);
  }
  return assets;
}

async function loadAssetsForType(registryPath, type, dirName) {
  const assets = [];
  const typeRoot = path.join(registryPath, dirName);
  if (!(await pathExists(typeRoot))) {
    return assets;
  }

  const entries = await fs.readdir(typeRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const assetDir = path.join(typeRoot, entry.name);
    const manifestPath = path.join(assetDir, 'asset.json');
    if (!(await pathExists(manifestPath))) {
      continue;
    }

    const raw = await fs.readFile(manifestPath, 'utf8');
    let manifest;
    try {
      manifest = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Invalid JSON in asset: ${manifestPath}`);
    }

    const name = manifest.name || entry.name;
    const assetType = manifest.type || type;
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    const normalizedFiles = files
      .filter((file) => file && typeof file.source === 'string' && file.source.trim())
      .map((file) => ({ source: file.source }));

    assets.push({
      id: `${assetType}/${name}`,
      name,
      type: assetType,
      description: manifest.description || '',
      tools: Array.isArray(manifest.tools) ? manifest.tools : null,
      files: normalizedFiles,
      dir: assetDir,
    });
  }

  return assets;
}

module.exports = {
  loadAssets,
  TYPE_DIRS,
};
