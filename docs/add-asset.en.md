# Registry Maintenance Guide (Adding Assets)

> Scope: teams or individuals maintaining their own asset registry repository for `agent`, `skill`, `prompt`, `mcp` assets and preset templates (`preset`).

## 1) Quick Flow

1. Create type roots in your registry repo (`agents/`, `skills/`, `prompts/`, `mcp/`).
2. Create an asset directory and `asset.json`.
3. Add asset files (for example `AGENT.md`, `SKILL.md`, `mcp.json`).
4. Add `presets/*.json` as needed (for bundled installs).
5. Commit and push to your registry branch.
6. Validate from a consumer project using `oag list/list-presets/install/preset/update`.

## 2) Repository Boundaries

- **Registry repository (you maintain):** stores asset source files, `asset.json` manifests, and preset templates (`presets/*.json`) such as `agents/*`, `skills/*`, `prompts/*`, `mcp/*`, and `presets/*`.
- **Consumer project:** runs `oag` commands to install assets; it does not own registry structure.
- **oag tool repository:** contains CLI source code; it is separate from your registry repository.

## 3) Fixed Directory Structure (Current `oag` Discovery Rules)

Current `oag` discovery loads four asset roots and one preset root:

```text
agents/
  <asset-name>/
    asset.json
    AGENT.md

skills/
  <asset-name>/
    asset.json
    SKILL.md
    references/... (optional)
    scripts/...    (optional)

prompts/
  <asset-name>/
    asset.json
    <your-prompt-file>

mcp/
  <asset-name>/
    asset.json
    mcp.json

presets/
  <preset-name>.json
```

Naming recommendations:

- Use lowercase kebab-case for folder names (for example `my-skill`).
- Keep `name` in `asset.json` consistent with the folder name.
- Asset ID is `type/name` (for example `skill/my-skill`).
- Use lowercase kebab-case for preset filenames (for example `starter.json`).

## 4) `asset.json` Rules

| Field | Required | Description |
| --- | --- | --- |
| `name` | Recommended | Asset name; falls back to folder name if omitted. |
| `type` | Recommended | `agent`, `skill`, `prompt`, or `mcp`. |
| `description` | No | Optional description. |
| `tools` | No | `claude` and/or `codex`; empty means unrestricted. |
| `files` | Yes | File list; each entry must include `source`. |

Generic template:

```json
{
  "name": "my-asset",
  "type": "skill",
  "description": "Short description",
  "tools": ["claude", "codex"],
  "files": [
    { "source": "SKILL.md" }
  ]
}
```

Important rules:

- `files[].source` must point to real files inside the asset directory.
- `source` must not escape the asset directory (for example `../`).
- Installer logic only reads `source`; extra custom fields are ignored.

## 5) Type Examples

### 5.1 Agent

```text
agents/code-review-agent/
  asset.json
  AGENT.md
```

```json
{
  "name": "code-review-agent",
  "type": "agent",
  "description": "Code review assistant",
  "tools": ["claude", "codex"],
  "files": [
    { "source": "AGENT.md" }
  ]
}
```

### 5.2 Skill

```text
skills/commit-helper/
  asset.json
  SKILL.md
  references/
    conventional-commits.md
```

```json
{
  "name": "commit-helper",
  "type": "skill",
  "description": "Generate commit messages with Conventional Commits",
  "files": [
    { "source": "SKILL.md" },
    { "source": "references/conventional-commits.md" }
  ]
}
```

### 5.3 MCP

```text
mcp/my-mcp-server/
  asset.json
  mcp.json
```

```json
{
  "name": "my-mcp-server",
  "type": "mcp",
  "description": "Example MCP server",
  "tools": ["claude", "codex"],
  "files": [
    { "source": "mcp.json" }
  ]
}
```

```json
{
  "mcpServers": {
    "my-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@example/mcp-server"]
    }
  }
}
```

MCP notes:

- MCP assets must provide exactly one usable JSON config file (recommended: `mcp.json`).
- For Codex, `sse` servers are not supported; use `stdio` or `http`.

### 5.4 Prompt

