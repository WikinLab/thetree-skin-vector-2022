import fs from 'node:fs';
import path from 'node:path';
import { assertResourceLoaderOriginContractSchema } from './resource-loader-origin-schema.mjs';
import { resolveResourceLoaderOriginContract } from './resource-loader-contract.mjs';
import {
  compileResourceLoaderStyleModuleCss,
  compileResourceLoaderStyleSourceCss
} from './resource-loader-less.mjs';
import { compileCustomPropertyClosure } from './resource-loader-custom-properties.mjs';
import { parseFirstPhpArrayAfter, parsePhpFeatureCompatibilityAfter, parsePhpFeatureLessMessageBindingsAfter } from './php-array-literal.mjs';
import {
  adaptResourceLoaderOutputCss,
  makeCssAssetUrlRewrites,
  normalizeCssSelectors,
  isolateResourceLoaderOutputCssFromHostContent,
  scopeResourceLoaderOutputCss,
  withGeneratedCssBanner,
  rewriteResourceLoaderSelectorRoots
} from './resource-loader-output-adapter.mjs';
import { walkFiles } from './shared/files.mjs';

const asArray = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
const posix = (value) => String(value).replaceAll('\\', '/');
const skinDefinitionCache = new Map();
const skinRuntimeCache = new Map();

