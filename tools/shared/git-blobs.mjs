import { spawnSync } from 'node:child_process';
import process from 'node:process';

const gitExecutable = process.platform === 'win32' ? 'git.exe' : 'git';

function readLine(buffer, offset) {
  const end = buffer.indexOf(0x0a, offset);
  if (end === -1) throw new Error('git cat-file --batch returned an incomplete header.');
  return { value: buffer.subarray(offset, end).toString('utf8'), nextOffset: end + 1 };
}

export function readGitBlobs(checkout, objectSpecs) {
  const specs = [...new Set(objectSpecs.map(String))];
  if (specs.length === 0) return new Map();

  const result = spawnSync(gitExecutable, ['-C', checkout, 'cat-file', '--batch'], {
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1' },
    input: `${specs.join('\n')}\n`,
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Unable to read locked Git objects from ${checkout}:\n${String(result.stderr || result.stdout).trim()}`);
  }

  const output = result.stdout || Buffer.alloc(0);
  const blobs = new Map();
  let offset = 0;
  for (const spec of specs) {
    const header = readLine(output, offset);
    offset = header.nextOffset;
    if (header.value.endsWith(' missing')) {
      throw new Error(`Locked Git object is missing: ${spec}`);
    }
    const match = /^([0-9a-f]+) blob (\d+)$/.exec(header.value);
    if (!match) throw new Error(`Expected a blob for ${spec}, received: ${header.value}`);
    const size = Number(match[2]);
    const end = offset + size;
    if (end >= output.length || output[end] !== 0x0a) {
      throw new Error(`git cat-file --batch returned incomplete data for ${spec}.`);
    }
    blobs.set(spec, Buffer.from(output.subarray(offset, end)));
    offset = end + 1;
  }
  return blobs;
}
