'use strict';

const path = require('path');
const { loadState, saveState } = require('./state');
const { installMcp, uninstallMcpByState } = require('./mcp');
const { installAsset, removeTargets, inferBaseDir, normalizeMode } = require('./installers');
const { pruneEmptyDirs } = require('./prune');

function getTypeFromId(id) {
  return String(id || '').split('/')[0];
}

async function uninstallFileTargets({ item, asset, projectRoot, toolPaths }) {
  if (!item || !Array.isArray(item.targets)) {
    return;
  }

  await removeTargets(item.targets);

  const baseDir = await inferBaseDir({
    item,
    asset,
    projectRoot,
    toolPaths,
  });
  if (!baseDir) {
    return;
  }

  const stopDir = path.dirname(baseDir);
  for (const target of item.targets) {
    await pruneEmptyDirs(path.dirname(target), stopDir);
  }
}

function resolveDesiredMode(item, forcedMode) {
  if (forcedMode) {
    return forcedMode;
  }
  if (item && item.mode) {
    return normalizeMode(item.mode);
  }
  return 'copy';
}

async function updateInstalledAssets({
  projectRoot,
  tool,
  mode,
  config,
  assets,
  commit,
}) {
  const state = await loadState(projectRoot);
  const toolsInState = Object.keys(state.tools || {});
  const targetTools = tool ? [tool] : toolsInState;
  const assetsById = new Map((assets || []).map((asset) => [asset.id, asset]));
  const forcedMode = mode ? normalizeMode(mode) : null;

  const summary = {
    totalItems: 0,
    updated: 0,
    skippedMissing: [],
    skippedNoMapping: [],
    skippedNoToolConfig: [],
    skippedLegacyHook: [],
  };

  let stateChanged = false;

  for (const toolName of targetTools) {
    const toolState = state.tools && state.tools[toolName] ? state.tools[toolName] : null;
    const entries = toolState && toolState.items ? Object.entries(toolState.items) : [];
    if (entries.length === 0) {
      continue;
    }

    summary.totalItems += entries.length;

    const toolConfig = config.tools && config.tools[toolName] ? config.tools[toolName] : null;
    if (!toolConfig || !toolConfig.paths) {
      summary.skippedNoToolConfig.push(toolName);
      continue;
    }

    const nextItems = {};
    let toolChanged = false;

    for (const [id, item] of entries) {
      const typeFromId = getTypeFromId(id);
      if (typeFromId === 'hook') {
        summary.skippedLegacyHook.push({ tool: toolName, id });
        nextItems[id] = item;
        continue;
      }

      const asset = assetsById.get(id);
      if (!asset) {
        summary.skippedMissing.push({ tool: toolName, id });
        nextItems[id] = item;
        continue;
      }

      const assetType = asset.type || typeFromId;

      if (assetType !== 'mcp') {
        if (!toolConfig.paths[assetType]) {
          summary.skippedNoMapping.push({ tool: toolName, id, type: assetType });
          nextItems[id] = item;
          continue;
        }
      } else if (!toolConfig.paths.mcp) {
        summary.skippedNoMapping.push({ tool: toolName, id, type: assetType });
        nextItems[id] = item;
        continue;
      }

      const desiredMode = resolveDesiredMode(item, forcedMode);

      if (assetType === 'mcp') {
        if (item && item.mcp) {
          await uninstallMcpByState(projectRoot, toolConfig, item.mcp);
        } else if (item && Array.isArray(item.targets)) {
          await removeTargets(item.targets);
        }
      } else {
        await uninstallFileTargets({
          item,
          asset,
          projectRoot,
          toolPaths: toolConfig.paths,
        });
      }

      if (assetType === 'mcp') {
        const { targets, mcpState } = await installMcp(asset, projectRoot, toolName, toolConfig);
        nextItems[id] = { targets, mode: desiredMode, commit, mcp: mcpState };
      } else {
        const { targets, baseDir } = await installAsset({
          asset,
          projectRoot,
          toolPaths: toolConfig.paths,
          mode: desiredMode,
        });
        nextItems[id] = baseDir
          ? { targets, mode: desiredMode, commit, baseDir }
          : { targets, mode: desiredMode, commit };
      }

      summary.updated += 1;
      toolChanged = true;
    }

    if (toolChanged) {
      state.tools[toolName] = { items: nextItems };
      stateChanged = true;
    }
  }

  if (stateChanged) {
    await saveState(projectRoot, state);
  }

  return summary;
}

module.exports = {
  updateInstalledAssets,
};
