#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFirstPhpArrayAfter } from './php-array-literal.mjs';
import { resolveResourceLoaderOriginContract } from './resource-loader-contract.mjs';

let listResourceLoaderLessImportCandidates;
let parseResourceLoaderLessImports;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = path.join(root, 'UPSTREAM-LOCK.json');
const manifestPath = path.join(root, 'ORIGIN-MANIFEST.json');
const upstreamRoot = path.join(root, '.upstream');
const vendorRoot = path.join(root, 'vendor');
const buildToolRoot = path.join(root, '.build-tools');
const bootstrapStatePath = path.join(buildToolRoot, 'bootstrap-state.json');
const gitExecutable = process.platform === 'win32' ? 'git.exe' : 'git';
const checkoutConcurrency = 3;
const repositoryBlobCache = new Map();
let forceClean = false;

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stderr || result.stdout || ''}` : '';
    fail(`${command} ${args.join(' ')} failed with status ${result.status}.${detail}`);
  }
  return options.capture ? String(result.stdout || '').trim() : '';
}

function runAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const capture = options.capture === true;
    const child = spawn(command, args, {
      cwd: options.cwd || root,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      env: { ...process.env, ...(options.env || {}) },
      windowsHide: true
    });
    const stdout = [];
    const stderr = [];
    if (capture) {
      child.stdout.on('data', (chunk) => stdout.push(chunk));
      child.stderr.on('data', (chunk) => stderr.push(chunk));
    }
    child.on('error', reject);
    child.on('close', (status) => {
      const output = Buffer.concat(stdout).toString('utf8').trim();
      if (status === 0) {
        resolve(output);
        return;
      }
      const detail = capture
        ? `\n${Buffer.concat(stderr).toString('utf8') || output}`
        : '';
      reject(new Error(`${command} ${args.join(' ')} failed with status ${status}.${detail}`));
    });
  });
}

function resolveNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(path.dirname(process.execPath)), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

const npmCli = resolveNpmCli();

async function loadInstalledGenerationTools() {
  const lessTools = await import('./resource-loader-less.mjs');
  listResourceLoaderLessImportCandidates = lessTools.listResourceLoaderLessImportCandidates;
  parseResourceLoaderLessImports = lessTools.parseResourceLoaderLessImports;
}

function runNpm(args, options = {}) {
  if (npmCli) return run(process.execPath, [npmCli, ...args], options);
  if (process.platform === 'win32') {
    return run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm', ...args], options);
  }
  return run('npm', args, options);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function ensureCommand(command, versionArgs = ['--version']) {
  run(command, versionArgs, { capture: true });
}

function parseArgs(argv) {
  const parsed = {
    refresh: false,
    release: null,
    clean: false,
    verify: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--refresh') parsed.refresh = true;
    else if (arg === '--clean') parsed.clean = true;
    else if (arg === '--verify') parsed.verify = true;
    else if (arg === '--release') {
      parsed.release = argv[index + 1] || '';
      index += 1;
    } else if (arg.startsWith('--release=')) parsed.release = arg.slice('--release='.length);
    else fail(`Unknown bootstrap option: ${arg}`);
  }
  if (parsed.refresh && parsed.release) fail('--refresh and --release cannot be used together.');
  if (parsed.release && !/^\d+\.\d+$/.test(parsed.release)) fail('--release must use a major.minor value such as 1.46.');
  return parsed;
}

function releaseRef(version) {
  return `REL${version.replace('.', '_')}`;
}

function repositoryUrl(repository) {
  return `https://github.com/${repository}.git`;
}

function repositoryByName(lock, name) {
  const repository = lock.repositories?.find((entry) => entry.name === name);
  if (!repository) fail(`UPSTREAM-LOCK is missing repository ${name}.`);
  return repository;
}

function repositoryCheckout(name) {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) fail(`Invalid checkout directory name: ${name}.`);
  return path.join(upstreamRoot, name);
}

function hostRepositories(manifest) {
  const lock = manifest.hostLock;
  if (lock?.schema !== 2) fail(`Unsupported or missing hostLock schema: ${lock?.schema ?? 'none'}`);
  const entries = [
    ['frontend', lock.frontend],
    ['backend', lock.backend]
  ].map(([label, entry]) => {
    if (!entry?.repository || !entry?.ref || !entry?.commit || !entry?.checkout) {
      fail(`hostLock ${label} repository declaration is incomplete.`);
    }
    return {
      name: entry.checkout,
      repository: entry.repository,
      ref: entry.ref,
      commit: entry.commit,
      bootstrapPaths: entry.bootstrapPaths || [],
      sparseCheckout: true,
      hostOnly: true
    };
  });
  const names = new Set();
  for (const entry of entries) {
    if (names.has(entry.name)) fail(`hostLock reuses checkout name ${entry.name}.`);
    names.add(entry.name);
  }
  return entries;
}

function allCheckoutRepositories(lock, manifest) {
  const entries = [...(lock.repositories || []), ...hostRepositories(manifest)];
  const names = new Set();
  for (const entry of entries) {
    if (names.has(entry.name)) fail(`Repository checkout name is declared more than once: ${entry.name}.`);
    names.add(entry.name);
  }
  return entries;
}

function lsRemote(repository, ref) {
  const output = run(gitExecutable, ['ls-remote', repositoryUrl(repository), ref], { capture: true });
  const line = output.split(/\r?\n/).find(Boolean);
  if (!line) fail(`Remote ref not found: ${repository} ${ref}`);
  return line.split(/\s+/)[0];
}

