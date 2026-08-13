import fs from 'node:fs';
import path from 'node:path';
import { extractCssCustomPropertyDeclarations } from './resource-loader-output-adapter.mjs';

function normalizeRel(file) {
  return file.split(path.sep).join('/');
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function readFile(root, relPath) {
  const abs = path.isAbsolute(relPath) ? relPath : path.join(root, relPath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new Error(`Missing ResourceLoader LESS source: ${normalizeRel(path.relative(root, abs))}`);
  }
  return fs.readFileSync(abs, 'utf8');
}

function normalizeImportAliases(importAliases = {}) {
  const normalized = new Map();
  if (importAliases instanceof Map) {
    for (const [request, targets] of importAliases) normalized.set(request, asArray(targets).map(normalizeRel));
    return normalized;
  }
  for (const [request, targets] of Object.entries(importAliases || {})) {
    normalized.set(request, asArray(targets).map(normalizeRel));
  }
  return normalized;
}

function importFilesystemPath(request) {
  return String(request).replace(/[?#].*$/, '');
}

function isExternalImportRequest(request) {
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(request) || /^(?:data|file):/i.test(request);
}

function pathWithinRoot(root, absolutePath) {
  const relative = path.relative(root, absolutePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function appendImportExtension(candidate, extension) {
  if (!extension || path.extname(candidate)) return [candidate];
  return [`${candidate}${extension}`, candidate];
}

function candidateAbsolutePath(root, value) {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(root, value);
}

export function listResourceLoaderLessImportCandidates(
  root,
  request,
  fromRelPath,
  { importPaths = [], importAliases = {}, extension = '.less' } = {}
) {
  const absoluteRoot = path.resolve(root);
  const filesystemRequest = importFilesystemPath(request);
  if (!filesystemRequest || isExternalImportRequest(filesystemRequest)) return [];

  const aliases = importAliases instanceof Map ? importAliases : normalizeImportAliases(importAliases);
  const fromAbsolute = path.isAbsolute(fromRelPath)
    ? path.normalize(fromRelPath)
    : path.resolve(absoluteRoot, fromRelPath);
  const fromDirectory = path.dirname(fromAbsolute);
  const candidates = [];

  if (aliases.has(filesystemRequest)) {
    for (const target of aliases.get(filesystemRequest)) candidates.push(candidateAbsolutePath(absoluteRoot, target));
  } else if (path.isAbsolute(filesystemRequest)) {
    candidates.push(path.normalize(filesystemRequest));
  } else {
    candidates.push(path.resolve(fromDirectory, filesystemRequest));
    for (const importPath of importPaths) {
      candidates.push(path.resolve(absoluteRoot, importPath, filesystemRequest));
    }
  }

  const resolved = [];
  const seen = new Set();
  for (const candidate of candidates) {
    for (const absoluteCandidate of appendImportExtension(candidate, extension)) {
      const normalized = path.normalize(absoluteCandidate);
      if (seen.has(normalized) || !pathWithinRoot(absoluteRoot, normalized)) continue;
      seen.add(normalized);
      resolved.push(normalizeRel(path.relative(absoluteRoot, normalized)));
    }
  }
  return resolved;
}

export function resolveResourceLoaderLessImport(
  root,
  request,
  fromRelPath,
  options = {}
) {
  const absoluteRoot = path.resolve(root);
  const candidates = listResourceLoaderLessImportCandidates(absoluteRoot, request, fromRelPath, options);
  for (const rel of candidates) {
    const absolute = path.resolve(absoluteRoot, rel);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) return rel;
  }
  if (!candidates.length) {
    throw new Error(`ResourceLoader LESS import is not a local file request: ${request}`);
  }
  const fromAbsolute = path.isAbsolute(fromRelPath)
    ? path.normalize(fromRelPath)
    : path.resolve(absoluteRoot, fromRelPath);
  throw new Error(
    `Unresolved ResourceLoader LESS import "${request}" from ${normalizeRel(path.relative(absoluteRoot, fromAbsolute))}; ` +
    `tried ${candidates.join(', ')}`
  );
}

async function loadLess() {
  const { default: less } = await import('less');
  return less;
}

export async function parseResourceLoaderLessImports(source, { filename = 'input.less' } = {}) {
  const less = await loadLess();
  const root = await less.parse(String(source), {
    filename,
    processImports: false,
    javascriptEnabled: false
  });
  const imports = [];
  const visitor = new less.visitors.Visitor({
    isReplacing: false,
    visitImport(node) {
      const request = node.getPath();
      imports.push({
        request,
        variable: Boolean(node.isVariableImport()),
        css: node.css === true,
        tryAppendLessExtension: node.css === undefined,
        options: Object.fromEntries(
          Object.entries(node.options || {}).filter(([, value]) => value === true)
        )
      });
      return node;
    }
  });
  visitor.visit(root);
  return imports;
}

function createResourceLoaderFileManagerPlugin(less, {
  root,
  importPaths = [],
  importAliases = {},
  onLoad = null
}) {
  const absoluteRoot = path.resolve(root);
  const aliases = normalizeImportAliases(importAliases);

  class ResourceLoaderFileManager extends less.AbstractFileManager {
    supports(filename) {
      return !isExternalImportRequest(String(filename));
    }

    supportsSync(filename) {
      return this.supports(filename);
    }

    resolve(filename, currentDirectory, options = {}) {
      const importer = path.join(currentDirectory || absoluteRoot, '__resource_loader_import__.less');
      const rel = resolveResourceLoaderLessImport(absoluteRoot, filename, importer, {
        importPaths,
        importAliases: aliases,
        extension: options.ext || ''
      });
      return path.join(absoluteRoot, rel);
    }

    loadedFile(filename, currentDirectory, options = {}) {
      const absolute = this.resolve(filename, currentDirectory, options);
      const contents = fs.readFileSync(absolute, options.rawBuffer ? undefined : 'utf8');
      if (onLoad) onLoad({
        request: filename,
        filename: absolute,
        path: normalizeRel(path.relative(absoluteRoot, absolute))
      });
      return { contents, filename: absolute };
    }

    loadFile(filename, currentDirectory, options) {
      try {
        return Promise.resolve(this.loadedFile(filename, currentDirectory, options));
      } catch (error) {
        return Promise.reject({
          type: 'File',
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    loadFileSync(filename, currentDirectory, options) {
      try {
        return this.loadedFile(filename, currentDirectory, options);
      } catch (error) {
        return {
          error: {
            type: 'File',
            message: error instanceof Error ? error.message : String(error)
          }
        };
      }
    }
  }

  return {
    install(_less, pluginManager) {
      pluginManager.addFileManager(new ResourceLoaderFileManager());
    }
  };
}

function quoteLessImportPath(absolutePath) {
  return JSON.stringify(normalizeRel(absolutePath));
}

function makeModuleSource({ root, prelude, preludeEntries, entrypoints, append = '' }) {
  const chunks = [];
  if (prelude) chunks.push(prelude);
  for (const rel of preludeEntries) {
    const absolute = path.resolve(root, rel);
    chunks.push(`\n// ResourceLoader prelude: ${rel}\n@import (less) ${quoteLessImportPath(absolute)};`);
  }
  for (const rel of entrypoints) {
    const absolute = path.resolve(root, rel);
    chunks.push(`\n// ResourceLoader entry: ${rel}\n@import (less) ${quoteLessImportPath(absolute)};`);
  }
  if (append) chunks.push(append);
  return chunks.join('\n');
}

async function renderResourceLoaderLessSource({
  root,
  source,
  filename,
  importPaths = [],
  importAliases = {}
}) {
  const less = await loadLess();
  const plugin = createResourceLoaderFileManagerPlugin(less, {
    root,
    importPaths,
    importAliases
  });
  const result = await less.render(String(source), {
    filename: path.isAbsolute(filename) ? filename : path.resolve(root, filename),
    plugins: [plugin],
    math: 'always',
    javascriptEnabled: false,
    strictImports: true,
    compress: false
  });
  return result.css.trim();
}

export async function compileResourceLoaderStyleSourceCss({
  root,
  source,
  filename,
  importPaths = [],
  importAliases = {}
}) {
  if (!filename) throw new Error('ResourceLoader LESS source requires a filename for import resolution.');
  return renderResourceLoaderLessSource({
    root,
    source,
    filename,
    importPaths,
    importAliases
  });
}

export async function compileResourceLoaderStyleModuleCss({
  root,
  entrypoint,
  entrypoints,
  moduleName,
  prelude = '',
  preludeEntries = [],
  importPaths = [],
  importAliases = {},
  append = ''
}) {
  const relEntrypoints = asArray(entrypoints ?? entrypoint).map(normalizeRel);
  const relPreludeEntries = asArray(preludeEntries).map(normalizeRel);
  if (!relEntrypoints.length) throw new Error(`No LESS entrypoint specified for ${moduleName}`);

  for (const rel of [...relPreludeEntries, ...relEntrypoints]) readFile(root, rel);

  const source = makeModuleSource({
    root,
    prelude,
    preludeEntries: relPreludeEntries,
    entrypoints: relEntrypoints,
    append
  });
  const virtualFilename = path.join(path.resolve(root), '.resource-loader', `${moduleName}.less`);
  return renderResourceLoaderLessSource({
    root,
    source,
    filename: virtualFilename,
    importPaths,
    importAliases
  });
}


function lessVariableName(customProperty) {
  const name = String(customProperty || '');
  if (!/^--[A-Za-z0-9_-]+$/.test(name)) throw new Error(`Invalid custom property probe name: ${name}`);
  return `@${name.slice(2)}`;
}

export async function probeResourceLoaderLessVariables(options, customProperties) {
  const properties = [...new Set(asArray(customProperties).map(String))].sort();
  if (!properties.length) return new Map();
  const selector = '.__tt_vector_resource_loader_variable_probe';
  const guards = properties.map((property, index) => {
    const variable = lessVariableName(property);
    return [
      `.__tt_vector_probe_${index}() when (isdefined(${variable})) {`,
      `  ${property}: ${variable};`,
      '}'
    ].join('\n');
  }).join('\n');
  const invocations = properties.map((_property, index) => `  .__tt_vector_probe_${index}();`).join('\n');
  const append = `${guards}\n${selector} {\n${invocations}\n}`;
  const css = await compileResourceLoaderStyleModuleCss({ ...options, append });
  return extractCssCustomPropertyDeclarations(css, { selector });
}

export async function compileResourceLoaderStyleModule(options) {
  const css = await compileResourceLoaderStyleModuleCss(options);
  const header = options.banner || `/* Generated from ${options.moduleName} using tools/resource-loader-less.mjs. */`;
  return `${header}\n${css}\n`;
}

export async function compileResourceLoaderLessModule(options) {
  return compileResourceLoaderStyleModule(options);
}

export function copyResourceLoaderAssets({ root, assets }) {
  for (const [fromRel, toRel] of assets) {
    const from = path.join(root, fromRel);
    const to = path.join(root, toRel);
    if (!fs.existsSync(from)) throw new Error(`Missing ResourceLoader asset source: ${fromRel}`);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}
