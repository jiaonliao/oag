'use strict';

const path = require('path');
const inquirer = require('inquirer');
const { loadConfig, resolveRegistryPath } = require('../lib/config');
const { ensureRemote } = require('../lib/remoteEnsure');
const { ensureRegistrySynced } = require('../lib/registrySync');
const { loadAssets } = require('../lib/registry');
const { loadPresets, getPresetByName, getPresetAssetIdsForTool } = require('../lib/presets');
const { loadState, saveState } = require('../lib/state');
const { installAsset, removeTargets, inferBaseDir, normalizeMode } = require('../lib/installers');
const { getHeadCommit } = require('../lib/git');
const { installMcp, uninstallMcpByState } = require('../lib/mcp');
const { pruneEmptyDirs } = require('../lib/prune');

function getTypeFromId(id) {
  return String(id || '').split('/')[0];
}

function isToolSupported(asset, tool) {
  return !asset.tools || asset.tools.includes(tool);
}

async function resolveTool(config, provided) {
  if (provided) {
    return provided;
  }

  const tools = Object.keys(config.tools || {});
  if (tools.length === 0) {
    throw new Error('No tools configured.');
  }

  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'tool',
      message: 'Select a tool',
      choices: tools,
    },
  ]);

  return answer.tool;
}

async function resolvePreset(presets, provided) {
  if (provided) {
    const preset = getPresetByName(presets, provided);
    if (preset) {
      return preset;
    }
    const available = presets.map((entry) => entry.name).join(', ');
    throw new Error(`Preset '${provided}' not found. Available presets: ${available || '(none)'}.`);
  }

  if (presets.length === 0) {
    throw new Error('No presets found.');
  }

  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'preset',
      message: 'Select a preset',
      choices: presets.map((preset) => ({
        name: preset.description ? `${preset.name} - ${preset.description}` : preset.name,
        value: preset.name,
      })),
      pageSize: 20,
    },
  ]);

  return getPresetByName(presets, answer.preset);
}

function validatePresetAssets({ presetName, tool, assetIds, assetsById, toolConfig }) {
  const errors = [];
  const validIds = [];
  const seen = new Set();

  for (const id of assetIds) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);

    const asset = assetsById.get(id);
    if (!asset) {
      errors.push(`- ${id}: asset not found in registry`);
      continue;
    }

    if (!isToolSupported(asset, tool)) {
      errors.push(`- ${id}: asset is not compatible with tool '${tool}'`);
      continue;
    }

    if (!toolConfig.paths || !toolConfig.paths[asset.type]) {
      errors.push(`- ${id}: no path mapping for type '${asset.type}' on tool '${tool}'`);
      continue;
    }

    validIds.push(id);
  }

  if (errors.length > 0) {
    throw new Error(
      `Preset '${presetName}' has invalid assets for tool '${tool}':\n${errors.join('\n')}`
    );
  }

  return validIds;
}

async function safeGetCommit(repoPath) {
  try {
    return await getHeadCommit(repoPath);
  } catch (error) {
    return 'unknown';
  }
}