function resolveTagCommit(repository, tag) {
  const output = run(gitExecutable, [
    'ls-remote', repositoryUrl(repository),
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`
  ], { capture: true });
  const lines = output.split(/\r?\n/).filter(Boolean);
  const peeled = lines.find((line) => line.endsWith(`refs/tags/${tag}^{}`));
  const direct = lines.find((line) => line.endsWith(`refs/tags/${tag}`));
  const line = peeled || direct;
  if (!line) fail(`Tag not found: ${repository} ${tag}`);
  return line.split(/\s+/)[0];
}

function copyFile(source, destination) {
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) fail(`Bootstrap source file is missing: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function writeBuffer(destination, buffer) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, buffer);
}

function requiredSparsePaths(manifest, repository) {
  const paths = new Set(repository.bootstrapPaths || []);
  const lessClosure = manifest.sourceInventory?.vendorLessClosure;
  let hasLessSeed = false;
  for (const inventoryName of ['vendorFiles', 'materializedRuntimeAssets']) {
    for (const entry of manifest.sourceInventory?.[inventoryName] || []) {
      if (entry.repository !== repository.name || !entry.upstreamPath) continue;
      paths.add(entry.upstreamPath);
      if (Number(lessClosure?.schema) >= 1 && entry.path?.endsWith('.less')) {
        hasLessSeed = true;
        const directory = path.posix.dirname(entry.upstreamPath.replaceAll('\\', '/'));
        if (directory !== '.') paths.add(`${directory}/**`);
      }
    }
  }
  if (hasLessSeed) {
    for (const pattern of lessClosure?.repositoryDiscoveryPatterns || []) paths.add(pattern);
  }
  if (repository.licenseFile && !repository.licenseFile.includes(':')) paths.add(repository.licenseFile);
  return [...paths].sort();
}

async function mapConcurrent(values, concurrency, worker) {
  if (!Number.isInteger(concurrency) || concurrency < 1) fail(`Invalid concurrency: ${concurrency}.`);
  let nextIndex = 0;
  const results = new Array(values.length);
  async function consume() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, consume));
  return results;
}

async function commandSucceeds(command, args, options = {}) {
  try {
    await runAsync(command, args, { ...options, capture: true });
    return true;
  } catch {
    return false;
  }
}

async function checkoutExactCommit(options) {
  const {
    checkout,
    url,
    commit,
    sparsePaths = [],
    sparseCheckout = true,
    label = path.basename(checkout),
    preservePaths = []
  } = options;
  if (!/^[0-9a-f]{40}$/.test(commit)) fail(`Invalid locked commit for ${label}: ${commit}.`);

  const gitDirectory = path.join(checkout, '.git');
  if (fs.existsSync(checkout) && !fs.existsSync(gitDirectory)) {
    fs.rmSync(checkout, { recursive: true, force: true });
  }
  if (fs.existsSync(checkout)) {
    let currentRemote = null;
    try {
      currentRemote = await runAsync(gitExecutable, ['-C', checkout, 'remote', 'get-url', 'origin'], { capture: true });
    } catch {
      // A corrupt managed checkout is recreated from its locked input.
    }
    if (currentRemote !== url) fs.rmSync(checkout, { recursive: true, force: true });
  }

  if (!fs.existsSync(checkout)) {
    fs.mkdirSync(checkout, { recursive: true });
    await runAsync(gitExecutable, ['-C', checkout, 'init', '--quiet'], { capture: true });
    await runAsync(gitExecutable, ['-C', checkout, 'remote', 'add', 'origin', url], { capture: true });
  }

  // Upstream source bytes must not depend on the caller's global Windows Git settings.
  await runAsync(gitExecutable, ['-C', checkout, 'config', 'core.autocrlf', 'false'], { capture: true });
  await runAsync(gitExecutable, ['-C', checkout, 'config', 'core.eol', 'lf'], { capture: true });
  // Composer nesting plus upstream filenames can exceed the legacy Win32 MAX_PATH limit.
  // Keep managed checkouts independent of the machine's global Git configuration.
  await runAsync(gitExecutable, ['-C', checkout, 'config', 'core.longpaths', 'true'], { capture: true });
  await runAsync(gitExecutable, ['-C', checkout, 'config', 'remote.origin.promisor', 'true'], { capture: true });
  await runAsync(gitExecutable, ['-C', checkout, 'config', 'remote.origin.partialclonefilter', 'blob:none'], { capture: true });

  if (sparseCheckout === false) {
    await commandSucceeds(gitExecutable, ['-C', checkout, 'sparse-checkout', 'disable']);
  } else {
    await runAsync(gitExecutable, ['-C', checkout, 'sparse-checkout', 'init', '--no-cone'], { capture: true });
    if (sparsePaths.length) {
      await runAsync(gitExecutable, ['-C', checkout, 'sparse-checkout', 'set', '--no-cone', ...sparsePaths], { capture: true });
    }
  }

  const hasCommit = await commandSucceeds(
    gitExecutable,
    ['-C', checkout, 'cat-file', '-e', `${commit}^{commit}`],
    { env: { GIT_NO_LAZY_FETCH: '1' } }
  );
  if (!hasCommit) {
    try {
      await runAsync(gitExecutable, [
        '-C', checkout, 'fetch', '--quiet', '--depth', '1', '--no-tags',
        '--filter=blob:none', 'origin', commit
      ], { capture: true });
    } catch (error) {
      const detail = error instanceof Error ? `\n${error.message}` : '';
      throw new Error(`Unable to fetch locked commit for ${label} (${commit}).${detail}`);
    }
  }

  await runAsync(gitExecutable, ['-C', checkout, 'checkout', '--detach', '--force', commit], { capture: true });
  await runAsync(gitExecutable, ['-C', checkout, 'reset', '--hard', commit], { capture: true });
  const cleanArgs = ['-C', checkout, 'clean', '-ffdx'];
  if (!forceClean) {
    for (const preserved of preservePaths) cleanArgs.push('-e', normalizeProjectPath(preserved));
  }
  await runAsync(gitExecutable, cleanArgs, { capture: true });
  const head = await runAsync(gitExecutable, ['-C', checkout, 'rev-parse', 'HEAD'], { capture: true });
  if (head !== commit) fail(`Checkout mismatch for ${label}: expected ${commit}, got ${head}.`);
}

