#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertResourceLoaderOriginContractSchema } from './resource-loader-origin-schema.mjs';
import { resolveResourceLoaderOriginContract } from './resource-loader-contract.mjs';
import { validateVector2022HostViewContract } from '../lib/vector2022SpecialPageContract.js';
import { validateHostLockContract, validateHostViewExtractorContract } from './host-view-contract-engine.mjs';
import { walkFiles } from './shared/files.mjs';


const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const preflight = process.argv.includes('--preflight');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function sha256File(pathname) {
  return crypto.createHash('sha256').update(fs.readFileSync(pathname)).digest('hex');
}

function validateBuildToolchainLocks(root, lock) {
  for (const repository of lock.repositories || []) {
    const toolchain = repository.build?.toolchain;
    if (!toolchain) continue;
    const source = normalizeRelativePath(toolchain.source);
    const lockFile = normalizeRelativePath(toolchain.lockFile || 'package-lock.json');
    const pathname = path.join(root, source, lockFile);
    if (!fs.existsSync(pathname) || !fs.statSync(pathname).isFile()) {
      throw new Error(`Build toolchain lock file is missing for ${repository.name}: ${pathname}`);
    }
    if (!toolchain.lockSha256) continue;
    const actual = sha256File(pathname);
    if (actual !== toolchain.lockSha256) {
      throw new Error(
        `Build toolchain lock hash mismatch for ${repository.name}: expected ${toolchain.lockSha256}, got ${actual}. ` +
        'Hash-locked package-lock.json files must be checked out with LF line endings.'
      );
    }
  }
}

function valueAtPath(object, dottedPath) {
  let value = object;
  for (const segment of String(dottedPath || '').split('.').filter(Boolean)) value = value?.[segment];
  return value;
}

function toPathSet(values) {
  return new Set((values || []).map((value) => typeof value === 'string' ? value : value?.path).filter(Boolean));
}

function normalizeRelativePath(pathname) {
  return String(pathname || '').replaceAll('\\', '/').replace(/^\.\//, '');
}

function hasDeclaredValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== '';
}

function entriesAtInventories(manifest, inventoryPaths, label) {
  const entries = [];
  for (const inventoryPath of inventoryPaths || []) {
    const inventory = valueAtPath(manifest, inventoryPath);
    if (!Array.isArray(inventory)) throw new Error(`${label} references invalid inventory ${inventoryPath}.`);
    for (const entry of inventory) entries.push({ inventoryPath, entry });
  }
  return entries;
}

function listSourceCoverageFiles(contract) {
  const relativeRoot = normalizeRelativePath(contract.root || '.').replace(/\/$/, '');
  if (fs.existsSync(path.join(root, '.git'))) {
    const args = ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--'];
    if (relativeRoot && relativeRoot !== '.') args.push(relativeRoot);
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
    if (result.error || result.status !== 0) {
      throw new Error(`Unable to enumerate Git-visible source files: ${result.error?.message || result.stderr || result.stdout}`);
    }
    return result.stdout.split('\0')
      .filter(Boolean)
      .map(normalizeRelativePath)
      .filter((pathname) => fs.existsSync(path.join(root, pathname)));
  }

  const coverageRoot = path.join(root, relativeRoot || '.');
  return walkFiles(coverageRoot).map((pathname) => normalizeRelativePath(path.relative(root, pathname)));
}