function registerPresetCommand(program) {
  program
    .command('preset')
    .description('Apply a preset and reconcile assets for a tool')
    .option('--name <preset>', 'Preset name')
    .option('--tool <name>', 'Tool name')
    .option('--project <path>', 'Project root path')
    .option('--mode <mode>', 'Install mode (symlink|copy)', 'copy')
    .action(async (options) => {
      const config = await loadConfig();
      const remote = await ensureRemote(config);
      const tool = await resolveTool(config, options.tool);
      const toolConfig = config.tools[tool];
      if (!toolConfig || !toolConfig.paths) {
        throw new Error(`Tool '${tool}' is not configured.`);
      }

      const projectRoot = path.resolve(options.project || process.cwd());

      const registryRoot = resolveRegistryPath(config);
      const { repoPath } = await ensureRegistrySynced({ registryRoot, remote });

      const [assets, presets] = await Promise.all([loadAssets(repoPath), loadPresets(repoPath)]);
      if (presets.length === 0) {
        throw new Error('No presets found in registry.');
      }

      const preset = await resolvePreset(presets, options.name);
      const assetIds = getPresetAssetIdsForTool(preset, tool);
      if (assetIds === null) {
        throw new Error(`Preset '${preset.name}' does not define assets for tool '${tool}'.`);
      }

      const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
      const desiredIds = validatePresetAssets({
        presetName: preset.name,
        tool,
        assetIds,
        assetsById,
        toolConfig,
      }).sort();

      const state = await loadState(projectRoot);
      const toolState = state.tools[tool] || { items: {} };
      const enabledIds = new Set(Object.keys(toolState.items || {}));
      const legacyHookIds = new Set([...enabledIds].filter((id) => getTypeFromId(id) === 'hook'));
      const managedEnabledIds = new Set([...enabledIds].filter((id) => !legacyHookIds.has(id)));
      const allSelectedIds = new Set(desiredIds);

      const toInstall = [...allSelectedIds].filter((id) => !managedEnabledIds.has(id));
      const toRemove = [...managedEnabledIds].filter((id) => !allSelectedIds.has(id));
      if (toInstall.length === 0 && toRemove.length === 0) {
        console.log('No changes to apply.');
        return;
      }

      const nextItems = {};
      const mode = normalizeMode(options.mode);
      const commit = await safeGetCommit(repoPath);

      const enabledEntries = Object.entries(toolState.items || {});
      let preservedLegacyHookCount = 0;
      for (let i = enabledEntries.length - 1; i >= 0; i--) {
        const [id, item] = enabledEntries[i];
        const asset = assetsById.get(id);
        const typeFromId = getTypeFromId(id);

        if (typeFromId === 'hook') {
          nextItems[id] = item;
          preservedLegacyHookCount += 1;
          continue;
        }

        if (typeFromId === 'mcp') {
          if (item && item.mcp) {
            await uninstallMcpByState(projectRoot, toolConfig, item.mcp);
          } else if (item && Array.isArray(item.targets)) {
            await removeTargets(item.targets);
          }
          continue;
        }

        if (item && Array.isArray(item.targets)) {
          await removeTargets(item.targets);

          const baseDir = await inferBaseDir({
            item,
            asset,
            projectRoot,
            toolPaths: toolConfig.paths,
          });
          if (baseDir) {
            const stopDir = path.dirname(baseDir);
            for (const target of item.targets) {
              await pruneEmptyDirs(path.dirname(target), stopDir);
            }
          }
        }
      }

      for (const id of desiredIds) {
        const asset = assetsById.get(id);
        if (!asset) {
          throw new Error(`Asset '${id}' not found.`);
        }

        if (asset.type === 'mcp') {
          const { targets, mcpState } = await installMcp(asset, projectRoot, tool, toolConfig);
          nextItems[id] = { targets, mode, commit, mcp: mcpState };
          continue;
        }

        const { targets, baseDir } = await installAsset({
          asset,
          projectRoot,
          toolPaths: toolConfig.paths,
          mode,
        });
        nextItems[id] = baseDir ? { targets, mode, commit, baseDir } : { targets, mode, commit };
      }

      state.tools[tool] = { items: nextItems };
      await saveState(projectRoot, state);

      const enabledAfter = new Set(
        Object.keys(nextItems).filter((id) => getTypeFromId(id) !== 'hook')
      );
      const newlyEnabled = [...enabledAfter].filter((id) => !managedEnabledIds.has(id));
      const newlyDisabled = [...managedEnabledIds].filter((id) => !enabledAfter.has(id));

      if (preservedLegacyHookCount > 0) {
        console.log(
          `Preserved ${preservedLegacyHookCount} legacy hook items (hook type is no longer supported).`
        );
      }

      console.log(
        `Applied preset '${preset.name}' for ${tool}: enabled ${newlyEnabled.length}, disabled ${newlyDisabled.length}.`
      );
    });
}

module.exports = {
  registerPresetCommand,
};