function readJson(root, rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

function moduleMap(document, rootKey) {
  if (!rootKey) return document;
  let value = document;
  for (const segment of String(rootKey).split('.').filter(Boolean)) value = value?.[segment];
  return value || {};
}

function normalizeModuleDefinition(value) {
  if (typeof value === 'string' || Array.isArray(value)) return { styles: value };
  return value;
}

function normalizeStyles(styles) {
  if (typeof styles === 'string') return [{ path: styles }];
  if (Array.isArray(styles)) return styles.map((item) => typeof item === 'string' ? { path: item } : item);
  if (styles && typeof styles === 'object') {
    return Object.entries(styles).map(([file, options]) => ({ path: file, ...(options || {}) }));
  }
  return [];
}

function sourcePath(sourceBase, module, stylePath) {
  const base = module.localBasePath ? path.posix.join(sourceBase, module.localBasePath) : sourceBase;
  return posix(path.posix.join(base, stylePath));
}

function adaptOwnership(css, ownership, shared) {
  const surfaces = shared.hostSurfaces;
  const policy = shared.ownershipPolicies?.[ownership];
  if (!policy) throw new Error(`Unknown ResourceLoader ownership policy: ${ownership}`);
  let output = css;
  if (policy.scopeSurface) {
    const scopeSelector = surfaces[policy.scopeSurface];
    if (!scopeSelector) throw new Error(`Unknown ResourceLoader host surface: ${policy.scopeSurface}`);
    output = scopeResourceLoaderOutputCss(output, {
      scopeSelector,
      rootClassNames: policy.rootClassNames || [],
      rootIdNames: policy.rootIdNames || [],
      rootTagNames: policy.rootTagNames || [],
      ancestorContextClassNames: policy.ancestorContextClassNames || [],
      ancestorContextTagNames: policy.ancestorContextTagNames || []
    });
  }
  for (const [selector, surfaceName] of Object.entries(policy.documentRootRewrites || {})) {
    const replacement = surfaces[surfaceName];
    if (!replacement) throw new Error(`Unknown ResourceLoader rewrite surface: ${surfaceName}`);
    output = rewriteResourceLoaderSelectorRoots(output, { [selector]: replacement });
  }
  if (policy.isolateHostContent) {
    const admittedSurfaceName = policy.admittedSurface || null;
    const admittedSurface = admittedSurfaceName ? surfaces[admittedSurfaceName] : '';
    if (admittedSurfaceName && !admittedSurface) {
      throw new Error(`Unknown ResourceLoader admitted surface: ${admittedSurfaceName}`);
    }
    const excludedSurfaceSelectors = asArray(policy.excludedSurfaces).map((surfaceName) => {
      const selector = surfaces[surfaceName];
      if (!selector) throw new Error(`Unknown ResourceLoader excluded surface: ${surfaceName}`);
      return selector;
    });
    output = isolateResourceLoaderOutputCssFromHostContent(output, {
      hostContentSelector: surfaces.hostContent,
      admittedSurfaceSelector: admittedSurface,
      excludedSurfaceSelectors,
      preserveAncestorClassNames: policy.preserveAncestorClassNames || [],
      preserveAncestorIdNames: policy.preserveAncestorIdNames || []
    });
  }
  return output;
}

function uniqueEntries(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.path}\0${entry.ownership}\0${entry.media || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function featureOwnership(feature, contract) {
  for (const rule of contract.skinModule.ownershipRules || []) {
    if (new RegExp(rule.pattern).test(feature)) return rule.ownership;
  }
  throw new Error(`No ownership rule for SkinModule feature: ${feature}`);
}

function featureIsset(features, key) {
  return Object.prototype.hasOwnProperty.call(features, key) && features[key] != null;
}

function applySkinFeatureCompatibility(features, aliases, operations, addUnspecifiedFeatures) {
  const output = { ...features };
  for (const [from, to] of Object.entries(aliases || {})) {
    if (featureIsset(output, from) && to != null && !featureIsset(output, to)) {
      output[to] = output[from];
    }
    delete output[from];
  }
  for (const operation of operations || []) {
    if (operation.type === 'propagate') {
      if (operation.requiresAddUnspecifiedFeatures && !addUnspecifiedFeatures) continue;
      if (featureIsset(output, operation.from) && !featureIsset(output, operation.to)) {
        output[operation.to] = output[operation.from];
      }
      continue;
    }
    if (operation.type === 'shorthand') {
      if (featureIsset(output, operation.from) && output[operation.from]) {
        for (const feature of operation.enables || []) output[feature] = true;
      }
      delete output[operation.from];
      continue;
    }
    throw new Error(`Unknown SkinModule compatibility operation: ${operation.type}`);
  }
  return output;
}

function readSkinModuleDefinition(root, contract) {
  const cacheKey = `${root}\0${contract.skinModule.source}`;
  if (skinDefinitionCache.has(cacheKey)) return skinDefinitionCache.get(cacheKey);
  const source = fs.readFileSync(path.join(root, contract.skinModule.source), 'utf8');
  if (!contract.skinModule.compatibilityMethod) throw new Error('SkinModule compatibility method marker is not declared');
  if (!contract.skinModule.constructorMethod) throw new Error('SkinModule constructor method marker is not declared');
  const messageBindings = parsePhpFeatureLessMessageBindingsAfter(source, contract.skinModule.constructorMethod);
  const messageConstants = Object.fromEntries(messageBindings.map(({ constant }) => [
    constant,
    parseFirstPhpArrayAfter(source, `private const ${constant} =`)
  ]));
  const definition = {
    files: parseFirstPhpArrayAfter(source, 'private const FEATURE_FILES ='),
    aliases: parseFirstPhpArrayAfter(source, 'private const COMPAT_ALIASES ='),
    defaultsSpecified: parseFirstPhpArrayAfter(source, 'private const DEFAULT_FEATURES_SPECIFIED ='),
    defaultsAbsent: parseFirstPhpArrayAfter(source, 'private const DEFAULT_FEATURES_ABSENT ='),
    compatibility: parsePhpFeatureCompatibilityAfter(source, contract.skinModule.compatibilityMethod),
    messageBindings: messageBindings.map(({ feature, constant }) => ({
      feature,
      messages: messageConstants[constant]
    }))
  };
  const assertKnownFeature = (feature, owner) => {
    if (!Object.prototype.hasOwnProperty.call(definition.files, feature)) {
      throw new Error(`${owner} references an unknown SkinModule feature: ${feature}`);
    }
  };
  for (const target of Object.values(definition.aliases || {})) if (target != null) assertKnownFeature(target, 'SkinModule compatibility alias');
  for (const feature of Object.keys(definition.defaultsSpecified || {})) assertKnownFeature(feature, 'SkinModule specified default');
  for (const feature of definition.defaultsAbsent || []) assertKnownFeature(feature, 'SkinModule absent default');
  for (const operation of definition.compatibility) {
    const referenced = operation.type === 'propagate' ? [operation.from, operation.to] : operation.enables || [];
    for (const feature of referenced) assertKnownFeature(feature, 'SkinModule compatibility operation');
  }
  for (const binding of definition.messageBindings) {
    assertKnownFeature(binding.feature, 'SkinModule LESS message binding');
    if (!Array.isArray(binding.messages) || binding.messages.some((key) => typeof key !== 'string')) {
      throw new Error(`SkinModule LESS message binding is not a string list: ${binding.feature}`);
    }
  }
  skinDefinitionCache.set(cacheKey, definition);
  return definition;
}

function resolveSkinModule(root, module, contract) {
  const definition = readSkinModuleDefinition(root, contract);
  const featureDeclaration = module.features == null ? definition.defaultsAbsent : module.features;
  const listMode = Array.isArray(featureDeclaration);
  let features = listMode
    ? Object.fromEntries((featureDeclaration || []).map((feature) => [feature, true]))
    : { ...(featureDeclaration || {}) };
  features = applySkinFeatureCompatibility(features, definition.aliases, definition.compatibility, !listMode);
  for (const feature of Object.keys(features)) {
    if (!Object.prototype.hasOwnProperty.call(definition.files, feature)) {
      throw new Error(`SkinModule feature is not recognised by ${contract.skinModule.source}: ${feature}`);
    }
  }
  if (!listMode && module.features != null) features = { ...definition.defaultsSpecified, ...features };
  const disabled = new Set(contract.skinModule.disabledFeatures || []);
  const allowedMedia = new Set(contract.shared.activeMedia || ['all', 'screen']);
  const entries = [];
  let order = 0;
  for (const [feature, mediaFiles] of Object.entries(definition.files || {})) {
    if (!features[feature] || disabled.has(feature)) continue;
    for (const [media, files] of Object.entries(mediaFiles || {})) {
      if (!allowedMedia.has(media)) continue;
      for (const file of asArray(files)) {
        entries.push({
          path: posix(path.posix.join(contract.skinModule.coreSourceBase, file)),
          ownership: featureOwnership(feature, contract),
          order: order++,
          skinFeature: feature,
          media
        });
      }
    }
  }
  const lessMessages = definition.messageBindings
    .filter(({ feature }) => features[feature] && !disabled.has(feature))
    .flatMap(({ messages }) => messages);
  return { entries, lessMessages: [...new Set(lessMessages)].sort() };
}

function readSkinRuntimeContract(root, contract) {
  const cacheKey = `${root}\0${contract.skinModule.configSchema}`;
  if (skinRuntimeCache.has(cacheKey)) return skinRuntimeCache.get(cacheKey);
  const schema = fs.readFileSync(path.join(root, contract.skinModule.configSchema), 'utf8');
  const config = parseFirstPhpArrayAfter(schema, 'return');
  const defaults = config?.['config-schema-inverse']?.default;
  const limits = defaults?.ThumbLimits;
  const defaultIndex = defaults?.DefaultUserOptions?.thumbsize;
  if (!Array.isArray(limits) || !Number.isInteger(defaultIndex) || !limits[defaultIndex]) {
    throw new Error('Unable to derive MediaWiki SkinModule thumbnail contract');
  }
  const runtime = { small: Math.max(180, Math.min(...limits)), standard: limits[defaultIndex], large: Math.max(...limits) };
  skinRuntimeCache.set(cacheKey, runtime);
  return runtime;
}

function normaliseCodexManifest(manifest) {
  const files = new Map();
  const components = new Map();
  for (const [key, value] of Object.entries(manifest)) {
    files.set(value.file, {
      imports: (value.imports || []).map((item) => manifest[item]?.file).filter(Boolean),
      css: value.css || []
    });
    if (value.isEntry) components.set(path.basename(value.file, path.extname(value.file)), value.file);
  }
  return { files, components };
}

function resolveCodexCss(root, module, contract) {
  if (!module.codexComponents?.length) return '';
  const manifestRel = contract.shared.codexManifest;
  const moduleRoot = contract.shared.codexModuleRoot;
  const manifest = normaliseCodexManifest(readJson(root, manifestRel));
  const ordered = [];
  const visited = new Set();
  const visiting = new Set();
  const visit = (file) => {
    if (visited.has(file)) return;
    if (visiting.has(file)) throw new Error(`Circular Codex manifest dependency: ${file}`);
    visiting.add(file);
    const data = manifest.files.get(file);
    if (!data) throw new Error(`Codex component file is missing from ${manifestRel}: ${file}`);
    for (const dependency of data.imports) visit(dependency);
    for (const css of data.css) if (!ordered.includes(css)) ordered.push(css);
    visiting.delete(file);
    visited.add(file);
  };
  for (const component of module.codexComponents) {
    const file = manifest.components.get(component);
    if (!file) throw new Error(`Codex component is missing from ${manifestRel}: ${component}`);
    visit(file);
  }
  return ordered.map((file) => fs.readFileSync(path.join(root, moduleRoot, file), 'utf8').trim()).join('\n');
}

function relativeRuntimeAssetDirectory(root, output, runtimeAssetDirectory) {
  let rel = path.relative(path.dirname(path.join(root, output)), path.join(root, runtimeAssetDirectory)).replaceAll('\\', '/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return `${rel.replace(/\/$/, '')}/`;
}

function lessMessagePrelude(keys) {
  return [...new Set(keys || [])].sort().map((key) => `@msg-${key}: var(--mw-msg-${key});`).join('\n');
}

function entryCompileOptions(root, contract, moduleName, entry, lessMessages) {
  const shared = contract.shared;
  return {
    root,
    moduleName,
    entrypoint: entry.path,
    prelude: [
      lessMessagePrelude(lessMessages),
      entry.skinFeature === 'accessibility' ? `@image-size-standard: ${readSkinRuntimeContract(root, contract).standard};` : ''
    ].filter(Boolean).join('\n'),
    preludeEntries: shared.lessPreludeEntries,
    importPaths: [path.posix.dirname(entry.path), ...shared.importPaths],
    importAliases: shared.importAliases
  };
}

async function compileEntry(root, contract, moduleName, output, entry, lessMessages) {
  const shared = contract.shared;
  const compileOptions = entryCompileOptions(root, contract, moduleName, entry, lessMessages);
  const raw = await compileResourceLoaderStyleModuleCss(compileOptions);
  const assetDirectory = relativeRuntimeAssetDirectory(root, output, shared.runtimeAssetDirectory || 'images');
  let css = adaptResourceLoaderOutputCss(raw, {
    assetUrlRewrites: makeCssAssetUrlRewrites(assetDirectory, { includeLegacyThreeLevelParent: true })
  });
  css = adaptOwnership(css, entry.ownership, shared);
  if (entry.skinFeature === 'accessibility') {
    const sizes = readSkinRuntimeContract(root, contract);
    css += `\n\n:root {\n  --image-size-small: ${sizes.small}px;\n  --image-size-standard: ${sizes.standard}px;\n  --image-size-large: ${sizes.large}px;\n}`;
  }
  if (entry.media && entry.media !== 'all' && entry.media !== 'screen') css = `@media ${entry.media} {\n${css}\n}`;
  return { css };
}

function vueStyleBlocks(source, filename) {
  const blocks = [];
  const pattern = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;
  for (const match of source.matchAll(pattern)) {
    const attributes = match[1] || '';
    if (/\bscoped(?:\s|=|$)/i.test(attributes)) {
      throw new Error(`ResourceLoader Vue style scoping is not supported without the upstream Vue compiler: ${filename}`);
    }
    const language = /\blang\s*=\s*(["'])([^"']+)\1/i.exec(attributes)?.[2]?.toLowerCase() || 'css';
    if (!['css', 'less'].includes(language)) {
      throw new Error(`Unsupported ResourceLoader Vue style language ${language}: ${filename}`);
    }
    blocks.push({ language, source: match[2] });
  }
  return blocks;
}

async function compileVueStyleEntry(root, contract, moduleName, output, entry) {
  const source = fs.readFileSync(path.join(root, entry.path), 'utf8');
  const blocks = vueStyleBlocks(source, entry.path);
  const parts = [];
  for (const [index, block] of blocks.entries()) {
    const raw = await compileResourceLoaderStyleSourceCss({
      root,
      source: block.source,
      filename: entry.path,
      importPaths: [path.posix.dirname(entry.path), ...(contract.shared.importPaths || [])],
      importAliases: contract.shared.importAliases
    });
    const assetDirectory = relativeRuntimeAssetDirectory(
      root,
      output,
      contract.shared.runtimeAssetDirectory || 'images'
    );
    let css = adaptResourceLoaderOutputCss(raw, {
      assetUrlRewrites: makeCssAssetUrlRewrites(assetDirectory, { includeLegacyThreeLevelParent: true })
    });
    css = adaptOwnership(css, entry.ownership, contract.shared);
    parts.push(`/* Vue SFC style block ${index + 1}: ${entry.path} */\n${css}`);
  }
  return { css: parts.join('\n\n') };
}

async function compileModule(root, contract, record) {
  const module = moduleDefinition(root, record);
  if (!module) throw new Error(`ResourceLoader module ${record.name} is absent from ${record.metadata}`);

  const entries = [];
  let skinLessMessages = [];
  if (String(module.class || '').endsWith('SkinModule')) {
    const resolved = resolveSkinModule(root, module, contract);
    entries.push(...resolved.entries);
    skinLessMessages = resolved.lessMessages;
  }
  const activeMedia = new Set(contract.shared.activeMedia || ['all', 'screen']);
  for (const style of normalizeStyles(module.styles)) {
    const media = style.media || 'all';
    if (!activeMedia.has(media)) continue;
    entries.push({
      path: sourcePath(record.sourceBase, module, style.path || style.name),
      media,
      ownership: record.ownership,
      order: 1000
    });
  }
  for (const packageFile of asArray(module.packageFiles)) {
    const packagePath = typeof packageFile === 'string' ? packageFile : packageFile?.name;
    if (typeof packagePath !== 'string' || !packagePath.endsWith('.vue')) continue;
    entries.push({
      path: sourcePath(record.sourceBase, module, packagePath),
      media: 'all',
      ownership: record.ownership,
      order: 2000,
      kind: 'vue-sfc-style'
    });
  }

  const lessMessages = [...new Set([...asArray(module.lessMessages), ...skinLessMessages])]
    .filter((key) => typeof key === 'string')
    .sort();
  const parts = [];
  const codexCss = resolveCodexCss(root, module, contract);
  if (codexCss) parts.push(codexCss);
  if (String(module.class || '').endsWith('OOUIIconPackModule')) {
    parts.push(await compileIconPackModule(root, contract, record, module));
  }
  if (String(module.class || '').endsWith('ImageModule')) {
    parts.push(compileImageModule(root, record, module));
  }
  for (const entry of uniqueEntries(entries)) {
    const compiled = entry.kind === 'vue-sfc-style'
      ? await compileVueStyleEntry(root, contract, record.name, record.output, entry)
      : await compileEntry(root, contract, record.name, record.output, entry, lessMessages);
    parts.push(compiled.css);
  }
  return {
    css: withGeneratedCssBanner(normalizeCssSelectors(parts.filter(Boolean).join('\n\n')), {
      banner: `/* Generated mechanically from ResourceLoader module ${record.name}. Metadata: ${record.metadata}. */`,
      moduleName: record.name
    }),
    lessMessages,
    messages: asArray(module.messages).filter((key) => typeof key === 'string').sort()
  };
}

function codexIconVariable(root, contract, icon) {
  const iconPaths = contract.shared.importAliases?.['@wikimedia/codex-icons/codex-icon-paths.less'];
  if (typeof iconPaths !== 'string') {
    throw new Error('OOUIIconPackModule generation requires a single Codex icon-paths import alias.');
  }
  const source = fs.readFileSync(path.join(root, iconPaths), 'utf8');
  const available = new Set([...source.matchAll(/^@cdx-icon-([a-z0-9-]+)\s*:/gm)].map((match) => match[1]));
  const kebab = String(icon).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  const candidates = [kebab, String(icon).toLowerCase(), kebab.replaceAll('-', '')];
  const resolved = candidates.find((candidate) => available.has(candidate));
  if (!resolved) throw new Error(`Codex has no deterministic icon-path mapping for OOUI icon ${icon}.`);
  return `@cdx-icon-${resolved}`;
}

async function compileIconPackModule(root, contract, record, module) {
  const selectorPattern = module.selectorWithoutVariant;
  if (typeof selectorPattern !== 'string' || !selectorPattern.includes('{name}')) {
    throw new Error(`OOUIIconPackModule ${record.name} lacks selectorWithoutVariant.`);
  }
  const icons = asArray(module.icons).filter((icon) => typeof icon === 'string');
  if (!icons.length) throw new Error(`OOUIIconPackModule ${record.name} contains no icons.`);
  const color = module.defaultColor || '@color-base';
  const codexMixins = contract.shared.importAliases?.['mediawiki.skin.codex/mixins/codex-public-mixins.less'];
  if (typeof codexMixins !== 'string') {
    throw new Error('OOUIIconPackModule generation requires a Codex public-mixins import alias.');
  }
  const append = [...new Set(icons)].map((icon) => {
    const selector = selectorPattern.replaceAll('{name}', icon);
    return `${selector} {\n  .cdx-mixin-css-icon( ${codexIconVariable(root, contract, icon)}, ${color}, @param-is-button-icon: true );\n}`;
  }).join('\n\n');
  return compileResourceLoaderStyleModuleCss({
    root,
    moduleName: `${record.name}.icon-pack`,
    entrypoints: [codexMixins],
    preludeEntries: [
      ...contract.shared.lessPreludeEntries,
      contract.shared.importAliases['@wikimedia/codex-icons/codex-icon-paths.less']
    ],
    importPaths: contract.shared.importPaths,
    importAliases: contract.shared.importAliases,
    append
  });
}

function imageFileEntries(value) {
  if (typeof value === 'string') return [{ direction: null, file: value }];
  if (!value || typeof value !== 'object') return [];
  const file = value.file ?? value;
  if (typeof file === 'string') return [{ direction: null, file }];
  return Object.entries(file || {})
    .filter(([, pathname]) => typeof pathname === 'string')
    .map(([direction, pathname]) => ({ direction, file: pathname }));
}

function compileImageModule(root, record, module) {
  if (!record.imageOutputDirectory) {
    throw new Error(`ImageModule ${record.name} requires imageOutputDirectory.`);
  }
  const selectorPattern = module.selectorWithoutVariant || '{name}';
  const lines = [];
  for (const [name, value] of Object.entries(module.images || {})) {
    const selector = selectorPattern.replaceAll('{name}', name);
    for (const entry of imageFileEntries(value)) {
      const output = path.posix.join(record.imageOutputDirectory, path.posix.basename(entry.file));
      const relative = posix(path.relative(path.dirname(path.join(root, record.output)), path.join(root, output)));
      const directionalSelector = entry.direction === 'ltr' || entry.direction === 'rtl'
        ? selector.split(',').map((part) => `[dir="${entry.direction}"] ${part.trim()}`).join(', ')
        : selector;
      lines.push(`${directionalSelector} {\n  background-image: url("${relative}");\n}`);
    }
  }
  if (!lines.length) throw new Error(`ImageModule ${record.name} contains no images.`);
  return lines.join('\n\n');
}

function lexicalStringLiterals(source) {
  const values = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      index = Math.min(source.length, index + 2);
      continue;
    }
    if (char === '#') {
      index += 1;
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '`') {
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') index += 2;
        else if (source[index] === '`') { index += 1; break; }
        else index += 1;
      }
      continue;
    }
    if (char !== "'" && char !== '"') {
      index += 1;
      continue;
    }
    const quote = char;
    const start = index;
    index += 1;
    let value = '';
    while (index < source.length) {
      const current = source[index];
      if (current === '\\') {
        const escaped = source[index + 1];
        if (escaped == null) { index += 1; break; }
        const decoded = { n: '\n', r: '\r', t: '\t' }[escaped] ?? escaped;
        value += decoded;
        index += 2;
      } else if (current === quote) {
        index += 1;
        values.push({ value, start, end: index });
        break;
      } else {
        value += current;
        index += 1;
      }
    }
  }
  return values;
}

function matchingDelimiter(source, openIndex, openChar, closeChar) {
  let depth = 0;
  let index = openIndex;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      index = Math.min(source.length, index + 2);
      continue;
    }
    if (char === '#') {
      index += 1;
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') index += 2;
        else if (source[index] === quote) { index += 1; break; }
        else index += 1;
      }
      continue;
    }
    if (char === openChar) depth += 1;
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return -1;
}