function validateSourceInventoryCoverage(manifest) {
  const contract = manifest.sourceInventory?.sourceCoverage;
  if (!contract) return;
  if (contract.schema !== 1) throw new Error(`Unsupported source coverage schema: ${contract.schema ?? 'none'}`);

  const declaredEntries = entriesAtInventories(manifest, contract.declaredInventories, 'sourceCoverage.declaredInventories');
  const excludedEntries = entriesAtInventories(manifest, contract.excludedInventories, 'sourceCoverage.excludedInventories');
  const declared = new Map();

  for (const { inventoryPath, entry } of declaredEntries) {
    const pathname = normalizeRelativePath(typeof entry === 'string' ? entry : entry?.path);
    if (!pathname) throw new Error(`${inventoryPath} contains an entry without a path: ${JSON.stringify(entry)}`);
    const previous = declared.get(pathname);
    if (previous) throw new Error(`Source file ${pathname} is declared more than once: ${previous}, ${inventoryPath}`);
    declared.set(pathname, inventoryPath);
  }

  const excluded = toPathSet(excludedEntries.map(({ entry }) => {
    const pathname = typeof entry === 'string' ? entry : entry?.path;
    return normalizeRelativePath(pathname);
  }));
  const ignoredRoots = new Set((contract.ignoredRoots || []).map(normalizeRelativePath));
  const actual = new Set(listSourceCoverageFiles(contract).filter((pathname) => {
    if (!pathname || excluded.has(pathname)) return false;
    const firstSegment = pathname.split('/')[0];
    return !ignoredRoots.has(firstSegment);
  }));

  const differences = [];
  for (const pathname of declared.keys()) if (!actual.has(pathname)) differences.push(`declared source file is missing: ${pathname}`);
  for (const pathname of actual) if (!declared.has(pathname)) differences.push(`source file lacks a role declaration: ${pathname}`);
  if (differences.length) throw new Error(`Source inventory coverage mismatch:
- ${differences.join('\n- ')}`);

  for (const inventoryContract of contract.inventoryContracts || []) {
    const inventoryPath = inventoryContract.inventory;
    const inventory = valueAtPath(manifest, inventoryPath);
    if (!Array.isArray(inventory)) throw new Error(`sourceCoverage.inventoryContracts references invalid inventory ${inventoryPath}.`);
    for (const entry of inventory) {
      for (const field of inventoryContract.requiredFields || []) {
        if (!hasDeclaredValue(entry?.[field])) {
          throw new Error(`${inventoryPath} entry lacks ${field}: ${entry?.path || JSON.stringify(entry)}`);
        }
      }
      const requiredAnyFields = inventoryContract.requiredAnyFields || [];
      if (requiredAnyFields.length && !requiredAnyFields.some((field) => hasDeclaredValue(entry?.[field]))) {
        throw new Error(`${inventoryPath} entry requires one of ${requiredAnyFields.join(', ')}: ${entry?.path || JSON.stringify(entry)}`);
      }
      for (const [field, allowedValues] of Object.entries(inventoryContract.allowedValues || {})) {
        if (!allowedValues.includes(entry?.[field])) {
          throw new Error(`${inventoryPath} entry has unsupported ${field}=${entry?.[field] ?? 'none'}: ${entry?.path || JSON.stringify(entry)}`);
        }
      }
    }
  }

  const vendorByOrigin = new Map();
  for (const entry of manifest.sourceInventory?.vendorFiles || []) {
    if (!entry?.repository || !entry?.upstreamPath) continue;
    const key = `${entry.repository}::${normalizeRelativePath(entry.upstreamPath)}`;
    if (vendorByOrigin.has(key)) {
      throw new Error(`vendorFiles declares the same upstream origin more than once: ${entry.repository} ${entry.upstreamPath}`);
    }
    vendorByOrigin.set(key, normalizeRelativePath(entry.path));
  }
  for (const entry of manifest.sourceInventory?.portedFiles || []) {
    const source = fs.readFileSync(path.join(root, entry.path), 'utf8');
    if (!source.includes(`SPDX-License-Identifier: ${entry.license}`)) {
      throw new Error(`Source port SPDX notice mismatch: ${entry.path}`);
    }
    for (const modifiedDate of entry.modifiedDates || []) {
      if (!source.includes(modifiedDate)) {
        throw new Error(`Source port modification notice lacks ${modifiedDate}: ${entry.path}`);
      }
    }
    const upstreamPaths = entry.upstreamPath ? [entry.upstreamPath] : entry.upstreamPaths;
    const expected = (upstreamPaths || []).map((upstreamPath) => {
      const key = `${entry.repository}::${normalizeRelativePath(upstreamPath)}`;
      const vendorPath = vendorByOrigin.get(key);
      if (!vendorPath) {
        throw new Error(`Source port origin is not materialized in vendorFiles: ${entry.path} <- ${entry.repository} ${upstreamPath}`);
      }
      return vendorPath;
    });
    const declaredOrigins = normalizePathArray(entry.originInputs);
    if (JSON.stringify([...expected].sort()) !== JSON.stringify(declaredOrigins)) {
      throw new Error(`Source port originInputs mismatch: ${entry.path}`);
    }
  }
}



