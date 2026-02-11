'use strict';

const fs = require('fs/promises');
const path = require('path');
const { ensureDir, pathExists } = require('./fs');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  // State is stored as JSON; keep snapshots JSON-serializable and detached.
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeMcpServersShape(parsed) {
  if (!isPlainObject(parsed)) {
    throw new Error('Invalid MCP config: expected a JSON object.');
  }

  if (isPlainObject(parsed.mcpServers)) {
    return { root: parsed, servers: parsed.mcpServers };
  }

  // Heuristic: if top-level looks like a server map (values are objects), treat it as shorthand.
  const values = Object.values(parsed);
  const looksLikeServerMap = values.length > 0 && values.every((v) => isPlainObject(v));
  if (looksLikeServerMap) {
    return { root: { mcpServers: parsed }, servers: parsed };
  }

  // Otherwise preserve existing fields and add mcpServers.
  return { root: { ...parsed, mcpServers: {} }, servers: {} };
}

async function readJsonFileIfExists(filePath) {
  if (!(await pathExists(filePath))) {
    return null;
  }

  const raw = await fs.readFile(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON: ${filePath}`);
  }
}

async function writeJsonFile(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function resolveToolConfigPath(projectRoot, toolConfig) {
  const mapping = toolConfig && toolConfig.paths ? toolConfig.paths.mcp : null;
  if (!mapping || typeof mapping !== 'string') {
    throw new Error('Missing path mapping for type \'mcp\'');
  }

  const normalized = mapping.replace(/[\\/]+$/, '');
  return path.join(projectRoot, normalized);
}

function pickMcpConfigSourceFile(asset) {
  const files = Array.isArray(asset.files) ? asset.files : [];
  const candidates = files
    .map((f) => (f && typeof f.source === 'string' ? f.source : null))
    .filter((p) => p && p.endsWith('.json') && path.basename(p) !== 'asset.json');

  const preferred = candidates.find((p) => path.basename(p) === 'mcp.json')
    || candidates.find((p) => path.basename(p) === '.mcp.json');

  if (preferred) {
    return path.join(asset.dir, preferred);
  }

  if (candidates.length === 1) {
    return path.join(asset.dir, candidates[0]);
  }

  if (candidates.length === 0) {
    throw new Error(`MCP asset '${asset.id}' has no JSON config file (expected e.g. mcp.json).`);
  }

  throw new Error(
    `MCP asset '${asset.id}' has multiple JSON files; include exactly one (recommended: mcp.json).`
  );
}

async function loadAssetMcpServers(asset) {
  const filePath = pickMcpConfigSourceFile(asset);
  if (!(await pathExists(filePath))) {
    throw new Error(`Source file not found: ${filePath}`);
  }

  const parsed = await readJsonFileIfExists(filePath);
  if (!parsed) {
    throw new Error(`Empty MCP config: ${filePath}`);
  }

  const { servers } = normalizeMcpServersShape(parsed);
  if (!isPlainObject(servers)) {
    throw new Error(`Invalid MCP config: ${filePath} (mcpServers must be an object).`);
  }

  return servers;
}

function requireToml() {
  try {
    // eslint-disable-next-line global-require
    return require('@iarna/toml');
  } catch (error) {
    throw new Error(
      'TOML support not installed. Please add dependency @iarna/toml.'
    );
  }
}

function extractEnvVarRef(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.match(/^\$\{([A-Z0-9_]+)\}$/);
  return match ? match[1] : null;
}

function extractBearerEnvVar(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.match(/^Bearer\s+\$\{([A-Z0-9_]+)\}$/);
  return match ? match[1] : null;
}

function claudeServerToCodex(server) {
  if (!isPlainObject(server)) {
    throw new Error('Invalid MCP server: expected an object.');
  }

  const type = server.type;
  if (type === 'stdio') {
    if (typeof server.command !== 'string' || !server.command.trim()) {
      throw new Error('Invalid stdio server: missing command.');
    }

    const out = { command: server.command };

    if (Array.isArray(server.args)) {
      out.args = server.args.map((v) => String(v));
    }

    if (isPlainObject(server.env)) {
      const envVars = [];
      for (const value of Object.values(server.env)) {
        const ref = extractEnvVarRef(value);
        if (ref) {
          envVars.push(ref);
        }
      }
      if (envVars.length > 0) {
        out.env_vars = Array.from(new Set(envVars)).sort();
      }
    }

    return out;
  }

  if (type === 'http') {
    if (typeof server.url !== 'string' || !server.url.trim()) {
      throw new Error('Invalid http server: missing url.');
    }

    const out = { url: server.url };

    const staticHeaders = {};
    const envHeaders = {};
    let bearerTokenEnvVar = null;

    if (isPlainObject(server.headers)) {
      for (const [header, value] of Object.entries(server.headers)) {
        if (header.toLowerCase() === 'authorization') {
          const bearer = extractBearerEnvVar(value);
          if (bearer) {
            bearerTokenEnvVar = bearer;
            continue;
          }
        }

        const envRef = extractEnvVarRef(value);
        if (envRef) {
          envHeaders[header] = envRef;
          continue;
        }

        staticHeaders[header] = String(value);
      }
    }

    if (Object.keys(staticHeaders).length > 0) {
      out.http_headers = staticHeaders;
    }
    if (Object.keys(envHeaders).length > 0) {
      out.env_http_headers = envHeaders;
    }
    if (bearerTokenEnvVar) {
      out.bearer_token_env_var = bearerTokenEnvVar;
    }

    return out;
  }

  if (type === 'sse') {
    throw new Error('Codex does not support MCP server type "sse".');
  }

  throw new Error(`Unsupported MCP server type '${String(type)}'.`);
}

async function installMcp(asset, projectRoot, tool, toolConfig) {
  const configPath = resolveToolConfigPath(projectRoot, toolConfig);
  const servers = await loadAssetMcpServers(asset);

  if (tool === 'claude') {
    const existing = await readJsonFileIfExists(configPath);
    const { root, servers: serverMap } = normalizeMcpServersShape(existing || { mcpServers: {} });

    const mcpState = {
      format: 'claude_json',
      configPath,
      servers: {},
    };

    for (const [name, cfg] of Object.entries(servers)) {
      const had = Object.prototype.hasOwnProperty.call(serverMap, name);
      const previous = had ? cloneJson(serverMap[name]) : null;
      serverMap[name] = cfg;
      mcpState.servers[name] = {
        action: had ? 'replaced' : 'added',
        previous,
        installed: cloneJson(cfg),
      };
    }

    root.mcpServers = serverMap;
    await writeJsonFile(configPath, root);
    return { targets: [configPath], mcpState };
  }

  if (tool === 'codex') {
    const toml = requireToml();
    let config = {};
    if (await pathExists(configPath)) {
      const raw = await fs.readFile(configPath, 'utf8');
      try {
        config = toml.parse(raw);
      } catch (error) {
        throw new Error(`Invalid TOML: ${configPath}`);
      }
      if (!isPlainObject(config)) {
        throw new Error(`Invalid TOML root (expected table): ${configPath}`);
      }
    }

    if (config.mcp_servers === undefined) {
      config.mcp_servers = {};
    }
    if (!isPlainObject(config.mcp_servers)) {
      throw new Error(`Invalid TOML: mcp_servers must be a table (${configPath})`);
    }

    const mcpState = {
      format: 'codex_toml',
      configPath,
      servers: {},
    };

    for (const [name, cfg] of Object.entries(servers)) {
      const codexCfg = claudeServerToCodex(cfg);
      const had = Object.prototype.hasOwnProperty.call(config.mcp_servers, name);
      const previous = had ? cloneJson(config.mcp_servers[name]) : null;
      config.mcp_servers[name] = codexCfg;
      mcpState.servers[name] = {
        action: had ? 'replaced' : 'added',
        previous,
        installed: cloneJson(codexCfg),
      };
    }

    await ensureDir(path.dirname(configPath));
    await fs.writeFile(configPath, toml.stringify(config), 'utf8');
    return { targets: [configPath], mcpState };
  }

  throw new Error(`Unsupported tool '${tool}' for mcp install.`);
}

async function uninstallMcpByState(projectRoot, toolConfig, mcpState) {
  if (!mcpState || !mcpState.configPath || !mcpState.format || !mcpState.servers) {
    return;
  }

  const configPath = mcpState.configPath;
  const servers = mcpState.servers;

  if (mcpState.format === 'claude_json') {
    const existing = await readJsonFileIfExists(configPath);
    if (!existing) {
      return;
    }

    const { root, servers: serverMap } = normalizeMcpServersShape(existing);
    for (const [name, entry] of Object.entries(servers)) {
      if (!entry || !entry.action) {
        continue;
      }
      if (entry.action === 'added') {
        delete serverMap[name];
      } else if (entry.action === 'replaced') {
        if (entry.previous === null || entry.previous === undefined) {
          delete serverMap[name];
        } else {
          serverMap[name] = entry.previous;
        }
      }
    }
    root.mcpServers = serverMap;
    await writeJsonFile(configPath, root);
    return;
  }

  if (mcpState.format === 'codex_toml') {
    const toml = requireToml();
    if (!(await pathExists(configPath))) {
      return;
    }

    const raw = await fs.readFile(configPath, 'utf8');
    let config;
    try {
      config = toml.parse(raw);
    } catch (error) {
      throw new Error(`Invalid TOML: ${configPath}`);
    }

    if (!isPlainObject(config)) {
      return;
    }

    if (!isPlainObject(config.mcp_servers)) {
      return;
    }

    for (const [name, entry] of Object.entries(servers)) {
      if (!entry || !entry.action) {
        continue;
      }
      if (entry.action === 'added') {
        delete config.mcp_servers[name];
      } else if (entry.action === 'replaced') {
        if (entry.previous === null || entry.previous === undefined) {
          delete config.mcp_servers[name];
        } else {
          config.mcp_servers[name] = entry.previous;
        }
      }
    }

    await ensureDir(path.dirname(configPath));
    await fs.writeFile(configPath, toml.stringify(config), 'utf8');
    return;
  }
}

module.exports = {
  installMcp,
  uninstallMcpByState,
  // Exported for tests.
  claudeServerToCodex,
};

