'use strict';

const path = require('path');
const inquirer = require('inquirer');
const { loadConfig, resolveRegistryPath } = require('../lib/config');
const { ensureRemote } = require('../lib/remoteEnsure');
const { ensureRegistrySynced } = require('../lib/registrySync');
const { loadAssets } = require('../lib/registry');
const { loadState, saveState } = require('../lib/state');
const { installAsset, removeTargets, inferBaseDir, normalizeMode } = require('../lib/installers');
const { getHeadCommit } = require('../lib/git');
const { installMcp, uninstallMcpByState } = require('../lib/mcp');
const { pruneEmptyDirs } = require('../lib/prune');

/**
 * Group assets by their type.
 * @param {Array} assets - List of assets
 * @returns {Map<string, Array>} - Map of type to assets
 */
function groupAssetsByType(assets) {
  const grouped = new Map();
  for (const asset of assets) {
    const type = asset.type;
    if (!grouped.has(type)) {
      grouped.set(type, []);
    }
    grouped.get(type).push(asset);
  }
  return grouped;
}

/**
 * Initialize selection state from currently enabled assets.
 * @param {Map<string, Array>} grouped - Grouped assets by type
 * @param {Set<string>} enabledIds - Currently enabled asset IDs
 * @returns {Map<string, Set<string>>} - Selection state map (type -> Set of asset IDs)
 */
function initSelectionState(grouped, enabledIds) {
  const state = new Map();
  for (const [type, typeAssets] of grouped) {
    const selected = new Set();
    for (const asset of typeAssets) {
      if (enabledIds.has(asset.id)) {
        selected.add(asset.id);
      }
    }
    state.set(type, selected);
  }
  return state;
}

/**
 * Merge all type selections into a single Set of asset IDs.
 * @param {Map<string, Set<string>>} selectionState - Selection state map
 * @returns {Set<string>} - All selected asset IDs
 */
function mergeSelections(selectionState) {
  const merged = new Set();
  for (const selected of selectionState.values()) {
    for (const id of selected) {
      merged.add(id);
    }
  }
  return merged;
}

function getTypeFromId(id) {
  return String(id || '').split('/')[0];
}

/**
 * Display main menu with type list and "Save and exit" option.
 * @param {Map<string, Array>} grouped - Grouped assets by type
 * @param {Map<string, Set<string>>} selectionState - Current selection state
 * @returns {Promise<string|null>} - Selected type or null for "Save and exit"
 */
async function showMainMenu(grouped, selectionState) {
  const typeChoices = [];

  for (const [type, typeAssets] of grouped) {
    const totalCount = typeAssets.length;
    // Count enabled assets for this type from current selection state
    const enabledCount = (selectionState.get(type) || new Set()).size;

    const label = enabledCount > 0 ? `${type} (${totalCount} total, ${enabledCount} enabled)` : `${type} (${totalCount} total)`;

    typeChoices.push({
      name: label,
      value: type,
    });
  }

  // Sort by type name
  typeChoices.sort((a, b) => a.value.localeCompare(b.value));

  // Add separator and "Save and exit" option
  typeChoices.push(new inquirer.Separator('────────────────────'));
  typeChoices.push({
    name: 'Save and exit',
    value: null,
  });

  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'selection',
      message: 'Select asset type to configure',
      choices: typeChoices,
      pageSize: 15,
    },
  ]);

  return answer.selection;
}

/**
 * Display asset selection for a specific type.
 * @param {string} type - Asset type
 * @param {Array} typeAssets - Assets of this type
 * @param {string} tool - Tool name
 * @param {Object} toolPaths - Tool path mappings
 * @param {Set<string>} currentSelection - Currently selected asset IDs for this type
 * @returns {Promise<string[]>} - Selected asset IDs
 */
async function selectAssetsForType(type, typeAssets, tool, toolPaths, currentSelection) {
  const choices = buildChoices(typeAssets, tool, toolPaths, currentSelection);

  if (choices.length === 0) {
    return [];
  }

  const answer = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selected',
      message: `Select ${type}s`,
      choices,
      pageSize: 20,
    },
  ]);

  return answer.selected;
}