async function checkoutRepository(repository, manifest) {
  const startedAt = Date.now();
  console.log(`[checkout] ${repository.name}: ${repository.commit}`);
  await checkoutExactCommit({
    checkout: repositoryCheckout(repository.name),
    url: repositoryUrl(repository.repository),
    commit: repository.commit,
    sparsePaths: requiredSparsePaths(manifest, repository),
    sparseCheckout: repository.sparseCheckout !== false,
    label: repository.name,
    preservePaths: [
      'node_modules',
      '.thetree-bootstrap-build.json',
      ...(repository.build?.outputs || [])
    ]
  });
  console.log(`[checkout] ${repository.name}: ready in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

async function checkoutRepositories(lock, manifest) {
  const repositories = allCheckoutRepositories(lock, manifest);
  const startedAt = Date.now();
  await mapConcurrent(repositories, checkoutConcurrency, (repository) => checkoutRepository(repository, manifest));
  console.log(`[checkout] ${repositories.length} repositories ready in ${((Date.now() - startedAt) / 1000).toFixed(1)}s (max ${checkoutConcurrency} concurrent).`);
}

function readMediaWikiCodexVersions(lock) {
  const mediaWiki = repositoryByName(lock, 'mediawiki');
  const packagePath = path.join(repositoryCheckout(mediaWiki.name), 'package.json');
  const packageData = readJson(packagePath);
  const dependencies = packageData.devDependencies || {};
  const codex = dependencies['@wikimedia/codex'];
  const icons = dependencies['@wikimedia/codex-icons'];
  for (const [name, version] of Object.entries({ '@wikimedia/codex': codex, '@wikimedia/codex-icons': icons })) {
    if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
      fail(`Unable to resolve exact ${name} version from the locked MediaWiki core package.json.`);
    }
  }
  return { codex, icons };
}

function assertDesignCodexVersionAlignment(lock) {
  const expected = readMediaWikiCodexVersions(lock);
  if (expected.codex !== expected.icons) {
    fail(`MediaWiki core requires different Codex package versions (${expected.codex} and ${expected.icons}); one design-codex Git tag cannot represent both.`);
  }
  const checkout = repositoryCheckout('design-codex');
  const packageVersions = {
    '@wikimedia/codex': readJson(path.join(checkout, 'packages/codex/package.json')).version,
    '@wikimedia/codex-design-tokens': readJson(path.join(checkout, 'packages/codex-design-tokens/package.json')).version,
    '@wikimedia/codex-icons': readJson(path.join(checkout, 'packages/codex-icons/package.json')).version
  };
  for (const [name, version] of Object.entries(packageVersions)) {
    if (version !== expected.codex) {
      fail(`Locked design-codex checkout version mismatch for ${name}: expected ${expected.codex}, got ${version}.`);
    }
  }
  const repository = repositoryByName(lock, 'design-codex');
  const toolchain = repository.build?.toolchain;
  if (!toolchain?.source) fail('Locked design-codex repository is missing its build toolchain contract.');
  const toolchainPackagePath = path.join(
    assertRelativeProjectPath(toolchain.source, 'build toolchain source'),
    toolchain.packageFile || 'package.json'
  );
  const toolchainVersion = readJson(toolchainPackagePath).version;
  if (toolchainVersion !== expected.codex) {
    fail(`Design-codex build toolchain version mismatch: expected ${expected.codex}, got ${toolchainVersion || 'missing'}.`);
  }
}

async function resolveReleaseCandidate(baseLock, releaseVersion) {
  const candidate = structuredClone(baseLock);
  const ref = releaseRef(releaseVersion);
  candidate.snapshotDate = new Date().toISOString().slice(0, 10);
  candidate.mediaWikiRelease = releaseVersion;
  candidate.releaseLine = ref;
  candidate.policy = `MediaWiki core, Vector, and DarkMode use exact commits resolved from ${ref}; Codex styles, design tokens, mixins, and icon-path variables are built from the exact design-codex tag required by that MediaWiki core snapshot.`;

  for (const repository of candidate.repositories) {
    if (repository.name === 'design-codex') continue;
    repository.ref = ref;
    repository.commit = lsRemote(repository.repository, `refs/heads/${ref}`);
  }

  const manifest = readJson(manifestPath);
  await checkoutRepository(repositoryByName(candidate, 'mediawiki'), manifest);
  const versions = readMediaWikiCodexVersions(candidate);
  if (versions.codex !== versions.icons) {
    fail(`MediaWiki core resolves Codex ${versions.codex} but Codex Icons ${versions.icons}; one design-codex Git tag cannot represent both.`);
  }
  const codexRepository = repositoryByName(candidate, 'design-codex');
  codexRepository.ref = `v${versions.codex}`;
  codexRepository.commit = resolveTagCommit(codexRepository.repository, codexRepository.ref);
  return candidate;
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function bootstrapFingerprint(lock, manifest) {
  const declared = [
    'UPSTREAM-LOCK.json',
    'ORIGIN-MANIFEST.json',
    'package-lock.json',
    ...(manifest.sourceInventory?.localFiles || []).map((entry) => entry.path),
    ...(manifest.sourceInventory?.portedFiles || []).map((entry) => entry.path)
  ];
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(lock));
  for (const relative of [...new Set(declared)].sort()) {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    hash.update(`\0${normalizeProjectPath(relative)}\0`);
    hash.update(fs.readFileSync(absolute));
  }
  return hash.digest('hex');
}

function materializedStateComplete(manifest) {
  for (const inventoryName of ['vendorFiles', 'generatedFiles', 'materializedRuntimeAssets']) {
    for (const entry of manifest.sourceInventory?.[inventoryName] || []) {
      const relative = typeof entry === 'string' ? entry : entry.path;
      if (!relative || !fs.existsSync(path.join(root, relative))) return false;
    }
  }
  return true;
}

function tryFastBootstrap(lock, manifest, verify) {
  if (forceClean || !fs.existsSync(bootstrapStatePath) || !materializedStateComplete(manifest)) return false;
  let state;
  try {
    state = readJson(bootstrapStatePath);
  } catch {
    return false;
  }
  const fingerprint = bootstrapFingerprint(lock, manifest);
  if (state.fingerprint !== fingerprint) return false;
  if (!verify) {
    console.log('[bootstrap] inputs and materialized outputs are current.');
    return true;
  }
  console.log('[bootstrap] inputs and materialized outputs are current; running requested verification.');
  try {
    runNpm(['run', 'check']);
    return true;
  } catch {
    console.log('[bootstrap] cached state failed freshness checks; rebuilding from locked inputs.');
    return false;
  }
}

function runDeclaredCommand(spec, cwd) {
  if (!spec || typeof spec.command !== 'string' || !Array.isArray(spec.args)) {
    fail(`Invalid bootstrap command declaration for ${cwd}.`);
  }
  if (spec.command === 'npm') return runNpm(spec.args, { cwd });
  return run(spec.command, spec.args, { cwd });
}

function installWithLockInvariant(cwd, spec) {
  if (spec?.command === 'npm' && spec.args?.[0] !== 'ci') {
    fail(`Locked npm dependency installation must use npm ci: ${cwd}`);
  }
  const lockFile = path.join(cwd, spec.lockFile || 'package-lock.json');
  if (!fs.existsSync(lockFile)) fail(`Dependency lock file is missing: ${lockFile}`);
  const original = fs.readFileSync(lockFile);
  const before = sha256Buffer(original);
  try {
    runDeclaredCommand(spec, cwd);
  } catch (error) {
    if (!fs.existsSync(lockFile) || sha256File(lockFile) !== before) fs.writeFileSync(lockFile, original);
    throw error;
  }
  const after = sha256File(lockFile);
  if (before !== after) {
    fs.writeFileSync(lockFile, original);
    fail(`Dependency installation changed the lock file: ${lockFile}`);
  }
}

function installRootDependencies() {
  const spec = {
    command: 'npm',
    args: ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
    lockFile: 'package-lock.json'
  };
  const stamp = path.join(root, 'node_modules', '.thetree-bootstrap-lock');
  const fingerprint = sha256Buffer(Buffer.from(JSON.stringify({
    lock: sha256File(path.join(root, spec.lockFile)),
    node: process.versions.node,
    npm: runNpm(['--version'], { capture: true }),
    spec
  })));
  if (!forceClean && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === fingerprint) {
    console.log('[dependencies] root node_modules is current.');
    return;
  }
  installWithLockInvariant(root, spec);
  fs.writeFileSync(stamp, fingerprint);
}

function assertRelativeProjectPath(relativePath, label) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
    fail(`Invalid ${label}: ${relativePath}`);
  }
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    fail(`${label} escapes the project root: ${relativePath}`);
  }
  return resolved;
}

function removeLinkOrDirectory(target) {
  if (!fs.existsSync(target)) return;
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) fs.unlinkSync(target);
  else fs.rmSync(target, { recursive: true, force: true });
}

function createDirectoryLink(target, link) {
  removeLinkOrDirectory(link);
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

function packageLinkPath(nodeModules, packageName) {
  const parts = packageName.split('/');
  if (!parts.length || parts.some((part) => !part || part === '.' || part === '..')) {
    fail(`Invalid toolchain workspace package name: ${packageName}`);
  }
  return path.join(nodeModules, ...parts);
}


function prepareBuildToolchain(repository, spec) {
  if (!spec || typeof spec.id !== 'string' || typeof spec.source !== 'string') {
    fail(`Invalid build toolchain declaration for ${repository.name}.`);
  }
  const source = assertRelativeProjectPath(spec.source, 'build toolchain source');
  const packageName = spec.packageFile || 'package.json';
  const lockName = spec.lockFile || 'package-lock.json';
  const sourcePackage = path.join(source, packageName);
  const sourceLock = path.join(source, lockName);
  if (!fs.existsSync(sourcePackage) || !fs.statSync(sourcePackage).isFile()) {
    fail(`Build toolchain package manifest is missing: ${sourcePackage}`);
  }
  if (!fs.existsSync(sourceLock) || !fs.statSync(sourceLock).isFile()) {
    fail(`Build toolchain lock file is missing: ${sourceLock}`);
  }
  if (spec.lockSha256 && sha256File(sourceLock) !== spec.lockSha256) {
    fail(`Build toolchain lock hash mismatch for ${repository.name}: ${sourceLock}`);
  }
  const toolchain = path.join(buildToolRoot, spec.id);
  const install = spec.install || {
    command: 'npm',
    args: ['ci', '--ignore-scripts', '--no-audit', '--no-fund']
  };
  const fingerprint = sha256Buffer(Buffer.from(JSON.stringify({
    package: sha256File(sourcePackage),
    lock: sha256File(sourceLock),
    node: process.versions.node,
    install
  })));
  const stamp = path.join(toolchain, '.thetree-bootstrap-lock');
  const reusable = !forceClean && fs.existsSync(stamp) &&
    fs.readFileSync(stamp, 'utf8') === fingerprint &&
    fs.existsSync(path.join(toolchain, 'node_modules'));
  if (!reusable) {
    fs.rmSync(toolchain, { recursive: true, force: true });
    fs.mkdirSync(toolchain, { recursive: true });
    copyFile(sourcePackage, path.join(toolchain, 'package.json'));
    copyFile(sourceLock, path.join(toolchain, 'package-lock.json'));
    installWithLockInvariant(toolchain, { ...install, lockFile: 'package-lock.json' });
    fs.writeFileSync(stamp, fingerprint);
  } else {
    console.log(`[dependencies] build toolchain ${spec.id} is current.`);
  }

  const toolchainNodeModules = path.join(toolchain, 'node_modules');
  if (!fs.existsSync(toolchainNodeModules) || !fs.statSync(toolchainNodeModules).isDirectory()) {
    fail(`Build toolchain installation did not create node_modules: ${toolchainNodeModules}`);
  }

  const checkout = repositoryCheckout(repository.name);
  for (const workspaceLink of spec.workspaceLinks || []) {
    if (!workspaceLink || typeof workspaceLink.name !== 'string' || typeof workspaceLink.target !== 'string') {
      fail(`Invalid workspace link in build toolchain ${spec.id}.`);
    }
    const target = path.resolve(checkout, workspaceLink.target);
    if (target !== checkout && !target.startsWith(`${checkout}${path.sep}`)) {
      fail(`Workspace link target escapes repository checkout: ${workspaceLink.target}`);
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
      fail(`Workspace link target is missing: ${target}`);
    }
    createDirectoryLink(target, packageLinkPath(toolchainNodeModules, workspaceLink.name));
  }

  const checkoutNodeModules = path.join(checkout, 'node_modules');
  createDirectoryLink(toolchainNodeModules, checkoutNodeModules);
  return () => removeLinkOrDirectory(checkoutNodeModules);
}

function sharedBuildCacheDirectory(fingerprint) {
  const cacheRoot = process.env.THETREE_BOOTSTRAP_CACHE_ROOT;
  return cacheRoot ? path.join(path.resolve(cacheRoot), 'repository-builds', fingerprint) : null;
}

function buildOutputFile(rootDirectory, relativePath) {
  const resolvedRoot = path.resolve(rootDirectory);
  const resolved = path.resolve(rootDirectory, relativePath);
  if (resolved === resolvedRoot || !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    fail(`Repository build output escapes its owner: ${relativePath}`);
  }
  return resolved;
}

function restoreSharedBuildOutputs(checkout, build, fingerprint) {
  if (forceClean) return false;
  const cacheDirectory = sharedBuildCacheDirectory(fingerprint);
  const statePath = cacheDirectory && path.join(cacheDirectory, 'state.json');
  if (!statePath || !fs.existsSync(statePath)) return false;
  try {
    const state = readJson(statePath);
    if (state.schema !== 1 || state.fingerprint !== fingerprint) return false;
    for (const output of build.outputs || []) {
      const cached = buildOutputFile(cacheDirectory, output);
      if (!fs.existsSync(cached) || sha256File(cached) !== state.outputs?.[output]) return false;
    }
    for (const output of build.outputs || []) {
      copyFile(buildOutputFile(cacheDirectory, output), buildOutputFile(checkout, output));
    }
    return true;
  } catch {
    return false;
  }
}

function publishSharedBuildOutputs(checkout, build, fingerprint) {
  const cacheDirectory = sharedBuildCacheDirectory(fingerprint);
  if (!cacheDirectory || fs.existsSync(cacheDirectory)) return;
  const staging = `${cacheDirectory}.${process.pid}.tmp`;
  fs.rmSync(staging, { recursive: true, force: true });
  try {
    const outputs = {};
    for (const output of build.outputs || []) {
      const source = buildOutputFile(checkout, output);
      copyFile(source, buildOutputFile(staging, output));
      outputs[output] = sha256File(source);
    }
    writeJson(path.join(staging, 'state.json'), { schema: 1, fingerprint, outputs });
    fs.mkdirSync(path.dirname(cacheDirectory), { recursive: true });
    if (!fs.existsSync(cacheDirectory)) {
      try {
        fs.renameSync(staging, cacheDirectory);
      } catch (error) {
        if (!fs.existsSync(cacheDirectory)) throw error;
      }
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function buildRepository(repository) {
  const build = repository.build;
  if (!build) return;
  const checkout = repositoryCheckout(repository.name);
  const statePath = path.join(checkout, '.thetree-bootstrap-build.json');
  const fingerprint = sha256Buffer(Buffer.from(JSON.stringify({
    commit: repository.commit,
    build,
    toolchainLock: build.toolchain?.source
      ? sha256File(path.join(assertRelativeProjectPath(build.toolchain.source, 'build toolchain source'), build.toolchain.lockFile || 'package-lock.json'))
      : null
  })));
  const outputsExist = (build.outputs || []).every((output) => fs.existsSync(path.join(checkout, output)));
  if (!forceClean && outputsExist && fs.existsSync(statePath) && readJson(statePath).fingerprint === fingerprint) {
    publishSharedBuildOutputs(checkout, build, fingerprint);
    console.log(`[build] ${repository.name} outputs are current.`);
    return;
  }
  for (const output of build.outputs || []) fs.rmSync(path.join(checkout, output), { recursive: true, force: true });
  if (restoreSharedBuildOutputs(checkout, build, fingerprint)) {
    writeJson(statePath, { fingerprint });
    console.log(`[build] ${repository.name} restored from the shared content cache.`);
    return;
  }

  let detachToolchain = () => {};
  const startedAt = Date.now();
  try {
    if (build.toolchain) detachToolchain = prepareBuildToolchain(repository, build.toolchain);
    else if (build.install) installWithLockInvariant(checkout, build.install);
    for (const step of build.steps || []) runDeclaredCommand(step, checkout);
    const missing = (build.outputs || []).filter((output) => {
      const file = path.join(checkout, output);
      return !fs.existsSync(file) || !fs.statSync(file).isFile();
    });
    if (missing.length) {
      fail(`Upstream repository build did not produce its declared outputs for ${repository.name}:\n${missing.map((item) => `- ${item}`).join('\n')}`);
    }
    writeJson(statePath, { fingerprint });
    publishSharedBuildOutputs(checkout, build, fingerprint);
    console.log(`[build] ${repository.name} completed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`);
  } finally {
    detachToolchain();
  }
}

function buildRepositories(lock) {
  fs.mkdirSync(buildToolRoot, { recursive: true });
  for (const repository of lock.repositories || []) buildRepository(repository);
}

function cleanRepositoryWorktrees(lock, manifest) {
  for (const repository of allCheckoutRepositories(lock, manifest)) {
    const checkout = repositoryCheckout(repository.name);
    if (!fs.existsSync(checkout)) continue;
    run(gitExecutable, ['-C', checkout, 'reset', '--hard', repository.commit]);
  }
}

function normalizeProjectPath(value) {
  return String(value).replaceAll('\\', '/');
}

function vendorSourceField(entry) {
  if (entry.upstreamPath) return 'upstreamPath';
  if (entry.buildPath) return 'buildPath';
  return null;
}

function assertVendorLessClosureContract(manifest) {
  const contract = manifest.sourceInventory?.vendorLessClosure;
  if (
    !contract ||
    contract.schema !== 3 ||
    contract.seeds !== 'declared-less-files' ||
    !Array.isArray(contract.repositoryDiscoveryPatterns) ||
    !contract.repositoryDiscoveryPatterns.length ||
    contract.repositoryDiscoveryPatterns.some((pattern) => (
      typeof pattern !== 'string' ||
      !pattern ||
      path.isAbsolute(pattern) ||
      pattern.split(/[\\/]/).includes('..')
    )) ||
    contract.parser !== 'less-ast' ||
    contract.resolution !== 'shared-resource-loader-resolver' ||
    contract.compilation !== 'less-import-manager'
  ) {
    fail('ORIGIN-MANIFEST is missing the deterministic vendor LESS closure contract.');
  }
  return contract;
}

async function resolveVendorLessClosure(lock, manifest) {
  assertVendorLessClosureContract(manifest);
  const declared = manifest.sourceInventory?.vendorFiles || [];
  const resourceLoaderContract = resolveResourceLoaderOriginContract(
    root,
    readJson(path.join(root, 'contracts', 'resource-loader-origin-contract.json'))
  );
  const lessContract = resourceLoaderContract.shared || {};
  const entries = new Map();
  const queue = [];

  const add = (entry, importedFrom = null) => {
    const normalized = { ...entry, path: normalizeProjectPath(entry.path) };
    const current = entries.get(normalized.path);
    if (current) {
      const currentField = vendorSourceField(current);
      const nextField = vendorSourceField(normalized);
      if (current.status !== normalized.status || current.repository !== normalized.repository || currentField !== nextField || (currentField && current[currentField] !== normalized[nextField])) {
        fail(`Vendor source mapping collision for ${normalized.path}${importedFrom ? ` imported from ${importedFrom}` : ''}.`);
      }
      return current;
    }
    entries.set(normalized.path, normalized);
    if (['mirrored', 'built'].includes(normalized.status) && normalized.path.endsWith('.less')) queue.push(normalized);
    return normalized;
  };

  for (const entry of declared) add(entry);

  const visited = new Set();
  while (queue.length) {
    const entry = queue.shift();
    const sourceField = vendorSourceField(entry);
    if (!sourceField) continue;
    const sourceRel = normalizeProjectPath(entry[sourceField]);
    const visitKey = `${entry.repository}\0${sourceRel}\0${entry.path}`;
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);

    const repository = repositoryByName(lock, entry.repository);
    const checkout = repositoryCheckout(repository.name);
    const source = readVendorSourceBuffer(entry, lock).toString('utf8');
    const imports = await parseResourceLoaderLessImports(source, { filename: sourceRel });
    for (const imported of imports) {
      if (imported.options.isPlugin) {
        fail(`ResourceLoader LESS plugin imports are not materialized: ${entry.path} -> ${imported.request}`);
      }
      if (imported.variable) {
        fail(`Variable ResourceLoader LESS imports cannot be materialized deterministically: ${entry.path} -> ${imported.request}`);
      }
      if (imported.css && !imported.options.inline && !imported.options.less) continue;

      const targetCandidates = listResourceLoaderLessImportCandidates(root, imported.request, entry.path, {
        importPaths: lessContract.importPaths || [],
        importAliases: lessContract.importAliases || {},
        extension: imported.tryAppendLessExtension ? '.less' : ''
      });
      let matched = false;
      for (const targetVendorPath of targetCandidates) {
        if (entries.has(targetVendorPath)) {
          matched = true;
          break;
        }
        if (!targetVendorPath.startsWith('vendor/') || targetVendorPath.includes('/../')) continue;

        const relativeTarget = path.posix.relative(path.posix.dirname(entry.path), targetVendorPath);
        const targetSourceRel = path.posix.normalize(path.posix.join(path.posix.dirname(sourceRel), relativeTarget));
        const targetSourceFile = path.resolve(checkout, targetSourceRel);
        const checkoutRelative = path.relative(checkout, targetSourceFile);
        if (
          checkoutRelative === '..' ||
          checkoutRelative.startsWith(`..${path.sep}`) ||
          path.isAbsolute(checkoutRelative) ||
          !vendorSourceExists(repository, sourceField, targetSourceRel)
        ) {
          continue;
        }
        add({
          path: targetVendorPath,
          status: entry.status,
          repository: entry.repository,
          [sourceField]: normalizeProjectPath(targetSourceRel)
        }, entry.path);
        matched = true;
        break;
      }
      if (!matched && !imported.options.optional) {
        fail(
          `Unresolved ResourceLoader LESS import during vendor materialization: ${entry.path} -> ${imported.request}` +
          (targetCandidates.length ? `; candidates: ${targetCandidates.join(', ')}` : '')
        );
      }
    }
  }

  return [...entries.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function vendorSourcePath(entry, lock) {
  const repository = repositoryByName(lock, entry.repository);
  const sourcePath = entry.upstreamPath || entry.buildPath;
  if (!sourcePath) fail(`Vendor source path is missing for ${entry.path}.`);
  return path.join(repositoryCheckout(repository.name), sourcePath);
}

function repositoryBlobSpec(repository, upstreamPath) {
  return `${repository.commit}:${normalizeProjectPath(upstreamPath)}`;
}

function readRepositoryBlob(repository, upstreamPath) {
  const spec = repositoryBlobSpec(repository, upstreamPath);
  const cacheKey = `${repository.name}\0${spec}`;
  if (repositoryBlobCache.has(cacheKey)) return repositoryBlobCache.get(cacheKey);

  const result = spawnSync(gitExecutable, [
    '-C', repositoryCheckout(repository.name),
    'cat-file', 'blob', spec
  ], {
    cwd: root,
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  });
  if (result.error) throw result.error;
  const value = result.status === 0 ? (result.stdout || Buffer.alloc(0)) : null;
  repositoryBlobCache.set(cacheKey, value);
  return value;
}

function repositoryHasBlob(repository, upstreamPath) {
  return readRepositoryBlob(repository, upstreamPath) !== null;
}

function vendorSourceExists(repository, sourceField, sourcePath) {
  if (sourceField === 'upstreamPath') return repositoryHasBlob(repository, sourcePath);
  const source = path.join(repositoryCheckout(repository.name), sourcePath);
  return fs.existsSync(source) && fs.statSync(source).isFile();
}

function repositoryBlob(entry, lock) {
  const repository = repositoryByName(lock, entry.repository);
  const source = readRepositoryBlob(repository, entry.upstreamPath);
  if (source === null) fail(`Locked Git blob is missing: ${repositoryBlobSpec(repository, entry.upstreamPath)}`);
  return source;
}

function readVendorSourceBuffer(entry, lock) {
  const sourceField = vendorSourceField(entry);
  if (!sourceField) fail(`Vendor source path is missing for ${entry.path}.`);
  if (sourceField === 'upstreamPath') return repositoryBlob(entry, lock);
  const source = vendorSourcePath(entry, lock);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    fail(`Bootstrap source file is missing: ${source}`);
  }
  return fs.readFileSync(source);
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function synchronizeRuntimeAssetHashes(manifest, lock, allowUpdate) {
  const updated = structuredClone(manifest);
  for (const entry of updated.sourceInventory?.materializedRuntimeAssets || []) {
    const sourceBuffer = repositoryBlob(entry, lock);
    const sourceHash = sha256Buffer(sourceBuffer);
    if (allowUpdate) entry.sha256 = sourceHash;
    else if (entry.sha256 !== sourceHash) {
      fail(`Locked runtime asset hash mismatch for ${entry.path}: expected ${entry.sha256}, got ${sourceHash}.`);
    }
  }
  return updated;
}

function assertVendorSourcesAvailable(lock, vendorEntries) {
  const missing = [];
  for (const entry of vendorEntries) {
    if (!['mirrored', 'built'].includes(entry.status)) continue;
    const sourceField = vendorSourceField(entry);
    const repository = repositoryByName(lock, entry.repository);
    const sourcePath = sourceField ? entry[sourceField] : null;
    if (!sourceField || !vendorSourceExists(repository, sourceField, sourcePath)) {
      const source = sourceField === 'upstreamPath'
        ? repositoryBlobSpec(repository, sourcePath)
        : vendorSourcePath(entry, lock);
      missing.push(`${entry.path} <- ${source}`);
    }
  }
  if (missing.length) {
    fail(`Bootstrap source inventory is incomplete:
${missing.map((item) => `- ${item}`).join('\n')}`);
  }
}

async function materializeVendor(lock, manifest) {
  const vendorEntries = await resolveVendorLessClosure(lock, manifest);
  assertVendorSourcesAvailable(lock, vendorEntries);
  fs.mkdirSync(buildToolRoot, { recursive: true });
  const staging = path.join(buildToolRoot, 'vendor-staging');
  const backup = path.join(buildToolRoot, 'vendor-previous');
  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(backup, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });

  for (const entry of vendorEntries) {
    const relative = path.relative(vendorRoot, path.join(root, entry.path));
    if (relative.startsWith('..') || path.isAbsolute(relative)) fail(`Vendor output escapes vendor root: ${entry.path}`);
    const destination = path.join(staging, relative);
    if (entry.status === 'mirrored' || entry.status === 'built') {
      writeBuffer(destination, readVendorSourceBuffer(entry, lock));
    } else if (entry.status === 'adapter' && entry.overlaySource) {
      copyFile(path.join(root, entry.overlaySource), destination);
    }
  }
  if (fs.existsSync(vendorRoot)) fs.renameSync(vendorRoot, backup);
  try {
    fs.renameSync(staging, vendorRoot);
    fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (!fs.existsSync(vendorRoot) && fs.existsSync(backup)) fs.renameSync(backup, vendorRoot);
    throw error;
  }
}

function updateManifestForLock(manifest, lock) {
  const updated = structuredClone(manifest);
  updated.distribution = {
    mode: 'bootstrap-source-only',
    snapshotDate: lock.snapshotDate,
    releaseLine: lock.releaseLine,
    vendorIncluded: false,
    generatedOutputsIncluded: false,
    runtimeAssetsIncluded: false,
    upstreamCheckoutsIncluded: false,
    bootstrap: 'npm run bootstrap',
    vendorProvenance: 'git-checkout-only',
    upstreamBuildOutputsIncluded: false
  };
  return updated;
}

function runPipeline(verify) {
  const startedAt = Date.now();
  runNpm(['run', 'generate']);
  if (verify) runNpm(['run', 'check:contracts']);
  console.log(`[pipeline] generation${verify ? ' and verification' : ''} completed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`);
}

function removeEmptyParents(start, stop) {
  let current = path.dirname(start);
  while (current.startsWith(stop) && current !== stop) {
    if (!fs.existsSync(current) || fs.readdirSync(current).length) break;
    fs.rmdirSync(current);
    current = path.dirname(current);
  }
}

function cleanUndeclaredUpstreamState(lock, manifest) {
  if (!fs.existsSync(upstreamRoot)) return;
  const declared = new Set(allCheckoutRepositories(lock, manifest).map((repository) => repository.name));
  for (const entry of fs.readdirSync(upstreamRoot, { withFileTypes: true })) {
    if (!declared.has(entry.name)) fs.rmSync(path.join(upstreamRoot, entry.name), { recursive: true, force: true });
  }
}

function cleanMaterializedState(manifest) {
  fs.rmSync(vendorRoot, { recursive: true, force: true });
  fs.rmSync(buildToolRoot, { recursive: true, force: true });
  for (const inventoryName of ['generatedFiles', 'materializedRuntimeAssets']) {
    for (const entry of manifest.sourceInventory?.[inventoryName] || []) {
      const output = path.join(root, typeof entry === 'string' ? entry : entry.path);
      fs.rmSync(output, { force: true });
      removeEmptyParents(output, root);
    }
  }
}

function shouldPersistTrackedInputs(options = {}) {
  return Boolean(options.refresh || options.release);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const verify = options.verify || options.refresh || Boolean(options.release);
  forceClean = options.clean;

  const originalLockText = fs.readFileSync(lockPath, 'utf8');
  const originalManifestText = fs.readFileSync(manifestPath, 'utf8');
  const originalLock = JSON.parse(originalLockText);
  let lock = originalLock;
  let resolvedManifest = readJson(manifestPath);

  if (!verify && !options.refresh && !options.release && tryFastBootstrap(lock, resolvedManifest, false)) {
    console.log(`Bootstrap complete from cache: ${lock.mediaWikiRelease} / ${lock.releaseLine} / snapshot ${lock.snapshotDate}.`);
    return;
  }

  ensureCommand(gitExecutable);
  runNpm(['--version'], { capture: true });

  try {
    if (options.clean) cleanMaterializedState(resolvedManifest);
    cleanUndeclaredUpstreamState(originalLock, resolvedManifest);
    installRootDependencies();
    await loadInstalledGenerationTools();
    runNpm(['run', 'preflight']);

    if (!options.refresh && !options.release && tryFastBootstrap(lock, resolvedManifest, verify)) {
      console.log(`Bootstrap complete from cache: ${lock.mediaWikiRelease} / ${lock.releaseLine} / snapshot ${lock.snapshotDate}.`);
      return;
    }

    if (options.refresh) lock = await resolveReleaseCandidate(originalLock, originalLock.mediaWikiRelease);
    else if (options.release) lock = await resolveReleaseCandidate(originalLock, options.release);

    const persistTrackedInputs = shouldPersistTrackedInputs(options);
    const manifestBeforeResolution = readJson(manifestPath);
    resolvedManifest = updateManifestForLock(manifestBeforeResolution, lock);
    if (persistTrackedInputs) {
      writeJson(lockPath, lock);
      writeJson(manifestPath, resolvedManifest);
    }

    await checkoutRepositories(lock, resolvedManifest);
    assertDesignCodexVersionAlignment(lock);
    resolvedManifest = synchronizeRuntimeAssetHashes(resolvedManifest, lock, options.refresh || Boolean(options.release));
    if (persistTrackedInputs) writeJson(manifestPath, resolvedManifest);
    buildRepositories(lock);
    await materializeVendor(lock, resolvedManifest);
    cleanRepositoryWorktrees(lock, resolvedManifest);
    runPipeline(verify);
    fs.mkdirSync(buildToolRoot, { recursive: true });
    writeJson(bootstrapStatePath, { fingerprint: bootstrapFingerprint(lock, resolvedManifest) });

    console.log(`Bootstrap complete: ${lock.mediaWikiRelease} / ${lock.releaseLine} / snapshot ${lock.snapshotDate}.`);
    if (options.refresh || options.release) console.log('The candidate lock and manifest were retained because clone, materialization, generation, and generated-output checks all succeeded.');
  } catch (error) {
    if (options.refresh || options.release) {
      fs.writeFileSync(lockPath, originalLockText);
      fs.writeFileSync(manifestPath, originalManifestText);
    }
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();

export {
  checkoutExactCommit,
  mapConcurrent,
  requiredSparsePaths,
  shouldPersistTrackedInputs
};