function extractVueModuleScript(source, filename) {
  const open = '<script>';
  const close = '</script>';
  const start = source.indexOf(open);
  if (start === -1) throw new Error(`Vue module lacks an exact <script> block: ${filename}`);
  if (source.indexOf(open, start + open.length) !== -1) {
    throw new Error(`Vue module has more than one <script> block: ${filename}`);
  }
  const end = source.indexOf(close, start + open.length);
  if (end === -1 || source.indexOf(close, end + close.length) !== -1) {
    throw new Error(`Vue module has an invalid </script> boundary: ${filename}`);
  }
  return source.slice(start + open.length, end);
}

function parseModuleDependencies(entries) {
  if (!entries.length) return new Map();
  const parser = String.raw`
const fs = require('node:fs');
const vm = require('node:vm');
const entries = JSON.parse(fs.readFileSync(0, 'utf8'));
const result = [];
for (const entry of entries) {
  try {
    const module = new vm.SourceTextModule(entry.source, { identifier: entry.path });
    result.push({ path: entry.path, dependencies: module.dependencySpecifiers });
  } catch (error) {
    process.stderr.write(entry.path + ': ' + error.message + '\n');
    process.exitCode = 1;
  }
}
if (!process.exitCode) process.stdout.write(JSON.stringify(result));
`;
  const run = spawnSync(process.execPath, ['--experimental-vm-modules', '-e', parser], {
    input: JSON.stringify(entries),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true
  });
  if (run.status !== 0) {
    throw new Error(`ECMAScript module graph parsing failed:\n${String(run.stderr || run.stdout).trim()}`);
  }
  return new Map(JSON.parse(run.stdout).map((entry) => [entry.path, entry.dependencies]));
}

function moduleResolutionCandidates(importer, specifier) {
  const base = normalizeRelativePath(path.posix.join(path.posix.dirname(importer), specifier));
  if (path.posix.extname(base)) return [base];
  return [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.json`,
    `${base}.vue`,
    `${base}/index.js`,
    `${base}/index.mjs`,
    `${base}/index.vue`
  ];
}

function validateModuleGraph(root, manifest, { requireMaterialized = true } = {}) {
  const contract = manifest.integration?.moduleGraph;
  if (!contract) return;
  if (contract.schema !== 1) throw new Error(`Unsupported module graph schema: ${contract.schema ?? 'none'}`);

  const ignoredRoots = new Set(contract.ignoredRoots || []);
  const modules = [];
  for (const absolute of walkFiles(root)) {
    const relative = normalizeRelativePath(path.relative(root, absolute));
    if (ignoredRoots.has(relative.split('/')[0])) continue;
    if (!['.js', '.mjs', '.vue'].includes(path.extname(relative))) continue;
    const raw = fs.readFileSync(absolute, 'utf8');
    modules.push({
      path: relative,
      source: relative.endsWith('.vue') ? extractVueModuleScript(raw, relative) : raw
    });
  }

  const dependenciesByModule = parseModuleDependencies(modules);
  const actualFiles = new Set(walkFiles(root).map((absolute) => normalizeRelativePath(path.relative(root, absolute))));
  const declaredGenerated = toPathSet(manifest.sourceInventory?.generatedFiles);
  const declaredVendor = toPathSet(manifest.sourceInventory?.vendorFiles);
  const availableFiles = new Set(actualFiles);
  if (!requireMaterialized) {
    for (const pathname of declaredGenerated) availableFiles.add(pathname);
    for (const pathname of declaredVendor) availableFiles.add(pathname);
  }
  const allowedBare = new Set([
    ...Object.keys(readJson('package.json').dependencies || {}),
    ...Object.keys(readJson('package.json').devDependencies || {}),
    ...(contract.allowedBareSpecifiers || [])
  ]);
  const allowedPrefixes = contract.allowedSpecifierPrefixes || [];
  const errors = [];

  for (const [importer, specifiers] of dependenciesByModule) {
    for (const specifier of specifiers) {
      if (!specifier.startsWith('.')) {
        if (allowedBare.has(specifier) || allowedPrefixes.some((prefix) => specifier.startsWith(prefix))) continue;
        errors.push(`${importer} imports undeclared host/package specifier ${specifier}`);
        continue;
      }
      const candidates = moduleResolutionCandidates(importer, specifier);
      const resolved = candidates.find((candidate) => (
        availableFiles.has(candidate) || (
          requireMaterialized &&
          fs.existsSync(path.join(root, candidate)) &&
          fs.statSync(path.join(root, candidate)).isFile()
        )
      ));
      if (!resolved) {
        errors.push(`${importer} cannot resolve ${specifier}; candidates: ${candidates.join(', ')}`);
        continue;
      }
      if (resolved.startsWith('vendor/') && !declaredVendor.has(resolved)) {
        errors.push(`${importer} imports vendor file outside sourceInventory.vendorFiles: ${resolved}`);
      }
      const generatedRoot = ['lib/generated/', 'css/vendor/'].some((prefix) => resolved.startsWith(prefix));
      if (generatedRoot && !declaredGenerated.has(resolved)) {
        errors.push(`${importer} imports generated file outside sourceInventory.generatedFiles: ${resolved}`);
      }
    }
  }
  if (errors.length) throw new Error(`Static module graph mismatch:\n- ${errors.join('\n- ')}`);
}

function validateStylesheetDelivery(root, manifest) {
  const contract = manifest.integration?.stylesheetDelivery;
  if (!contract) return;
  if (contract.schema !== 1 || contract.mode !== 'ordered-vue-style-src') {
    throw new Error(`Unsupported stylesheet delivery contract: ${contract.schema ?? 'none'} ${contract.mode ?? 'none'}`);
  }
  const resourceContract = readJson(contract.resourceLoaderContract);
  if (resourceContract.pageStyleQueue?.profile !== contract.profile) {
    throw new Error(`Stylesheet delivery profile mismatch: ${contract.profile} != ${resourceContract.pageStyleQueue?.profile ?? 'none'}`);
  }
  if (contract.selection !== 'build-time-static') {
    throw new Error(`Unsupported stylesheet profile selection: ${contract.selection ?? 'none'}`);
  }
  const consumer = normalizeRelativePath(contract.consumer);
  const consumerSource = fs.readFileSync(path.join(root, consumer), 'utf8');
  const actual = [...consumerSource.matchAll(/<style\s+src=(["'])([^"']+)\1\s*><\/style>/g)]
    .map((match) => normalizeRelativePath(path.posix.join(path.posix.dirname(consumer), match[2])));
  const expected = [contract.originBundle, ...(contract.adapterStyles || [])].map(normalizeRelativePath);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Vue stylesheet delivery order mismatch: expected [${expected.join(', ')}], found [${actual.join(', ')}]`);
  }
  const generated = toPathSet(manifest.sourceInventory?.generatedFiles);
  if (!generated.has(normalizeRelativePath(contract.originBundle))) {
    throw new Error(`Static stylesheet origin bundle is not a declared generated output: ${contract.originBundle}`);
  }
}

