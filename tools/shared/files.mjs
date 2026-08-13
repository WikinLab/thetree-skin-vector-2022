import fs from 'node:fs';
import path from 'node:path';

import { compareCodePoints } from './deterministic.mjs';

function collectFiles(directory, files) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) collectFiles(target, files);
    else if (entry.isFile()) files.push(target);
  }
}

export function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  collectFiles(directory, files);
  return files.sort(compareCodePoints);
}
