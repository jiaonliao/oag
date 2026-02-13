# oag

`oag` is a CLI for managing a Git-based AI registry and installing assets into local projects for tools like Claude and Codex.

## Documentation

- [Chinese README](README.zh.md)
- [Registry Maintenance Guide (English)](docs/add-asset.en.md)
- [Registry Maintenance Guide (Chinese)](docs/add-asset.zh.md)

## What oag does

- Connects your local machine to a remote registry repository.
- Syncs the registry automatically before read/apply operations.
- Lets you enable/disable assets interactively per tool and per type.
- Installs files using `copy` or `symlink` mode.
- Tracks installed items per project so updates are repeatable.
- Handles MCP assets for Claude and Codex config formats.

## Key features

- **Remote registry management** via Git (`clone` on first use, then `fetch + reset`).
- **Tool-aware installs** with built-in path mappings for:
  - Claude
  - Codex
- **Interactive selection UI** in `oag install`.
- **Preset-based reconcile install** via `oag preset`.
- **State-based updates** with `oag update`.
- **MCP support** with format handling:
  - Claude: `.mcp.json`
  - Codex: `.codex/config.toml`

## Installation

Install from npm:

```bash
npm install -g @wrenfix/oag
```

Verify:

```bash
oag --help
```

## Configuration

Global config path:

- `~/.oag/config.json`

Defaults:

```json
{
  "registryPath": "~/.oag/registry",
  "remote": null
}
```

Minimal config (recommended):

```json
{
  "remote": {
    "url": "https://github.com/<you>/<your-registry>.git",
    "branch": "main"
  }
}
```

Notes:

- Tool path mappings are built into `oag` (not loaded from user config).
- If no remote is configured, `list` / `list-presets` / `install` / `preset` / `update` will prompt for it.

## Quick start (with fork workflow)

1. **Fork your registry repository** (for example on GitHub).
2. **Point `oag` to your fork**:

   ```bash
   oag remote add https://github.com/<you>/<your-registry>.git main
   ```

3. **List available assets**:

   ```bash
   oag list --tool claude
   ```

4. **List available presets**:

   ```bash
   oag list-presets --tool claude
   ```

5. **Install assets interactively**:

   ```bash
   oag install --tool claude --mode copy
   ```

6. **Apply a preset directly**:

   ```bash
   oag preset --tool claude --name oag-starter --mode copy
   ```

7. **Update installed assets later**:

   ```bash
   oag update
   ```

## Commands

### `oag remote add <url> [branch]`

Save the remote registry location.

Example:

```bash
oag remote add https://github.com/<you>/<your-registry>.git main
```

### `oag list [--type <type>] [--tool <name>]`

List assets from the synced registry.

Options:

- `--type <type>`: filter by type (for example `agent`, `skill`, `prompt`, `mcp`)
- `--tool <name>`: filter by tool compatibility hint

Example:

```bash
oag list --type skill --tool codex
```

### `oag install [--tool <name>] [--project <path>] [--mode <mode>]`

Interactively enable or disable assets for a tool in a project.

Options:

- `--tool <name>`: target tool (for example `claude`, `codex`)
- `--project <path>`: project root (default: current directory)
- `--mode <mode>`: `copy` or `symlink` (default: `copy`)

Example:

```bash
oag install --tool codex --project . --mode symlink
```

### `oag list-presets [--tool <name>]`

List preset templates from the synced registry.

Options:

- `--tool <name>`: show only presets that define this tool

Example:

```bash
oag list-presets --tool codex
```

### `oag preset [--name <preset>] [--tool <name>] [--project <path>] [--mode <mode>]`

Apply one preset and reconcile managed assets to exactly the preset set.

Options:

- `--name <preset>`: preset name (if omitted, choose interactively)
- `--tool <name>`: target tool (if omitted, choose interactively)
- `--project <path>`: project root (default: current directory)
- `--mode <mode>`: `copy` or `symlink` (default: `copy`)

Example:

```bash
oag preset --name oag-starter --tool codex --project . --mode copy
```

### `oag update [--tool <name>] [--project <path>] [--mode <mode>]`

Reinstall/update items already recorded in project state.

Options:

- `--tool <name>`: update only one tool
- `--project <path>`: project root (default: current directory)
- `--mode <mode>`: force mode for this run (`copy` or `symlink`)

Example:

```bash
oag update --tool claude
```

## How oag works

### 1) Registry sync

Before `list`, `list-presets`, `install`, `preset`, and `update`, `oag` syncs your configured registry:

- first run: clone into `~/.oag/registry/repo` (or your custom `registryPath`)
- later runs: fetch remote, hard reset to configured branch, clean untracked files

### 2) Install targets (built-in)

`oag` has built-in mappings for where each asset type is written.

**Claude**

- `agent` -> `CLAUDE.md`
- `skill` -> `.claude/skills/`
- `mcp` -> `.mcp.json`
- `prompt` -> `prompts`

**Codex**

- `agent` -> `AGENT.md`
- `skill` -> `.codex/skills/`
- `mcp` -> `.codex/config.toml`
- `prompt` -> `prompts`

### 3) Project state

Installed results are tracked in:

- `.oag/state.json` (inside your project root)

State is used by `update` to know what should be refreshed and where.

## Preset file format

Preset files live under `presets/*.json` in your registry repo.

Example:

```json
{
  "name": "oag-starter",
  "description": "Project starter preset for oag (codex + claude)",
  "tools": {
    "codex": [
      "agent/develop-agent",
      "mcp/context7",
      "mcp/chrome-devtools",
      "skill/commit",
      "skill/frontend-design",
      "skill/skill-creator"
    ],
    "claude": [
      "agent/develop-agent",
      "mcp/context7",
      "mcp/chrome-devtools",
      "skill/commit",
      "skill/frontend-design",
      "skill/skill-creator"
    ]
  }
}
```

Notes:

- Asset IDs use `type/name` format.
- `name` and `tools` are required; `description` is optional.
- `tools` must define at least one tool, and each `tools.<tool>` value must be a string array.
- `oag preset` is strict: if any preset asset is missing/unsupported/unmapped for the selected tool, the command fails instead of partially applying.

## MCP notes

For `mcp` assets, `oag` applies config updates instead of simple file copies:

- For Claude, servers are merged into `.mcp.json`.
- For Codex, servers are written under `mcp_servers` in `.codex/config.toml`.
- During reinstall/update, `oag` uses stored state to rollback/reapply managed MCP entries safely.

## Troubleshooting

- **Error: `No remote configured.`**
  - Run `oag remote add <url> [branch]` first.
- **Error: `Type 'hook' has been removed and is no longer supported.`**
  - `hook` is deprecated and cannot be listed/installed as a new type.
- **Error: `Tool '<name>' is not configured.`**
  - Use a built-in tool name (`claude` or `codex`).
- **Error: `Invalid mode '<mode>'. Use symlink or copy.`**
  - Choose `--mode copy` or `--mode symlink`.
- **Error: `Preset '<name>' not found`**
  - Check whether the preset exists under `presets/*.json` and the `name` matches your argument.
- **Error: `Preset '<name>' does not define assets for tool '<tool>'`**
  - Add the target tool key (for example `codex` or `claude`) under `tools`.
- **Error: `Invalid preset: ... (invalid asset ID '...', expected type/name)`**
  - Use `type/name` format for each asset ID (for example `skill/commit`).
- **Error: `Preset '<name>' has invalid assets for tool '<tool>'`**
  - Fix the reported items: missing asset, tool mismatch, or missing path mapping.
