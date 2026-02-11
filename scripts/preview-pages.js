#!/usr/bin/env node
'use strict';

const fs = require('fs/promises');
const path = require('path');
const http = require('http');
const { createReadStream } = require('fs');
const { spawn } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');
const PAGES_DIR = path.join(REPO_ROOT, 'pages');
const BUILD_SCRIPT = path.join(REPO_ROOT, 'scripts', 'build-pages-data.js');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

async function main() {
  const port = parsePort(process.argv.slice(2), process.env.PORT);

  await runBuildScript();
  await copyPagesToPublic();

  const server = http.createServer((request, response) => {
    serveRequest(request, response).catch((error) => {
      console.error(error);
      if (!response.headersSent) {
        response.statusCode = 500;
        response.setHeader('content-type', 'text/plain; charset=utf-8');
      }
      response.end('Internal Server Error');
    });
  });

  server.on('error', (error) => {
    console.error(`Failed to start preview server: ${error.message}`);
    process.exitCode = 1;
  });

  server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    console.log(`Asset preview is ready at http://127.0.0.1:${actualPort}`);
    console.log('Press Ctrl+C to stop.');
  });

  process.on('SIGINT', () => {
    server.close(() => {
      process.exit(0);
    });
  });
}

function parsePort(argv, envPort) {
  const argPort = argv.find((arg) => arg.startsWith('--port='));
  const explicit = argPort ? argPort.slice('--port='.length) : envPort;
  const fallback = 4173;

  if (!explicit) {
    return fallback;
  }

  const parsed = Number.parseInt(explicit, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid port: ${explicit}`);
  }

  return parsed;
}

async function runBuildScript() {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BUILD_SCRIPT], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`build-pages-data exited with code ${code}`));
    });
  });
}

async function copyPagesToPublic() {
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  await fs.cp(PAGES_DIR, PUBLIC_DIR, { recursive: true, force: true });
}

async function serveRequest(request, response) {
  const rawPath = request.url || '/';
  const pathname = decodeURIComponent(rawPath.split('?')[0]);

  let relativePath = pathname;
  if (relativePath.endsWith('/')) {
    relativePath += 'index.html';
  }

  if (relativePath === '') {
    relativePath = '/index.html';
  }

  const normalizedPath = path.normalize(relativePath).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, normalizedPath.replace(/^[/\\]+/, ''));

  if (!isPathInside(filePath, PUBLIC_DIR)) {
    response.statusCode = 403;
    response.end('Forbidden');
    return;
  }

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    response.statusCode = 404;
    response.setHeader('content-type', 'text/plain; charset=utf-8');
    response.end('Not Found');
    return;
  }

  if (stat.isDirectory()) {
    const indexPath = path.join(filePath, 'index.html');
    await streamFile(indexPath, response);
    return;
  }

  await streamFile(filePath, response);
}

function isPathInside(targetPath, parentPath) {
  const relative = path.relative(parentPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function streamFile(filePath, response) {
  const extension = path.extname(filePath).toLowerCase();
  response.statusCode = 200;
  response.setHeader('content-type', MIME_TYPES[extension] || 'application/octet-stream');

  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(response);
  }).catch(() => {
    response.statusCode = 404;
    response.setHeader('content-type', 'text/plain; charset=utf-8');
    response.end('Not Found');
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