function validateSkinVariantIntegration(root, manifest) {
  const integration = manifest.integration?.skinVariant;
  if (!integration) throw new Error('Package integration requires a skinVariant contract.');
  if (integration.schema !== 1) throw new Error(`Unsupported skin variant integration schema: ${integration.schema}`);
  const localFiles = toPathSet(manifest.sourceInventory?.localFiles);
  const contractPath = normalizeRelativePath(integration.contract);
  const runtimePath = normalizeRelativePath(integration.runtimeModule);
  for (const pathname of [contractPath, runtimePath]) {
    if (!localFiles.has(pathname) || !fs.existsSync(path.join(root, pathname))) {
      throw new Error(`Skin variant boundary file is not a declared source file: ${pathname}`);
    }
  }
  const variant = readJson(contractPath);
  const runtime = fs.readFileSync(path.join(root, runtimePath), 'utf8');
  if (
    variant.schema !== 1
    || !runtime.includes(`'${variant.family}'`)
    || !runtime.includes(`'${variant.id}'`)
    || !runtime.includes(`'${variant.upstreamSkinName}'`)
  ) {
    throw new Error(`Runtime skin variant identity disagrees with ${contractPath}.`);
  }
  const consumerPath = normalizeRelativePath(integration.consumer);
  if (!localFiles.has(consumerPath) || !fs.existsSync(path.join(root, consumerPath))) {
    throw new Error(`Skin variant consumer is not a declared source file: ${consumerPath}`);
  }
  const layoutSource = fs.readFileSync(path.join(root, consumerPath), 'utf8');
  if (!layoutSource.includes(integration.activationAttribute)) {
    throw new Error(`Skin variant activation marker is missing from layout: ${integration.activationAttribute}`);
  }
}