function registerInstallCommand(program) {
  program
    .command('install')
    .description('Enable or disable assets for a tool')
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

      const assets = await loadAssets(repoPath);
      if (assets.length === 0) {
        console.log('No assets found.');
        return;
      }

      const state = await loadState(projectRoot);
      const toolState = state.tools[tool] || { items: {} };
      const enabledIds = new Set(Object.keys(toolState.items || {}));
      const legacyHookIds = new Set([...enabledIds].filter((id) => getTypeFromId(id) === 'hook'));
      const managedEnabledIds = new Set([...enabledIds].filter((id) => !legacyHookIds.has(id)));

      // Step 1: Group assets by type
      const grouped = groupAssetsByType(assets);

      // Step 2: Initialize selection state from current enabled assets
      const selectionState = initSelectionState(grouped, managedEnabledIds);

      // Step 3: Main menu loop - allow user to configure each type and return to menu
      while (true) {
        const selectedType = await showMainMenu(grouped, selectionState);

        if (selectedType === null) {
          // User selected "Save and exit"
          break;
        }

        // Enter asset selection for this type
        const typeAssets = grouped.get(selectedType);
        const currentSelection = selectionState.get(selectedType) || new Set();
        const newSelection = await selectAssetsForType(
          selectedType,
          typeAssets,
          tool,
          toolConfig.paths,
          currentSelection
        );

        // Update selection state
        selectionState.set(selectedType, new Set(newSelection));
      }

      // Step 4: Calculate and apply changes
      const allSelectedIds = mergeSelections(selectionState);
      const toInstall = [...allSelectedIds].filter((id) => !managedEnabledIds.has(id));
      const toRemove = [...managedEnabledIds].filter((id) => !allSelectedIds.has(id));

      if (toInstall.length === 0 && toRemove.length === 0) {
        console.log('No changes to apply.');
        return;
      }

      const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
      const nextItems = {};
      const mode = normalizeMode(options.mode);
      const commit = await safeGetCommit(repoPath);
      const skipped = [];

      // Reconcile install: uninstall everything currently enabled, then install everything selected.
      // This makes the final file set depend only on "desiredIds" and resolves path collisions deterministically.
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

      const desiredIds = [...allSelectedIds].sort();
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

        if (!toolConfig.paths || !toolConfig.paths[asset.type]) {
          skipped.push({ id, reason: `No path mapping for type '${asset.type}'` });
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

      if (skipped.length > 0) {
        console.log(`Skipped ${skipped.length} assets:`);
        for (const entry of skipped) {
          console.log(`- ${entry.id}: ${entry.reason}`);
        }
      }

      if (preservedLegacyHookCount > 0) {
        console.log(
          `Preserved ${preservedLegacyHookCount} legacy hook items (hook type is no longer supported).`
        );
      }

      console.log(`Enabled ${newlyEnabled.length}, disabled ${newlyDisabled.length} for ${tool}.`);
    });
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

function buildChoices(assets, tool, toolPaths, currentSelection) {
  const sorted = [...assets].sort((a, b) => a.id.localeCompare(b.id));
  return sorted.map((asset) => {
    const supported = isToolSupported(asset, tool);
    const hasMapping = Boolean(toolPaths && toolPaths[asset.type]);
    const selected = currentSelection.has(asset.id);
    const baseLabel = asset.description ? `${asset.id} - ${asset.description}` : asset.id;
    let label = baseLabel;
    if (!hasMapping) {
      label = `${label} (no mapping)`;
    }
    if (!supported) {
      label = `${label} (unsupported)`;
    }
    return {
      name: label,
      value: asset.id,
      checked: selected,
    };
  });
}

async function safeGetCommit(repoPath) {
  try {
    return await getHeadCommit(repoPath);
  } catch (error) {
    return 'unknown';
  }
}

module.exports = {
  registerInstallCommand,
};
