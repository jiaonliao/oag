'use strict';

const { loadConfig, resolveRegistryPath } = require('../lib/config');
const { ensureRemote } = require('../lib/remoteEnsure');
const { ensureRegistrySynced } = require('../lib/registrySync');
const { loadPresets } = require('../lib/presets');

function formatPresetForTool(preset, tool) {
  const ids = preset.tools[tool] || [];
  const base = preset.description ? `${preset.name} - ${preset.description}` : preset.name;
  return `${base} (${ids.length} assets for ${tool})`;
}

function formatPresetAllTools(preset) {
  const base = preset.description ? `${preset.name} - ${preset.description}` : preset.name;
  const toolSummary = Object.entries(preset.tools)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tool, ids]) => `${tool}:${ids.length}`)
    .join(', ');
  return toolSummary ? `${base} [${toolSummary}]` : base;
}

function registerListPresetsCommand(program) {
  program
    .command('list-presets')
    .description('List available presets')
    .option('--tool <name>', 'Filter by tool')
    .action(async (options) => {
      const config = await loadConfig();
      const remote = await ensureRemote(config);

      const registryRoot = resolveRegistryPath(config);
      const { repoPath } = await ensureRegistrySynced({ registryRoot, remote });

      let presets = await loadPresets(repoPath);
      if (options.tool) {
        presets = presets.filter((preset) => Object.prototype.hasOwnProperty.call(preset.tools, options.tool));
      }

      if (presets.length === 0) {
        console.log('No presets found.');
        return;
      }

      for (const preset of presets) {
        if (options.tool) {
          console.log(formatPresetForTool(preset, options.tool));
          continue;
        }
        console.log(formatPresetAllTools(preset));
      }
    });
}

module.exports = {
  registerListPresetsCommand,
};
