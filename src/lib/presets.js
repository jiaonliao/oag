'use strict';

const fs = require('fs/promises');
const path = require('path');
const { pathExists } = require('./fs');

const PRESETS_DIR = 'presets';
const ASSET_ID_PATTERN = /^[^/\s]+\/[^/\s]+$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAssetIds({ manifestPath, tool, value }) {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid preset: ${manifestPath} (tools.${tool} must be an array).`);
  }

  const ids = [];
  const seen = new Set();
  for (const raw of value) {
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new Error(`Invalid preset: ${manifestPath} (tools.${tool} must contain non-empty strings).`);
    }

    const id = raw.trim();
    if (!ASSET_ID_PATTERN.test(id)) {
      throw new Error(`Invalid preset: ${manifestPath} (invalid asset ID '${id}', expected type/name).`);
    }

    if (!seen.has(id)) {
      ids.push(id);
      seen.add(id);
    }
  }

  return ids;
}

async function loadPresets(registryPath) {
  const presetsRoot = path.join(registryPath, PRESETS_DIR);
  if (!(await pathExists(presetsRoot))) {
    return [];
  }

  const entries = await fs.readdir(presetsRoot, { withFileTypes: true });
  const presets = [];
  const names = new Set();

  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.json') {
      continue;
    }

    const manifestPath = path.join(presetsRoot, entry.name);
    const raw = await fs.readFile(manifestPath, 'utf8');
    let manifest;
    try {
      manifest = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Invalid JSON in preset: ${manifestPath}`);
    }

    if (!isPlainObject(manifest)) {
      throw new Error(`Invalid preset: ${manifestPath} (expected a JSON object).`);
    }

    const name = typeof manifest.name === 'string' ? manifest.name.trim() : '';
    if (!name) {
      throw new Error(`Invalid preset: ${manifestPath} ('name' is required).`);
    }
    if (names.has(name)) {
      throw new Error(`Duplicate preset name '${name}' in ${presetsRoot}.`);
    }

    if (!isPlainObject(manifest.tools)) {
      throw new Error(`Invalid preset: ${manifestPath} ('tools' must be an object).`);
    }

    const tools = {};
    for (const [tool, ids] of Object.entries(manifest.tools)) {
      tools[tool] = normalizeAssetIds({ manifestPath, tool, value: ids });
    }

    if (Object.keys(tools).length === 0) {
      throw new Error(`Invalid preset: ${manifestPath} ('tools' must define at least one tool).`);
    }

    names.add(name);
    presets.push({
      name,
      description: typeof manifest.description === 'string' ? manifest.description.trim() : '',
      tools,
      file: manifestPath,
    });
  }

  presets.sort((a, b) => a.name.localeCompare(b.name));
  return presets;
}

function getPresetByName(presets, name) {
  if (!name) {
    return null;
  }
  return presets.find((preset) => preset.name === name) || null;
}

function getPresetAssetIdsForTool(preset, tool) {
  if (!preset || !preset.tools || !Object.prototype.hasOwnProperty.call(preset.tools, tool)) {
    return null;
  }
  const ids = preset.tools[tool];
  return Array.isArray(ids) ? ids.slice() : [];
}

module.exports = {
  loadPresets,
  getPresetByName,
  getPresetAssetIdsForTool,
};
