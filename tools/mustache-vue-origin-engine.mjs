import fs from 'node:fs';
import path from 'node:path';
import Mustache from 'mustache';

import { compareCodePoints } from './shared/deterministic.mjs';
import { walkFiles } from './shared/files.mjs';

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function componentName(relativeTemplatePath, inputExtension) {
  return relativeTemplatePath
    .slice(0, -inputExtension.length)
    .split(/[\\/_.-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('') || 'MustacheComponent';
}

function outputPathFor(outputRoot, relativeTemplatePath, inputExtension, outputExtension) {
  return path.join(outputRoot, `${relativeTemplatePath.slice(0, -inputExtension.length)}${outputExtension}`);
}

function templateNameFor(relativeTemplatePath, inputExtension) {
  return toPosix(relativeTemplatePath).slice(0, -inputExtension.length);
}

function makeTemplateIndex(templateRoot, templateFiles, inputExtension) {
  const byName = new Map();
  for (const absolutePath of templateFiles) {
    const relativePath = path.relative(templateRoot, absolutePath);
    const name = templateNameFor(relativePath, inputExtension);
    if (byName.has(name)) throw new Error(`Duplicate Mustache template logical name: ${name}`);
    byName.set(name, absolutePath);
  }
  return { byName };
}

function normalizePartialName(partialName, inputExtension) {
  const rawName = String(partialName || '');
  if (rawName.includes('\\')) throw new Error(`Invalid Mustache partial logical name: ${partialName}`);
  const sourceName = toPosix(rawName);
  const withoutExtension = sourceName.endsWith(inputExtension)
    ? sourceName.slice(0, -inputExtension.length)
    : sourceName;
  const normalized = path.posix.normalize(withoutExtension);
  if (!normalized || normalized === '.' || normalized.startsWith('/') || normalized === '..' ||
    normalized.startsWith('../') || normalized !== withoutExtension) {
    throw new Error(`Invalid Mustache partial logical name: ${partialName}`);
  }
  return normalized;
}

function resolvePartial(partialName, ownerPath, templateRoot, inputExtension, index) {
  const normalized = normalizePartialName(partialName, inputExtension);
  const ownerRelative = toPosix(path.relative(templateRoot, ownerPath));
  const resolved = index.byName.get(normalized);
  if (!resolved) throw new Error(`${ownerRelative}: missing Mustache partial ${partialName} (logical name ${normalized})`);
  return resolved;
}

function serialize(value) {
  return JSON.stringify(value, null, 2);
}

function collectMustachePartials(tokens, result = new Set()) {
  for (const token of tokens) {
    if (token[0] === '>') result.add(token[1]);
    if ((token[0] === '#' || token[0] === '^') && Array.isArray(token[4])) {
      collectMustachePartials(token[4], result);
    }
  }
  return result;
}

function collectPartialGraph(ownerPath, templatesByPath, tokensByPath, templateRoot, inputExtension, index) {
  const partials = new Map();
  const visitedPaths = new Set();
  const visitingPaths = new Set();

  function directPartialPaths(pathname) {
    const tokens = tokensByPath.get(pathname);
    return [...collectMustachePartials(tokens)].map((partialName) => ({
      partialName,
      partialPath: resolvePartial(partialName, pathname, templateRoot, inputExtension, index)
    }));
  }

  function visit(pathname) {
    if (visitedPaths.has(pathname)) return;
    if (visitingPaths.has(pathname)) return;
    visitingPaths.add(pathname);
    for (const { partialName, partialPath } of directPartialPaths(pathname)) {
      if (!partials.has(partialName)) partials.set(partialName, templatesByPath.get(partialPath));
      visit(partialPath);
    }
    visitingPaths.delete(pathname);
    visitedPaths.add(pathname);
  }

  const directDependencies = [...new Set(directPartialPaths(ownerPath).map(({ partialPath }) => partialPath))]
    .sort((a, b) => compareCodePoints(toPosix(a), toPosix(b)));
  visit(ownerPath);
  return {
    partials: Object.fromEntries([...partials.entries()].sort(([a], [b]) => compareCodePoints(a, b))),
    directDependencies
  };
}

function generateComponent({ root, nodeId, templateRoot, inputExtension, absolutePath, outputPath, template, partials }) {
  const relativeTemplatePath = toPosix(path.relative(root, absolutePath));
  const relativeUnderTemplateRoot = path.relative(templateRoot, absolutePath);
  const name = componentName(relativeUnderTemplateRoot, inputExtension);
  let runtimeImport = toPosix(path.relative(path.dirname(outputPath), path.join(root, 'lib/mustacheVueRuntime')));
  if (!runtimeImport.startsWith('.')) runtimeImport = `./${runtimeImport}`;
  return `<!-- @generated origin-node:${nodeId} from ${relativeTemplatePath}; do not hand-edit. -->\n<script>\nimport { createMustacheVueComponent } from ${JSON.stringify(runtimeImport)};\n\nconst template = ${serialize(template)};\nconst partials = ${serialize(partials)};\n\nexport default createMustacheVueComponent({\n  name: ${JSON.stringify(name)},\n  template,\n  partials\n});\n</script>\n`;
}

function isGeneratedMustacheComponent(absolutePath) {
  if (!absolutePath.endsWith('.vue')) return false;
  const prefix = fs.readFileSync(absolutePath, 'utf8').slice(0, 96);
  return prefix.startsWith('<!-- @generated origin-node:') ||
    prefix.startsWith('<!-- @generated by tools/generate-mustache-vue-components.mjs');
}

export function generateMustacheVueComponents({
  root,
  nodeId,
  inputRoot,
  outputRoot,
  inputExtension = '.mustache',
  outputExtension = '.vue',
  partialResolution = 'template-root-name',
  check = false
}) {
  if (partialResolution !== 'template-root-name') {
    throw new Error(`Unsupported Mustache partial resolution policy: ${partialResolution}`);
  }

  const templateRoot = path.join(root, inputRoot);
  const componentRoot = path.join(root, outputRoot);
  if (!fs.existsSync(templateRoot)) {
    throw new Error(`Missing materialized Mustache template directory: ${toPosix(inputRoot)}`);
  }

  const templateFiles = walkFiles(templateRoot)
    .filter((absolutePath) => absolutePath.endsWith(inputExtension))
    .sort((a, b) => compareCodePoints(toPosix(a), toPosix(b)));
  if (templateFiles.length === 0) throw new Error('No materialized Mustache templates were found.');

  const index = makeTemplateIndex(templateRoot, templateFiles, inputExtension);
  const templatesByPath = new Map();
  const tokensByPath = new Map();
  for (const absolutePath of templateFiles) {
    const relativePath = toPosix(path.relative(root, absolutePath));
    const template = fs.readFileSync(absolutePath, 'utf8');
    try {
      templatesByPath.set(absolutePath, template);
      tokensByPath.set(absolutePath, Mustache.parse(template));
    } catch (error) {
      throw new Error(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const expectedOutputs = new Map();
  const outputRelations = [];
  for (const absolutePath of templateFiles) {
    const relativeTemplatePath = path.relative(templateRoot, absolutePath);
    const outputPath = outputPathFor(componentRoot, relativeTemplatePath, inputExtension, outputExtension);
    const partialGraph = collectPartialGraph(
      absolutePath,
      templatesByPath,
      tokensByPath,
      templateRoot,
      inputExtension,
      index
    );
    expectedOutputs.set(outputPath, generateComponent({
      root,
      nodeId,
      templateRoot,
      inputExtension,
      absolutePath,
      outputPath,
      template: templatesByPath.get(absolutePath),
      partials: partialGraph.partials
    }));
    outputRelations.push({
      path: toPosix(path.relative(root, outputPath)),
      input: toPosix(path.relative(root, absolutePath)),
      dependencies: partialGraph.directDependencies.map((dependencyPath) => toPosix(path.relative(root, dependencyPath)))
    });
  }

  const previousGeneratedFiles = fs.existsSync(componentRoot)
    ? walkFiles(componentRoot).filter(isGeneratedMustacheComponent)
    : [];
  const staleFiles = previousGeneratedFiles.filter((absolutePath) => !expectedOutputs.has(absolutePath));
  let failed = false;
  for (const staleFile of staleFiles) {
    const relative = toPosix(path.relative(root, staleFile));
    if (check) {
      console.error(`Stale generated Mustache component: ${relative}`);
      failed = true;
    } else {
      fs.rmSync(staleFile);
      console.log(`Removed stale generated Mustache component: ${relative}`);
    }
  }

  for (const [outputPath, expected] of expectedOutputs) {
    const relative = toPosix(path.relative(root, outputPath));
    if (check) {
      if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== expected) {
        console.error(`Generated Mustache component is stale: ${relative}`);
        failed = true;
      }
    } else {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, expected);
      console.log(`Generated Mustache component: ${relative}`);
    }
  }

  if (failed) throw new Error('Mustache generated-output check failed.');
  return {
    inputs: templateFiles.map((absolutePath) => toPosix(path.relative(root, absolutePath))),
    outputs: [...expectedOutputs.keys()].map((absolutePath) => toPosix(path.relative(root, absolutePath))),
    relations: outputRelations
  };
}
