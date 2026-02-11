'use strict';

const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { ensureDir, pathExists } = require('./fs');

const DEFAULT_TOOLS = {
  claude: {
    paths: {
      agent: 'CLAUDE.md',
      skill: '.claude/skills/',
      mcp: '.mcp.json',
      prompt: 'prompts',
    },
    settingsPath: '.claude/settings.json',
  },
  codex: {
    paths: {
      agent: 'AGENT.md',
      skill: '.codex/skills/',
      mcp: '.codex/config.toml',
      prompt: 'prompts',
    },
  },
};

function getConfigDir() {
  return path.join(os.homedir(), '.oag');
}

function getConfigPath() {
  return path.join(getConfigDir(), 'config.json');
}

function getDefaultConfig() {
  return {
    registryPath: path.join(getConfigDir(), 'registry'),
    remote: null,
    tools: DEFAULT_TOOLS,
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeDefaults(target, defaults) {
  if (Array.isArray(defaults)) {
    return Array.isArray(target) ? target : defaults.slice();
  }
  if (!isPlainObject(defaults)) {
    return target === undefined ? defaults : target;
  }

  const result = isPlainObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(defaults)) {
    if (result[key] === undefined) {
      result[key] = value;
      continue;
    }
    result[key] = mergeDefaults(result[key], value);
  }
  return result;
}

function expandHome(inputPath) {
  if (!inputPath) {
    return inputPath;
  }
  if (inputPath === '~') {
    return os.homedir();
  }
  if (inputPath.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function resolveRegistryPath(config) {
  const rawPath = config && config.registryPath ? config.registryPath : getDefaultConfig().registryPath;
  return expandHome(rawPath);
}

async function loadConfig() {
  const configPath = getConfigPath();
  if (!(await pathExists(configPath))) {
    return getDefaultConfig();
  }

  const raw = await fs.readFile(configPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in config: ${configPath}`);
  }

  const merged = mergeDefaults(parsed, getDefaultConfig());

  // Tools config is always program-defined. User config may still store remote/registryPath.
  merged.tools = DEFAULT_TOOLS;

  return merged;
}

async function saveConfig(config) {
  const configDir = getConfigDir();
  await ensureDir(configDir);

  // Persist only user-relevant fields (remote/registryPath). Tool mappings are program-defined.
  const toSave = { ...config };
  delete toSave.tools;

  await fs.writeFile(getConfigPath(), JSON.stringify(toSave, null, 2), 'utf8');
}

module.exports = {
  loadConfig,
  saveConfig,
  getConfigPath,
  resolveRegistryPath,
};