function validatePackageIntegration(root, manifest, options = {}) {
  const contract = manifest.integration;
  if (!contract) return;
  if (contract.schema !== 1) throw new Error(`Unsupported integration contract schema: ${contract.schema ?? 'none'}`);
  const packageMetadata = readJson('package.json');
  const packageLock = readJson('package-lock.json');
  const expected = packageMetadata.version;
  const observed = [
    ['package-lock.json version', packageLock.version],
    ['package-lock.json root version', packageLock.packages?.['']?.version]
  ];
  for (const [label, version] of observed) {
    if (version !== expected) throw new Error(`Package integration version mismatch: ${label}=${version ?? 'none'}, package.json=${expected}`);
  }
  validateSkinVariantIntegration(root, manifest);
  validateStylesheetDelivery(root, manifest);
  validateModuleGraph(root, manifest, options);
}

function discoverNodeInputs(node) {
  if (!node.inputRoot) return null;
  const absoluteRoot = path.join(root, node.inputRoot);
  return walkFiles(absoluteRoot)
    .filter((pathname) => !node.inputExtension || pathname.endsWith(node.inputExtension))
    .map((pathname) => path.relative(root, pathname).replaceAll('\\', '/'));
}

function sortGenerationNodes(nodes) {
  const byId = new Map();
  nodes.forEach((node, index) => {
    if (!node?.id || !node?.kind) throw new Error(`Invalid generation node at index ${index}.`);
    if (byId.has(node.id)) throw new Error(`Duplicate generation node id: ${node.id}`);
    byId.set(node.id, { ...node, index });
  });

  for (const node of byId.values()) {
    for (const dependency of node.dependsOn || []) {
      if (!byId.has(dependency)) throw new Error(`Generation node ${node.id} depends on missing node ${dependency}.`);
    }
  }

  const complete = new Set();
  const ordered = [];
  while (ordered.length < byId.size) {
    const ready = [...byId.values()]
      .filter((node) => !complete.has(node.id) && (node.dependsOn || []).every((dependency) => complete.has(dependency)))
      .sort((a, b) => a.index - b.index);
    if (ready.length === 0) {
      const blocked = [...byId.values()].filter((node) => !complete.has(node.id)).map((node) => node.id);
      throw new Error(`Generation graph contains a dependency cycle: ${blocked.join(', ')}`);
    }
    for (const node of ready) {
      ordered.push(node);
      complete.add(node.id);
    }
  }
  return ordered;
}

function declaredNodeOutputs(manifest, node) {
  const inventory = valueAtPath(manifest, node.outputInventory);
  if (!Array.isArray(inventory)) throw new Error(`Generation node ${node.id} has invalid outputInventory ${node.outputInventory}.`);
  return toPathSet(inventory.filter((entry) => entry && entry.originNode === node.id));
}

function declaredNodeInputs(manifest, node) {
  if (!node.inputInventory) return null;
  const inventory = valueAtPath(manifest, node.inputInventory);
  if (!Array.isArray(inventory)) throw new Error(`Generation node ${node.id} has invalid inputInventory ${node.inputInventory}.`);
  const prefix = `${String(node.inputRoot || '').replaceAll('\\', '/').replace(/\/$/, '')}/`;
  return toPathSet(inventory.filter((entry) => {
    const pathname = typeof entry === 'string' ? entry : entry?.path;
    return pathname?.startsWith(prefix) && (!node.inputExtension || pathname.endsWith(node.inputExtension));
  }));
}

function validateInputInventory(manifest, node, result) {
  const declared = declaredNodeInputs(manifest, node);
  if (declared === null) return;
  const actual = toPathSet(result?.inputs);
  const differences = [];
  for (const pathname of declared) if (!actual.has(pathname)) differences.push(`declared input was not consumed: ${pathname}`);
  for (const pathname of actual) if (!declared.has(pathname)) differences.push(`consumed input is not declared: ${pathname}`);
  if (differences.length) throw new Error(`Generation node ${node.id} input inventory mismatch:\n- ${differences.join('\n- ')}`);
}

function validateOutputInventory(manifest, node, result) {
  const declared = declaredNodeOutputs(manifest, node);
  const actual = toPathSet(result?.outputs);
  const differences = [];
  for (const pathname of declared) if (!actual.has(pathname)) differences.push(`declared output was not produced: ${pathname}`);
  for (const pathname of actual) if (!declared.has(pathname)) differences.push(`produced output is not declared: ${pathname}`);
  if (differences.length) throw new Error(`Generation node ${node.id} output inventory mismatch:\n- ${differences.join('\n- ')}`);
}

