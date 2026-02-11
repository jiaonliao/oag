#!/usr/bin/env node
'use strict';

const fs = require('fs/promises');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

const TYPE_DIRS = [
  { type: 'agent', dir: 'agents' },
  { type: 'skill', dir: 'skills' },
  { type: 'mcp', dir: 'mcp' },
];

const MARKDOWN_PREVIEW_EXTENSIONS = new Set(['.md']);
const TEXT_PREVIEW_EXTENSIONS = new Set(['.txt', '.json', '.yaml', '.yml']);
const CODE_LANGUAGE_BY_EXTENSION = new Map([
  ['.js', 'javascript'],
  ['.mjs', 'javascript'],
  ['.cjs', 'javascript'],
  ['.jsx', 'javascript'],
  ['.ts', 'typescript'],
  ['.tsx', 'typescript'],
  ['.py', 'python'],
  ['.sh', 'bash'],
  ['.bash', 'bash'],
  ['.zsh', 'bash'],
]);
const PREVIEWABLE_EXTENSIONS = new Set([
  ...MARKDOWN_PREVIEW_EXTENSIONS,
  ...TEXT_PREVIEW_EXTENSIONS,
  ...CODE_LANGUAGE_BY_EXTENSION.keys(),
]);
const MAX_PREVIEW_LINES = 120;

async function main() {
  const items = [];

  for (const { type, dir } of TYPE_DIRS) {
    const typeRoot = path.join(REPO_ROOT, dir);
    if (!(await exists(typeRoot))) {
      continue;
    }

    const entries = await fs.readdir(typeRoot, { withFileTypes: true });
    const sorted = entries.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of sorted) {
      const asset = await loadAsset({ type, typeRoot, dirName: entry.name });
      if (asset) {
        items.push(asset);
      }
    }
  }

  items.sort((a, b) => {
    const typeOrder = orderOfType(a.type) - orderOfType(b.type);
    if (typeOrder !== 0) {
      return typeOrder;
    }
    return a.name.localeCompare(b.name);
  });

  const counts = {
    total: items.length,
    agent: items.filter((item) => item.type === 'agent').length,
    skill: items.filter((item) => item.type === 'skill').length,
    mcp: items.filter((item) => item.type === 'mcp').length,
  };

  const payload = {
    generatedAt: new Date().toISOString(),
    counts,
    items,
  };

  const outputDir = path.join(REPO_ROOT, 'public', 'data');
  const outputPath = path.join(outputDir, 'assets.json');

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(`Generated ${path.relative(REPO_ROOT, outputPath)} with ${items.length} assets.`);
}

async function loadAsset({ type, typeRoot, dirName }) {
  const assetDir = path.join(typeRoot, dirName);
  const manifestPath = path.join(assetDir, 'asset.json');

  if (!(await exists(manifestPath))) {
    return null;
  }

  const manifest = await readManifest(manifestPath);
  if (!manifest) {
    return null;
  }

  const normalizedType = normalizeType(manifest.type, type);
  const normalizedName = normalizeString(manifest.name, dirName);
  const normalizedDescription = normalizeString(manifest.description, '');
  const normalizedTools = normalizeTools(manifest.tools);
  const normalizedFiles = await normalizeFiles({ assetDir, files: manifest.files });

  return {
    id: `${normalizedType}/${normalizedName}`,
    name: normalizedName,
    type: normalizedType,
    description: normalizedDescription,
    tools: normalizedTools,
    dir: normalizePath(path.relative(REPO_ROOT, assetDir)),
    files: normalizedFiles,
  };
}

function normalizeType(rawType, fallbackType) {
  const value = normalizeString(rawType, fallbackType).toLowerCase();
  return value || fallbackType;
}

function normalizeString(rawValue, fallbackValue) {
  if (typeof rawValue !== 'string') {
    return fallbackValue;
  }

  const trimmed = rawValue.trim();
  return trimmed || fallbackValue;
}

function normalizeTools(rawTools) {
  if (!Array.isArray(rawTools)) {
    return [];
  }

  return rawTools
    .filter((tool) => typeof tool === 'string' && tool.trim())
    .map((tool) => tool.trim());
}

async function normalizeFiles({ assetDir, files }) {
  if (!Array.isArray(files)) {
    return [];
  }

  const normalized = [];

  for (const file of files) {
    const source = file && typeof file.source === 'string' ? file.source.trim() : '';
    if (!source) {
      continue;
    }

    const entry = {
      source,
    };

    const absolutePath = path.resolve(assetDir, source);
    if (!isPathInside(absolutePath, assetDir)) {
      entry.previewError = 'file points outside asset directory';
      normalized.push(entry);
      continue;
    }

    if (!(await exists(absolutePath))) {
      entry.previewError = 'file not found';
      normalized.push(entry);
      continue;
    }

    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      entry.previewError = 'path is not a file';
      normalized.push(entry);
      continue;
    }

    const extension = path.extname(source).toLowerCase();
    const previewDescriptor = resolvePreviewFormat(extension);
    if (!previewDescriptor) {
      entry.previewError = 'preview unavailable for this file type';
      normalized.push(entry);
      continue;
    }

    const preview = await readPreview(absolutePath);
    entry.format = previewDescriptor.format;
    if (previewDescriptor.language) {
      entry.language = previewDescriptor.language;
    }

    if (preview.error) {
      entry.previewError = preview.error;
    } else {
      entry.preview = preview.content;
      entry.truncated = preview.truncated;
    }

    normalized.push(entry);
  }

  return normalized;
}

function resolvePreviewFormat(extension) {
  if (!PREVIEWABLE_EXTENSIONS.has(extension)) {
    return null;
  }

  if (MARKDOWN_PREVIEW_EXTENSIONS.has(extension)) {
    return { format: 'markdown', language: '' };
  }

  if (TEXT_PREVIEW_EXTENSIONS.has(extension)) {
    return { format: 'text', language: '' };
  }

  const language = CODE_LANGUAGE_BY_EXTENSION.get(extension);
  if (language) {
    return { format: 'code', language };
  }

  return { format: 'text', language: '' };
}

async function readPreview(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const lines = raw.split(/\r?\n/);
    const truncated = lines.length > MAX_PREVIEW_LINES;
    const selected = truncated ? lines.slice(0, MAX_PREVIEW_LINES) : lines;
    return {
      content: selected.join('\n'),
      truncated,
      error: null,
    };
  } catch (error) {
    return {
      content: '',
      truncated: false,
      error: `failed to read preview: ${error.message}`,
    };
  }
}

async function readManifest(manifestPath) {
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    const normalizedPath = normalizePath(path.relative(REPO_ROOT, manifestPath));
    console.warn(`Skipping invalid manifest ${normalizedPath}: ${error.message}`);
    return null;
  }
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function orderOfType(type) {
  const index = TYPE_DIRS.findIndex((entry) => entry.type === type);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function normalizePath(rawPath) {
  return rawPath.split(path.sep).join('/');
}

function isPathInside(targetPath, parentPath) {
  const relative = path.relative(parentPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