```text
prompts/review-summary/
  asset.json
  summary.md
```

```json
{
  "name": "review-summary",
  "type": "prompt",
  "description": "Prompt template for review summary",
  "tools": ["claude", "codex"],
  "files": [
    { "source": "summary.md" }
  ]
}
```

## 6) Add Preset Templates (`presets`)

Presets let you bundle multiple assets into a reusable install set so `oag preset` can reconcile a project to the exact target state in one run.

### 6.1 Directory and File Location

- Create a `presets/` directory at the registry root (if missing).
- Each `presets/*.json` file represents one preset template.
- Preset files belong to the registry repository, not the consumer project.

### 6.2 `preset` JSON Rules

| Field | Required | Description |
| --- | --- | --- |
| `name` | Yes | Preset name; must be unique within the registry. |
| `description` | No | Optional preset description. |
| `tools` | Yes | Object; key is tool name (for example `codex`, `claude`), value is an array of asset IDs. |

Important rules:

- Asset IDs must use `type/name` format (for example `skill/commit`).
- `tools` must define at least one tool.
- `tools.<tool>` must be an array of strings; empty strings and invalid IDs are rejected.

Minimal template:

```json
{
  "name": "my-starter",
  "description": "Starter bundle",
  "tools": {
    "codex": ["agent/my-agent"],
    "claude": ["agent/my-agent"]
  }
}
```

### 6.3 Example (Using Real Assets)

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

### 6.4 Strict Validation and Failure Behavior

- `oag preset` validates preset entries strictly:
  - asset not found;
  - asset incompatible with selected tool;
  - missing target path mapping for the asset type on that tool.
- If any item is invalid, the command fails and does not partially apply changes.
- Validate asset visibility first with `oag list --tool <tool>`, then maintain `presets/*.json`.

### 6.5 Maintainer Validation Steps

```bash
# List presets
oag list-presets --tool codex
oag list-presets --tool claude

# Apply preset (validate per tool)
oag preset --name oag-starter --tool codex --mode copy
oag preset --name oag-starter --tool claude --mode copy
```

## 7) Publish and Validate (Maintainer Workflow)

### 7.1 Publish from your registry repository

```bash
git add .
git commit -m "feat: add skill/commit-helper"
git push origin <branch>
```

### 7.2 Validate from a consumer project

```bash
# Configure remote on first use
oag remote add <your-registry-git-url> <branch>

# Validate discoverability
oag list --tool claude
oag list --tool codex
oag list-presets --tool claude
oag list-presets --tool codex

# Validate install and update
oag install --tool claude --mode copy
oag preset --name oag-starter --tool claude --mode copy
oag update --tool claude
```

Validation checklist:

- New assets appear in `oag list`.
- `install` writes files to expected target paths.
- `update` refreshes previously installed assets after new releases.

## 8) Common Errors and Fixes

1. `Invalid JSON in asset: .../asset.json`
   - Check JSON syntax (commas, quotes, brackets).
2. `Source file not found: ...`
   - Ensure every `files[].source` points to an existing file.
3. `MCP asset '...' has no JSON config file`
   - Add `mcp.json` and include it in `files`.
4. `MCP asset '...' has multiple JSON files`
   - Keep exactly one JSON config file (recommended: `mcp.json`).
5. `Codex does not support MCP server type "sse"`
   - Replace `sse` with `stdio` or `http`.
6. `Preset '<name>' not found`
   - Check that the preset file exists under `presets/*.json` and `name` matches.
7. `Preset '<name>' does not define assets for tool '<tool>'`
   - Add that tool key (for example `codex` or `claude`) under `tools`.
8. `Invalid preset: ... (invalid asset ID '...', expected type/name)`
   - Fix asset IDs to `type/name` format (for example `skill/commit`).
9. `Preset '<name>' has invalid assets for tool '<tool>'`
   - Resolve each item reported: missing asset, tool mismatch, or missing path mapping.

## 9) Maintenance Recommendations

- Manage releases with semantic version tags or stable release branches.
- In PRs, include asset IDs, target tools, and validation command outputs.
- For `mcp` assets, validate in a test consumer project before broad rollout.