function normalizePathArray(values) {
  return [...new Set((values || []).map(normalizeRelativePath).filter(Boolean))].sort();
}

function validateOutputRelations(manifest, node, result) {
  const contract = node.outputRelationContract;
  if (!contract) return;
  const inventory = valueAtPath(manifest, node.outputInventory);
  if (!Array.isArray(inventory)) throw new Error(`Generation node ${node.id} has invalid outputInventory ${node.outputInventory}.`);

  const inputField = contract.inputField;
  const dependenciesField = contract.dependenciesField;
  if (!inputField || !dependenciesField) {
    throw new Error(`Generation node ${node.id} has an incomplete outputRelationContract.`);
  }

  const declaredInputs = declaredNodeInputs(manifest, node);
  const assertDeclaredInput = (pathname, owner) => {
    if (declaredInputs !== null && !declaredInputs.has(pathname)) {
      throw new Error(`Generation node ${node.id} output relation ${owner} references undeclared input: ${pathname}`);
    }
  };

  const declared = new Map();
  for (const entry of inventory.filter((candidate) => candidate?.originNode === node.id)) {
    if (!hasDeclaredValue(entry?.[inputField])) {
      throw new Error(`Generation node ${node.id} output relation lacks ${inputField}: ${entry?.path || JSON.stringify(entry)}`);
    }
    if (!Array.isArray(entry?.[dependenciesField])) {
      throw new Error(`Generation node ${node.id} output relation lacks ${dependenciesField} array: ${entry?.path || JSON.stringify(entry)}`);
    }
    const input = normalizeRelativePath(entry[inputField]);
    const dependencies = normalizePathArray(entry[dependenciesField]);
    assertDeclaredInput(input, entry.path);
    for (const dependency of dependencies) assertDeclaredInput(dependency, entry.path);
    declared.set(normalizeRelativePath(entry.path), { input, dependencies });
  }

  const actual = new Map();
  for (const relation of result?.relations || []) {
    const pathname = normalizeRelativePath(relation?.path);
    if (!pathname) throw new Error(`Generation node ${node.id} produced an output relation without a path.`);
    if (actual.has(pathname)) throw new Error(`Generation node ${node.id} produced duplicate output relation: ${pathname}`);
    const input = normalizeRelativePath(relation.input);
    const dependencies = normalizePathArray(relation.dependencies);
    assertDeclaredInput(input, pathname);
    for (const dependency of dependencies) assertDeclaredInput(dependency, pathname);
    actual.set(pathname, { input, dependencies });
  }

  const differences = [];
  for (const [pathname, expected] of declared) {
    const observed = actual.get(pathname);
    if (!observed) {
      differences.push(`declared output relation was not produced: ${pathname}`);
      continue;
    }
    if (expected.input !== observed.input) {
      differences.push(`${pathname} input mismatch: declared ${expected.input}, produced ${observed.input}`);
    }
    if (JSON.stringify(expected.dependencies) !== JSON.stringify(observed.dependencies)) {
      differences.push(`${pathname} direct dependency mismatch: declared [${expected.dependencies.join(', ')}], produced [${observed.dependencies.join(', ')}]`);
    }
  }
  for (const pathname of actual.keys()) if (!declared.has(pathname)) differences.push(`produced output relation is not declared: ${pathname}`);
  if (differences.length) throw new Error(`Generation node ${node.id} output relation mismatch:\n- ${differences.join('\n- ')}`);
}

function validateOriginNodeCoverage(manifest, nodes) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const outputOwners = new Map();
  for (const inventoryName of ['generatedFiles', 'materializedRuntimeAssets']) {
    for (const entry of manifest.sourceInventory?.[inventoryName] || []) {
      if (!entry?.path) throw new Error(`${inventoryName} entry lacks path: ${JSON.stringify(entry)}`);
      if (!entry.originNode) throw new Error(`${inventoryName} entry lacks originNode: ${JSON.stringify(entry)}`);
      if (!nodeIds.has(entry.originNode)) throw new Error(`${inventoryName} entry references unknown originNode ${entry.originNode}: ${entry.path}`);
      const previous = outputOwners.get(entry.path);
      if (previous) throw new Error(`Generated output ${entry.path} is assigned more than once: ${previous}, ${entry.originNode}`);
      outputOwners.set(entry.path, entry.originNode);
    }
  }
}

