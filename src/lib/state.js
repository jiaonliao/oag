'use strict';

const fs = require('fs/promises');
const path = require('path');
const { ensureDir, pathExists } = require('./fs');

function getStatePath(projectRoot) {
  return path.join(projectRoot, '.oag', 'state.json');
}

async function loadState(projectRoot) {
  const statePath = getStatePath(projectRoot);
  if (!(await pathExists(statePath))) {
    return { tools: {} };
  }

  const raw = await fs.readFile(statePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in state: ${statePath}`);
  }

  if (!parsed.tools || typeof parsed.tools !== 'object') {
    return { tools: {} };
  }

  return parsed;
}

async function saveState(projectRoot, state) {
  const statePath = getStatePath(projectRoot);
  await ensureDir(path.dirname(statePath));
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
}

module.exports = {
  loadState,
  saveState,
  getStatePath,
};