function phpMethodBody(source, methodName, file) {
  const pattern = new RegExp(`\\bfunction\\s+${String(methodName).replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*\\(`);
  const match = pattern.exec(source);
  if (!match) throw new Error(`Unable to locate PHP method ${methodName} in ${file}`);
  const open = source.indexOf('{', match.index + match[0].length);
  if (open === -1) throw new Error(`Unable to locate PHP method body ${methodName} in ${file}`);
  const close = matchingDelimiter(source, open, '{', '}');
  if (close === -1) throw new Error(`Unterminated PHP method body ${methodName} in ${file}`);
  return source.slice(open + 1, close);
}

function callStringArguments(source, callee, file) {
  const output = [];
  let offset = 0;
  while (offset < source.length) {
    const call = source.indexOf(callee, offset);
    if (call === -1) break;
    const open = source.indexOf('(', call + callee.length);
    if (open === -1) break;
    const close = matchingDelimiter(source, open, '(', ')');
    if (close === -1) throw new Error(`Unterminated ${callee} call in ${file}`);
    output.push(...lexicalStringLiterals(source.slice(open + 1, close)).map((entry) => entry.value));
    offset = close + 1;
  }
  return output;
}

function valueAtSegments(value, segments, description) {
  let current = value;
  for (const segment of segments || []) current = current?.[segment];
  if (!Array.isArray(current)) throw new Error(`Expected module list at ${description}`);
  return current.filter((item) => typeof item === 'string');
}