const engines = Object.freeze({
  'runtime-assets': async ({ manifest, lock, node }) => {
    const { materializeRuntimeAssets } = await import('./runtime-asset-origin-engine.mjs');
    return materializeRuntimeAssets({
      root,
      entries: valueAtPath(manifest, node.inventory),
      lock,
      check
    });
  },
  'javascript-ports': async ({ manifest, node }) => {
    const { generateJavaScriptPorts } = await import('./javascript-port-origin-engine.mjs');
    return generateJavaScriptPorts({
      root,
      nodeId: node.id,
      entries: valueAtPath(manifest, node.outputInventory),
      vendorEntries: manifest.sourceInventory?.vendorFiles,
      check
    });
  },
  'message-origin': async ({ manifest, node }) => {
    const { generateMessageOrigin } = await import('./message-origin-engine.mjs');
    return generateMessageOrigin({
      root,
      contractPath: node.contract,
      vendorEntries: manifest.sourceInventory?.vendorFiles || [],
      check
    });
  },
  'mustache-vue-directory': async ({ node }) => {
    const { generateMustacheVueComponents } = await import('./mustache-vue-origin-engine.mjs');
    return generateMustacheVueComponents({
      root,
      nodeId: node.id,
      inputRoot: node.inputRoot,
      outputRoot: node.outputRoot,
      inputExtension: node.inputExtension,
      outputExtension: node.outputExtension,
      partialResolution: node.partialResolution,
      check
    });
  },
  'resource-loader-origin': async ({ node }) => {
    const { generateResourceLoaderOrigins } = await import('./resource-loader-origin-engine.mjs');
    return generateResourceLoaderOrigins({
      root,
      contractPath: node.contract,
      check
    });
  },
  'commonjs-esm-origin': async ({ node }) => {
    const { generateCommonJsEsmOrigins } = await import('./commonjs-esm-origin-engine.mjs');
    return generateCommonJsEsmOrigins({ root, contractPath: node.contract, check });
  },
  'vue-sfc-origin': async ({ node }) => {
    const { generateVueSfcOrigins } = await import('./vue-sfc-origin-engine.mjs');
    return generateVueSfcOrigins({ root, contractPath: node.contract, check });
  }
});

async function main() {
  const manifest = readJson('ORIGIN-MANIFEST.json');
  const lock = readJson(manifest.upstreamLockFile || 'UPSTREAM-LOCK.json');
  validateBuildToolchainLocks(root, lock);
  validateSourceInventoryCoverage(manifest);
  const generation = manifest.generation;
  if (generation?.schema !== 1 || !Array.isArray(generation.nodes)) {
    throw new Error(`Unsupported or missing generation graph schema: ${generation?.schema ?? 'none'}`);
  }

  const nodes = sortGenerationNodes(generation.nodes);
  validateOriginNodeCoverage(manifest, nodes);
  if (preflight) {
    validateVector2022HostViewContract();
    validateHostViewExtractorContract();
    validateHostLockContract(manifest.hostLock);
    for (const node of nodes) {
      if (node.kind !== 'resource-loader-origin') continue;
      const contract = readJson(node.contract);
      assertResourceLoaderOriginContractSchema(contract.schema);
      resolveResourceLoaderOriginContract(root, contract);
    }
    validatePackageIntegration(root, manifest, { requireMaterialized: false });
    console.log('checked package integration preflight');
    return;
  }
  const { validateLockedHostViewSourceContract } = await import('./host-view-contract-engine.mjs');
  const hostResult = validateLockedHostViewSourceContract(root, manifest);
  console.log(`checked locked host view source closure (${hostResult.contentNames.length} contentName values)`);

  for (const node of nodes) {
    const engine = engines[node.kind];
    if (!engine) throw new Error(`Unknown generation engine kind ${node.kind} for node ${node.id}.`);
    const discoveredInputs = discoverNodeInputs(node);
    if (discoveredInputs !== null) validateInputInventory(manifest, node, { inputs: discoveredInputs });
    const result = await engine({ manifest, lock, node });
    validateInputInventory(manifest, node, result);
    validateOutputInventory(manifest, node, result);
    validateOutputRelations(manifest, node, result);
    console.log(`${check ? 'checked' : 'generated'} origin node ${node.id}`);
  }
  validatePackageIntegration(root, manifest);
  console.log(`${check ? 'checked' : 'validated'} package integration contract`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
