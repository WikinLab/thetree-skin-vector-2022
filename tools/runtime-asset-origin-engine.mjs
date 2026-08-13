import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readGitBlobs } from './shared/git-blobs.mjs';

function fail(message) {
  throw new Error(message);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function repositoryByName(lock, name) {
  const repository = lock.repositories?.find((entry) => entry.name === name);
  if (!repository) fail(`UPSTREAM-LOCK is missing repository ${name}.`);
  return repository;
}

function sourceBlobs(root, lock, entries) {
  const groups = new Map();
  for (const entry of entries) {
    const repository = repositoryByName(lock, entry.repository);
    const group = groups.get(repository.name) || { repository, entries: [] };
    group.entries.push(entry);
    groups.set(repository.name, group);
  }

  const result = new Map();
  for (const { repository, entries: repositoryEntries } of groups.values()) {
    const checkout = path.join(root, '.upstream', repository.name);
    const specs = repositoryEntries.map((entry) => `${repository.commit}:${entry.upstreamPath}`);
    let blobs;
    try {
      blobs = readGitBlobs(checkout, specs);
    } catch (error) {
      fail(`Runtime asset source batch failed for ${repository.name}: ${error.message}`);
    }
    repositoryEntries.forEach((entry, index) => result.set(entry.path, blobs.get(specs[index])));
  }
  return result;
}

export function materializeRuntimeAssets({ root, entries, lock, check = false }) {
  if (!Array.isArray(entries) || entries.length === 0) {
    fail('The generation graph has no materialized runtime asset entries.');
  }

  const outputs = [];
  const lockedBlobs = sourceBlobs(root, lock, entries);
  for (const entry of entries) {
    if (!entry.path || !entry.repository || !entry.upstreamPath || !/^[0-9a-f]{64}$/.test(entry.sha256 || '')) {
      fail(`Invalid materialized runtime asset entry: ${JSON.stringify(entry)}`);
    }

    const sourceBuffer = lockedBlobs.get(entry.path);
    const sourceHash = sha256(sourceBuffer);
    if (sourceHash !== entry.sha256) {
      fail(`Locked runtime asset hash mismatch for ${entry.path}: expected ${entry.sha256}, got ${sourceHash}.`);
    }

    const destination = path.join(root, entry.path);
    if (check) {
      if (!fs.existsSync(destination) || !fs.statSync(destination).isFile()) {
        fail(`Materialized runtime asset is missing: ${entry.path}`);
      }
      const outputBuffer = fs.readFileSync(destination);
      const outputHash = sha256(outputBuffer);
      if (outputHash !== entry.sha256 || !outputBuffer.equals(sourceBuffer)) {
        fail(`Materialized runtime asset is stale: ${entry.path}`);
      }
    } else {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, sourceBuffer);
    }
    outputs.push(entry.path.replaceAll('\\', '/'));
  }

  console.log(`${check ? 'Checked' : 'Materialized'} ${outputs.length} locked runtime assets.`);
  return { outputs };
}