function moduleDefinition(root, record) {
  if (!record?.metadata || !record?.name) return null;
  if (record.metadataKind === 'php-resource-modules') {
    const source = fs.readFileSync(path.join(root, record.metadata), 'utf8');
    return normalizeModuleDefinition(parseFirstPhpArrayAfter(source, `'${record.name}' =>`));
  }
  if (record.metadataKind && record.metadataKind !== 'json') {
    throw new Error(`Unknown ResourceLoader metadata kind ${record.metadataKind}: ${record.name}`);
  }
  const metadata = readJson(root, record.metadata);
  const modules = moduleMap(metadata, record.metadataRoot);
  return normalizeModuleDefinition(modules[record.name] || (metadata.module === record.name ? metadata : null));
}

function resourceOutputRecords(contract) {
  const records = new Map();
  for (const record of contract.modules || []) records.set(record.name, { ...record, kind: 'module' });
  for (const record of contract.bundles || []) records.set(record.name, { ...record, kind: 'bundle' });
  if (contract.customPropertyClosure) records.set(contract.customPropertyClosure.name, { ...contract.customPropertyClosure, kind: 'custom-property-closure' });
  return records;
}

function modulesFromQueueSource(root, source) {
  if (source.kind === 'generated-output') return [source.name];
  if (source.kind === 'declared-modules') {
    const modules = asArray(source.modules).filter((item) => typeof item === 'string');
    if (!modules.length) throw new Error('declared-modules page style source contains no modules.');
    return modules;
  }
  if (source.kind === 'skin-option-styles') {
    const metadata = readJson(root, source.metadata);
    const args = metadata.ValidSkinNames?.[source.skin]?.args;
    const options = Array.isArray(args) ? args.find((item) => item && typeof item === 'object' && item.name === source.skin) || args[0] : null;
    if (!options || !Array.isArray(options.styles)) {
      throw new Error(`Unable to derive skin style queue for ${source.skin} from ${source.metadata}`);
    }
    return options.styles.filter((item) => typeof item === 'string');
  }
  if (source.kind === 'php-add-module-styles') {
    const file = source.file;
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const method = phpMethodBody(text, source.method, file);
    const modules = callStringArguments(method, 'addModuleStyles', file);
    if (modules.length === 0) throw new Error(`No addModuleStyles modules found in ${file}::${source.method}`);
    return modules;
  }
  if (source.kind === 'php-array-append-modules') {
    const file = source.file;
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const method = phpMethodBody(text, source.method, file);
    const variable = String(source.variable || 'styles').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\$${variable}\\s*\\[\\s*\\]\\s*=\\s*(['\"])([^'\"]+)\\1`, 'g');
    const modules = [...method.matchAll(pattern)].map((match) => match[2]);
    if (!modules.length) throw new Error(`No $${source.variable || 'styles'}[] modules found in ${file}::${source.method}`);
    return modules;
  }
  if (source.kind === 'extension-attribute-modules') {
    return valueAtSegments(readJson(root, source.metadata), source.path, `${source.metadata}:${(source.path || []).join('.')}`);
  }
  if (source.kind === 'javascript-loader-using') {
    const file = source.file;
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const modules = callStringArguments(text, 'mw.loader.using', file);
    if (modules.length === 0) throw new Error(`No mw.loader.using modules found in ${file}`);
    return modules;
  }
  if (source.kind === 'php-module-definition') {
    const text = fs.readFileSync(path.join(root, source.file), 'utf8');
    const defined = lexicalStringLiterals(text).some((entry) => {
      if (entry.value !== source.module) return false;
      return /^\s*=>/.test(text.slice(entry.end));
    });
    if (!defined) throw new Error(`ResourceLoader module ${source.module} is absent from ${source.file}`);
    return [source.module];
  }
  throw new Error(`Unknown page style queue source kind: ${source.kind}`);
}

function moduleDependencies(root, record) {
  if (record.kind !== 'module') return [];
  const definition = moduleDefinition(root, record);
  if (!definition) throw new Error(`ResourceLoader module ${record.name} is absent from ${record.metadata}`);
  return asArray(definition.dependencies).filter((item) => typeof item === 'string');
}

function uniqueNames(names) {
  const seen = new Set();
  return names.filter((name) => {
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

function resolvePageStyleDependencies(root, roots, records, emitted) {
  const ordered = [];
  const visiting = new Set();
  const visit = (name) => {
    if (emitted.has(name)) return;
    const record = records.get(name);
    if (!record) return;
    if (visiting.has(name)) throw new Error(`Circular ResourceLoader page-style dependency: ${[...visiting, name].join(' -> ')}`);
    visiting.add(name);
    for (const dependency of moduleDependencies(root, record)) visit(dependency);
    visiting.delete(name);
    if (!emitted.has(name)) {
      emitted.add(name);
      ordered.push(name);
    }
  };
  for (const name of roots) visit(name);
  return ordered;
}

function resourceLoaderTransport(record, definition, queue) {
  return {
    source: record.resourceLoaderSource ?? definition?.source ?? queue.clientHtml?.defaultSource ?? 'local',
    group: record.resourceLoaderGroup ?? definition?.group ?? queue.clientHtml?.defaultGroup ?? ''
  };
}

function orderLikeClientHtmlMakeLoad(root, names, records, queue, emitted) {
  // MediaWiki ClientHtml::makeLoad() calls PHP sort() before partitioning modules by source/group.
  const sorted = uniqueNames(names).sort();
  const bySource = new Map();
  for (const name of sorted) {
    if (emitted.has(name)) continue;
    const record = records.get(name);
    if (!record) continue;
    const definition = moduleDefinition(root, record);
    const transport = resourceLoaderTransport(record, definition, queue);
    if (!bySource.has(transport.source)) bySource.set(transport.source, new Map());
    const byGroup = bySource.get(transport.source);
    if (!byGroup.has(transport.group)) byGroup.set(transport.group, []);
    byGroup.get(transport.group).push(name);
  }
  const ordered = [];
  for (const byGroup of bySource.values()) {
    for (const groupNames of byGroup.values()) {
      for (const name of groupNames) {
        if (emitted.has(name)) continue;
        emitted.add(name);
        ordered.push(name);
      }
    }
  }
  return ordered;
}

function pageStyleBatchRoots(root, batch, phasesById) {
  const roots = [];
  for (const phaseId of batch.phases || []) {
    const phase = phasesById.get(phaseId);
    if (!phase) throw new Error(`Page style batch ${batch.id} references missing phase: ${phaseId}`);
    for (const source of phase.sources || []) roots.push(...modulesFromQueueSource(root, source));
  }
  return roots;
}

function resolvePageStyleBatch(root, batch, phasesById, records, queue, emitted) {
  const roots = pageStyleBatchRoots(root, batch, phasesById);
  if (batch.ordering === 'preserve') {
    const ordered = [];
    for (const name of uniqueNames(roots)) {
      if (emitted.has(name) || !records.has(name)) continue;
      emitted.add(name);
      ordered.push(name);
    }
    return ordered;
  }
  if (batch.ordering === 'mediawiki-clienthtml-make-load') {
    return orderLikeClientHtmlMakeLoad(root, roots, records, queue, emitted);
  }
  if (batch.ordering === 'dependency-topological') {
    return resolvePageStyleDependencies(root, uniqueNames(roots), records, emitted);
  }
  throw new Error(`Unknown page style batch ordering: ${batch.ordering}`);
}

function relativeCssImport(fromOutput, toOutput) {
  let relative = path.posix.relative(path.posix.dirname(posix(fromOutput)), posix(toOutput));
  if (!relative.startsWith('.')) relative = `./${relative}`;
  return relative;
}


function validatePageStyleLifecycle(root, queue) {
  const phaseIndexes = new Map((queue.phases || []).map((phase, index) => [phase.id, index]));
  for (const assertion of queue.lifecycleAssertions || []) {
    if (assertion.kind !== 'php-method-call-order') {
      throw new Error(`Unknown page style lifecycle assertion kind: ${assertion.kind}`);
    }
    const text = fs.readFileSync(path.join(root, assertion.file), 'utf8');
    const method = phpMethodBody(text, assertion.method, assertion.file);
    let previousCallIndex = -1;
    let previousPhaseIndex = -1;
    for (const item of assertion.calls || []) {
      const callIndex = method.indexOf(item.call, previousCallIndex + 1);
      if (callIndex === -1) {
        const firstIndex = method.indexOf(item.call);
        if (firstIndex === -1) {
          throw new Error(`Lifecycle call ${item.call} is absent from ${assertion.file}::${assertion.method}`);
        }
        throw new Error(`Lifecycle call order changed in ${assertion.file}::${assertion.method}: ${item.call}`);
      }
      previousCallIndex = callIndex;
      if (item.phase) {
        const phaseIndex = phaseIndexes.get(item.phase);
        if (phaseIndex == null) throw new Error(`Lifecycle assertion references missing page style phase: ${item.phase}`);
        if (phaseIndex <= previousPhaseIndex) {
          throw new Error(`Page style phases do not follow ${assertion.file}::${assertion.method}: ${item.phase}`);
        }
        previousPhaseIndex = phaseIndex;
      }
    }
  }
}

export function compilePageStyleQueue(root, contract) {
  const queue = contract.pageStyleQueue;
  if (!queue) return null;
  if (queue.schema !== 2 || !queue.output || !Array.isArray(queue.phases) || !Array.isArray(queue.batches)) {
    throw new Error(`Unsupported or incomplete page style queue schema: ${queue.schema ?? 'none'}`);
  }
  validatePageStyleLifecycle(root, queue);
  const phasesById = new Map();
  for (const phase of queue.phases) {
    if (!phase?.id) throw new Error('Page style queue phase is missing id.');
    if (phasesById.has(phase.id)) throw new Error(`Duplicate page style queue phase: ${phase.id}`);
    phasesById.set(phase.id, phase);
  }
  const coveredPhases = new Set();
  const records = resourceOutputRecords(contract);
  const emitted = new Set();
  const lines = [
    `/* Generated mechanically from the MediaWiki page style queue profile ${queue.profile || 'default'}. */`,
    '/* Final ordering includes ClientHtml::makeLoad module sorting and source/group partitioning. */',
    '/* Do not hand-order upstream ResourceLoader modules in the Vue stylesheet integration. */'
  ];
  for (const batch of queue.batches) {
    if (!batch?.id || !batch?.ordering || !Array.isArray(batch.phases)) {
      throw new Error('Page style queue batch is incomplete.');
    }
    for (const phaseId of batch.phases) {
      if (coveredPhases.has(phaseId)) throw new Error(`Page style phase belongs to more than one batch: ${phaseId}`);
      coveredPhases.add(phaseId);
    }
    const names = resolvePageStyleBatch(root, batch, phasesById, records, queue, emitted);
    if (names.length === 0) continue;
    lines.push('', `/* ResourceLoader load batch: ${batch.id} (${batch.ordering}) */`);
    for (const name of names) {
      const record = records.get(name);
      lines.push(`@import "${relativeCssImport(queue.output, record.output)}";`);
    }
  }
  const uncovered = [...phasesById.keys()].filter((phaseId) => !coveredPhases.has(phaseId));
  if (uncovered.length) throw new Error(`Page style phases are not assigned to a load batch: ${uncovered.join(', ')}`);
  return `${lines.join('\n')}\n`;
}

function compileBundle(root, bundle) {
  const content = bundle.sources.map((source) => fs.readFileSync(path.join(root, source), 'utf8').trim()).join('\n\n');
  return withGeneratedCssBanner(normalizeCssSelectors(content), {
    banner: `/* Generated mechanically from CSS bundle ${bundle.name}. */`,
    moduleName: bundle.name
  });
}

function compileMessageCatalog(root, contract, keys) {
  const catalog = contract.messageCatalog;
  if (!catalog) return null;
  const languages = {};
  for (const [language, definition] of Object.entries(catalog.languages || {})) {
    const source = readJson(root, definition.source);
    const messages = {};
    for (const key of keys) {
      if (typeof source[key] === 'string') messages[key] = source[key];
      else if (!definition.fallback) messages[key] = `⧼${key}⧽`;
    }
    languages[language] = {
      ...(definition.fallback ? { fallback: definition.fallback } : {}),
      messages
    };
  }
  return `${JSON.stringify({ schema: 1, languages }, null, 2)}\n`;
}


function assetOutputs(root, assets) {
  const outputs = [];
  for (const mapping of assets || []) {
    const sourceRoot = path.join(root, mapping.source);
    for (const source of walkFiles(sourceRoot)) {
      outputs.push({
        source,
        output: path.join(root, mapping.output, path.relative(sourceRoot, source))
      });
    }
  }
  return outputs;
}

function materializeAssets(root, assets, check) {
  for (const entry of assetOutputs(root, assets)) {
    if (check) {
      if (!fs.existsSync(entry.output) || !fs.readFileSync(entry.output).equals(fs.readFileSync(entry.source))) {
        throw new Error(`Generated ResourceLoader asset is stale: ${path.relative(root, entry.output)}`);
      }
    } else {
      fs.mkdirSync(path.dirname(entry.output), { recursive: true });
      fs.copyFileSync(entry.source, entry.output);
    }
  }
}

function writeOrCheck(root, output, content, check) {
  const absolute = path.join(root, output);
  if (check) {
    const current = fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : '';
    if (current !== content) throw new Error(`Generated ResourceLoader output is stale: ${output}`);
  } else {
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, 'utf8');
    console.log(`generated ${output}`);
  }
}

export async function generateResourceLoaderOrigins({ root, contractPath, check = false }) {
  const contract = resolveResourceLoaderOriginContract(root, readJson(root, contractPath));
  assertResourceLoaderOriginContractSchema(contract.schema);
  const generatedRoot = path.join(root, contract.generatedRoot);
  if (!check) fs.rmSync(generatedRoot, { recursive: true, force: true });
  const expected = new Set();
  const generatedCss = [];
  const lessMessages = new Set();
  const moduleMessages = new Set();
  const messageModuleNames = new Set(contract.messageCatalog?.moduleNames || []);
  const pending = [];

  for (const module of contract.modules || []) {
    expected.add(posix(module.output));
    for (const asset of assetOutputs(root, module.assets)) expected.add(posix(path.relative(root, asset.output)));
    const compiled = await compileModule(root, contract, module);
    generatedCss.push(compiled.css);
    for (const key of compiled.lessMessages) lessMessages.add(key);
    if (messageModuleNames.has(module.name)) {
      for (const key of compiled.messages) moduleMessages.add(key);
    }
    pending.push({ output: module.output, content: compiled.css });
    materializeAssets(root, module.assets, check);
  }
  for (const bundle of contract.bundles || []) {
    expected.add(posix(bundle.output));
    const css = compileBundle(root, bundle);
    generatedCss.push(css);
    pending.push({ output: bundle.output, content: css });
  }
  if (contract.customPropertyClosure) {
    expected.add(posix(contract.customPropertyClosure.output));
    const css = await compileCustomPropertyClosure(root, contract, generatedCss);
    generatedCss.push(css);
    pending.push({ output: contract.customPropertyClosure.output, content: css });
  }
  if (contract.messageCatalog) {
    expected.add(posix(contract.messageCatalog.output));
    pending.push({
      output: contract.messageCatalog.output,
      content: compileMessageCatalog(
        root,
        contract,
        [...new Set([...lessMessages, ...moduleMessages])].sort()
      )
    });
  }
  const pageStyleQueue = compilePageStyleQueue(root, contract);
  if (pageStyleQueue !== null) {
    expected.add(posix(contract.pageStyleQueue.output));
    pending.push({ output: contract.pageStyleQueue.output, content: pageStyleQueue });
  }
  for (const item of pending) writeOrCheck(root, item.output, item.content, check);
  if (check) {
    const actual = new Set(walkFiles(generatedRoot).map((file) => posix(path.relative(root, file))));
    for (const output of expected) {
      if (!output.startsWith(`${posix(contract.generatedRoot).replace(/\/$/, '')}/`)) continue;
      if (!actual.has(output)) throw new Error(`ResourceLoader output inventory mismatch; missing=${output}`);
    }
    const expectedUnderRoot = new Set([...expected].filter((file) => file.startsWith(`${posix(contract.generatedRoot).replace(/\/$/, '')}/`)));
    const extra = [...actual].filter((file) => !expectedUnderRoot.has(file));
    if (extra.length) throw new Error(`ResourceLoader output inventory mismatch; extra=${extra.join(',')}`);
  }
  return { outputs: [...expected].sort() };
}
