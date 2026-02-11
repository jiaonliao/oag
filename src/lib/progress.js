'use strict';

const FRAMES = ['|', '/', '-', '\\'];
const FRAME_INTERVAL_MS = 100;

function renderLine(line) {
  const width = process.stderr.columns || 80;
  const padded = line.length < width ? line + ' '.repeat(width - line.length) : line;
  process.stderr.write(`\r${padded}\n`);
}

async function withSpinner(message, fn) {
  if (!process.stderr.isTTY) {
    process.stderr.write(`${message}\n`);
    try {
      const result = await fn();
      process.stderr.write('done\n');
      return result;
    } catch (error) {
      process.stderr.write('failed\n');
      throw error;
    }
  }

  let frameIndex = 0;
  const renderFrame = () => {
    const frame = FRAMES[frameIndex % FRAMES.length];
    frameIndex += 1;
    process.stderr.write(`\r${frame} ${message}`);
  };

  renderFrame();
  const timer = setInterval(renderFrame, FRAME_INTERVAL_MS);

  try {
    const result = await fn();
    clearInterval(timer);
    renderLine(`${message}... done`);
    return result;
  } catch (error) {
    clearInterval(timer);
    renderLine(`${message}... failed`);
    throw error;
  }
}

module.exports = {
  withSpinner,
};
