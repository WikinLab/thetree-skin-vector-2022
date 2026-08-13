#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFirstPhpArrayAfter } from './php-array-literal.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'ORIGIN-MANIFEST.json');
const previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const upstreamLock = JSON.parse(fs.readFileSync(path.join(root, 'UPSTREAM-LOCK.json'), 'utf8'));
const vectorCheckoutCandidate = path.join(root, '.upstream', 'mediawiki-skins-Vector');
const vectorCheckout = fs.existsSync(vectorCheckoutCandidate)
  ? vectorCheckoutCandidate
  : path.resolve(root, '..', 'workspace-local', 'vector-rel1_46');
const toPosix = (value) => String(value).replaceAll('\\', '/');

function visibleSourceFiles() {
  const result = spawnSync('git', [
    '-c', `safe.directory=${root.replaceAll('\\', '/')}`,
    'ls-files', '--cached', '--others', '--exclude-standard', '-z'
  ], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.split('\0')
    .filter(Boolean)
    .map(toPosix)
    .filter((pathname) => fs.existsSync(path.join(root, pathname)))
    .sort();
}

function role(pathname) {
  if (pathname.startsWith('tools/')) return 'generation-tool';
  if (pathname.startsWith('contracts/upstream-build-toolchains/')) return 'upstream-build-contract';
  if (pathname.startsWith('contracts/')) return 'generation-contract';
  if (pathname.startsWith('lib/mustacheVueRuntime')) return 'origin-runtime';
  if (pathname.startsWith('lib/') || pathname.startsWith('components/')) return 'host-adapter';
  if (pathname === 'layout.vue' || pathname.startsWith('css/')) return 'skin-integration';
  return 'package-metadata';
}

function walk(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const pathname = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walk(pathname));
    else if (entry.isFile()) output.push(pathname);
  }
  return output;
}

const retainedVendor = (previous.sourceInventory?.vendorFiles || []).filter((entry) => (
  ['mediawiki', 'design-codex'].includes(entry.repository)
));
const vendorByPath = new Map(retainedVendor.map((entry) => [entry.path, entry]));
const addVendor = (entry) => vendorByPath.set(entry.path, entry);

const templateRoot = path.join(vectorCheckout, 'includes', 'templates');
const templateFiles = walk(templateRoot).filter((pathname) => pathname.endsWith('.mustache')).sort();
for (const absolute of templateFiles) {
  const upstreamPath = toPosix(path.relative(vectorCheckout, absolute));
  addVendor({
    path: `vendor/mediawiki-vector-2022/${upstreamPath}`,
    status: 'mirrored',
    repository: 'mediawiki-skins-Vector',
    upstreamPath
  });
}

const vectorSeeds = [
  'skin.json',
  'includes/Constants.php',
  'includes/SkinVector22.php',
  'i18n/en.json',
  'i18n/ko.json',
  'resources/mediawiki.less/vector/mediawiki.skin.variables.less',
  'resources/skins.vector.styles/CSSCustomProperties.less',
  'resources/skins.vector.styles/skin.less',
  'resources/skins.vector.js/index.less',
  'resources/skins.vector.clientPreferences/clientPreferences.less'
];
for (const upstreamPath of vectorSeeds) {
  addVendor({
    path: `vendor/mediawiki-vector-2022/${upstreamPath}`,
    status: 'mirrored',
    repository: 'mediawiki-skins-Vector',
    upstreamPath
  });
}

for (const relativeRoot of ['includes/Components', 'resources/skins.vector.js', 'resources/skins.vector.clientPreferences', 'resources/skins.vector.search']) {
  for (const absolute of walk(path.join(vectorCheckout, relativeRoot))) {
    const upstreamPath = toPosix(path.relative(vectorCheckout, absolute));
    addVendor({
      path: `vendor/mediawiki-vector-2022/${upstreamPath}`,
      status: 'mirrored',
      repository: 'mediawiki-skins-Vector',
      upstreamPath
    });
  }
}

for (const name of ['theme-wikimedia-ui-mixin-dark.less', 'theme-wikimedia-ui-mixin-light.less']) {
  addVendor({
    path: `vendor/wikimedia-codex/packages/codex-design-tokens/dist/${name}`,
    status: 'built',
    repository: 'design-codex',
    buildPath: `packages/codex-design-tokens/dist/${name}`
  });
}
for (const name of [
  'accessibility.less',
  'normalize.less',
  'content.media-dark.less',
  'content.body.less',
  'content.tables.less',
  'interface.less',
  'interface.category.less',
  'i18n-ordered-lists.less'
]) {
  addVendor({
    path: `vendor/mediawiki-core/resources/src/mediawiki.skinning/${name}`,
    status: 'mirrored',
    repository: 'mediawiki',
    upstreamPath: `resources/src/mediawiki.skinning/${name}`
  });
}
for (const upstreamPath of [
  'languages/i18n/nontranslatable/en.json',
  'languages/i18n/en.json',
  'languages/i18n/ko.json',
  'resources/src/mediawiki.page.ready/enableSearchDialog.js',
  'resources/src/mediawiki.skinning.typeaheadSearch/App.vue',
  'resources/src/mediawiki.skinning.typeaheadSearch/TypeaheadSearchWrapper.vue',
  'resources/lib/codex-icons/codex-icons.json'
]) {
  addVendor({
    path: `vendor/mediawiki-core/${upstreamPath}`,
    status: 'mirrored',
    repository: 'mediawiki',
    upstreamPath
  });
}
addVendor({
  path: 'vendor/mediawiki-core/resources/lib/codex/modules/manifest.json',
  status: 'mirrored', repository: 'mediawiki', upstreamPath: 'resources/lib/codex/modules/manifest.json'
});

const mediawikiCheckoutCandidate = path.join(root, '.upstream', 'mediawiki');
const mediawikiCheckout = fs.existsSync(path.join(mediawikiCheckoutCandidate, 'resources', 'Resources.php'))
  ? mediawikiCheckoutCandidate
  : path.resolve(root, '..', 'workspace-local', 'official-mediawiki-1.46.0', 'mediawiki-1.46.0');
const resourcesSource = fs.readFileSync(path.join(mediawikiCheckout, 'resources', 'Resources.php'), 'utf8');
const resourceContract = JSON.parse(fs.readFileSync(path.join(root, 'contracts', 'resource-loader-origin-contract.json'), 'utf8'));
const metadataCheckoutBySourceBase = new Map([
  ['vendor/mediawiki-vector-2022', vectorCheckout],
  ['vendor/mediawiki-core', mediawikiCheckout]
]);
const metadataDocumentCache = new Map();

function readResourceModuleMetadata(definition) {
  const checkout = metadataCheckoutBySourceBase.get(definition.sourceBase);
  if (!checkout) {
    throw new Error(`ResourceLoader metadata source base has no locked checkout: ${definition.sourceBase}`);
  }
  const relative = path.posix.relative(definition.sourceBase, definition.metadata);
  if (relative.startsWith('../') || path.posix.isAbsolute(relative)) {
    throw new Error(`ResourceLoader metadata escapes its declared source base: ${definition.metadata}`);
  }
  const absolute = path.join(checkout, ...relative.split('/'));
  if (definition.metadataKind === 'php-resource-modules') {
    const source = metadataDocumentCache.get(absolute) || fs.readFileSync(absolute, 'utf8');
    metadataDocumentCache.set(absolute, source);
    return parseFirstPhpArrayAfter(source, `'${definition.name}' =>`);
  }
  const document = metadataDocumentCache.get(absolute) || JSON.parse(fs.readFileSync(absolute, 'utf8'));
  metadataDocumentCache.set(absolute, document);
  const metadataRoot = definition.metadataRoot || 'ResourceModules';
  const modules = metadataRoot.split('.').reduce((value, key) => value?.[key], document);
  const module = modules?.[definition.name];
  if (!module) {
    throw new Error(`ResourceLoader module is missing from locked metadata: ${definition.name}`);
  }
  return module;
}

const declaredCodexComponents = new Set();
for (const definition of resourceContract.modules) {
  const metadata = readResourceModuleMetadata(definition);
  for (const component of metadata.codexComponents || []) declaredCodexComponents.add(component);
}
const codexManifest = JSON.parse(fs.readFileSync(
  path.join(mediawikiCheckout, 'resources', 'lib', 'codex', 'modules', 'manifest.json'),
  'utf8'
));
const codexEntryByComponent = new Map(
  Object.entries(codexManifest)
    .filter(([, entry]) => entry?.isEntry && typeof entry.name === 'string')
    .map(([key, entry]) => [entry.name, key])
);
const codexEntryByFile = new Map(
  Object.entries(codexManifest)
    .filter(([, entry]) => typeof entry?.file === 'string')
    .map(([key, entry]) => [entry.file, key])
);
const codexClosureFiles = new Set();
const visitedCodexEntries = new Set();
function visitCodexEntry(key, visited = visitedCodexEntries, files = codexClosureFiles) {
  if (visited.has(key)) return;
  const entry = codexManifest[key];
  if (!entry) throw new Error(`Codex manifest dependency is missing: ${key}`);
  visited.add(key);
  if (typeof entry.file === 'string') files.add(entry.file);
  for (const css of entry.css || []) files.add(css);
  for (const dependency of entry.imports || []) visitCodexEntry(dependency, visited, files);
}
for (const component of [...declaredCodexComponents].sort()) {
  const key = codexEntryByComponent.get(component);
  if (!key) throw new Error(`Declared Codex component is missing from the locked manifest: ${component}`);
  visitCodexEntry(key);
}
for (const name of [...codexClosureFiles].sort()) {
  addVendor({
    path: `vendor/mediawiki-core/resources/lib/codex/modules/${name}`,
    status: 'mirrored', repository: 'mediawiki', upstreamPath: `resources/lib/codex/modules/${name}`
  });
}

function partialDependencies(absolute) {
  const source = fs.readFileSync(absolute, 'utf8');
  const names = [...source.matchAll(/{{>\s*([^}\s]+)\s*}}/g)].map((match) => match[1]);
  return [...new Set(names)].sort().map((name) => `vendor/mediawiki-vector-2022/includes/templates/${name}.mustache`);
}

const mustacheOutputs = templateFiles.map((absolute) => {
  const relative = toPosix(path.relative(templateRoot, absolute));
  const input = `vendor/mediawiki-vector-2022/includes/templates/${relative}`;
  return {
    path: `components/${relative.slice(0, -'.mustache'.length)}.vue`,
    originNode: 'mustache-components',
    input,
    partialDependencies: partialDependencies(absolute)
  };
});

const resourceOutputs = [
  ...resourceContract.modules.map((module) => module.output),
  ...resourceContract.modules.flatMap((module) => (module.assets || []).flatMap((mapping) => {
    const sourceRoot = path.join(vectorCheckout, mapping.source.replace('vendor/mediawiki-vector-2022/', ''));
    return walk(sourceRoot).map((source) => toPosix(path.join(mapping.output, path.relative(sourceRoot, source))));
  })),
  resourceContract.customPropertyClosure.output,
  resourceContract.messageCatalog.output,
  resourceContract.pageStyleQueue.output
].map((pathname) => ({ path: toPosix(pathname), originNode: 'resource-loader-css' }));

const codexBundleContract = JSON.parse(fs.readFileSync(
  path.join(root, 'contracts', 'commonjs-esm-origin-contract.json'),
  'utf8'
));
const codexBundleOutputs = codexBundleContract.bundles.map((definition) => {
  const primaryInput = Object.values(definition.exports)[0];
  const visited = new Set();
  const files = new Set();
  for (const input of Object.values(definition.exports)) {
    const relative = path.posix.relative(resourceContract.shared.codexModuleRoot, input);
    if (relative.startsWith('../') || path.posix.isAbsolute(relative)) {
      throw new Error(`Codex bundle input escapes the declared module root: ${input}`);
    }
    const key = codexEntryByFile.get(relative);
    if (!key) throw new Error(`Codex bundle entry is missing from the locked manifest: ${input}`);
    visitCodexEntry(key, visited, files);
  }
  const dependencies = [...files]
    .filter((name) => /\.(?:c?js)$/.test(name))
    .map((name) => `${resourceContract.shared.codexModuleRoot}/${name}`)
    .filter((input) => input !== primaryInput)
    .sort();
  return {
    path: definition.output,
    originNode: 'mediawiki-codex-esm',
    input: primaryInput,
    dependencies
  };
});

const typeaheadContract = JSON.parse(fs.readFileSync(
  path.join(root, 'contracts', 'mediawiki-typeahead-search-contract.json'),
  'utf8'
));
const typeaheadOutputs = typeaheadContract.components.map((definition) => ({
  path: definition.output,
  originNode: 'mediawiki-typeahead-search',
  input: definition.input,
  dependencies: [...new Set([
    ...Object.values(definition.modules || {}).flatMap((mapping) => {
      if (typeof mapping.source === 'string') return [mapping.source];
      return Object.values(mapping.exports || {}).filter((source) => typeof source === 'string');
    }),
    ...Object.values(definition.globals || {}).flatMap((mapping) => (
      typeof mapping.source === 'string' ? [mapping.source] : []
    )),
    ...(definition.mixins || [])
  ])].sort()
}));

const messageContract = JSON.parse(fs.readFileSync(
  path.join(root, 'contracts', 'message-origin-contract.json'),
  'utf8'
));
const messageSources = Object.values(messageContract.languages)
  .flatMap((definition) => definition.sources || []);
const messageOutput = {
  path: messageContract.output,
  originNode: 'mediawiki-vector-messages',
  input: messageSources[0],
  dependencies: [...new Set(messageSources.slice(1))].sort()
};

const javascriptOutputs = [
  {
    path: 'lib/generated/vector-client-preferences.js',
    originNode: 'vector-javascript-ports',
    input: 'vendor/mediawiki-vector-2022/resources/skins.vector.clientPreferences/clientPreferences.js',
    dependencies: [],
    transform: {
      kind: 'commonjs-object-exports',
      exportNames: ['bind', 'toggleDocClassAndSave', 'render']
    }
  },
  {
    path: 'lib/generated/vector-client-preferences-config.js',
    originNode: 'vector-javascript-ports',
    input: 'vendor/mediawiki-vector-2022/resources/skins.vector.js/clientPreferences.json',
    dependencies: [],
    transform: { kind: 'json-default' }
  }
];

const generatedPaths = new Set([
  ...mustacheOutputs,
  ...resourceOutputs,
  ...codexBundleOutputs,
  ...typeaheadOutputs,
  messageOutput,
  ...javascriptOutputs
].map((entry) => entry.path));
const portedFiles = [];
const portedPaths = new Set(portedFiles.map((entry) => entry.path));
const localFiles = visibleSourceFiles()
  .filter((pathname) => !generatedPaths.has(pathname) && !portedPaths.has(pathname))
  .map((pathname) => ({
    path: pathname,
    kind: role(pathname),
    hostDependency: pathname.startsWith('lib/') || pathname.startsWith('components/') || pathname === 'layout.vue' || pathname.startsWith('css/')
      ? 'thetree'
      : 'none'
  }));

const manifest = {
  schema: 35,
  title: 'thetree Vector 2022 standalone bootstrap source manifest',
  upstreamLockFile: 'UPSTREAM-LOCK.json',
  hostLock: previous.hostLock,
  distribution: {
    mode: 'bootstrap-source-only',
    snapshotDate: upstreamLock.snapshotDate,
    releaseLine: upstreamLock.releaseLine,
    officialDistribution: upstreamLock.officialDistribution,
    vendorIncluded: false,
    generatedOutputsIncluded: false,
    runtimeAssetsIncluded: false,
    upstreamCheckoutsIncluded: false,
    bootstrap: 'npm run bootstrap',
    vendorProvenance: 'git-checkout-only',
    upstreamBuildOutputsIncluded: false
  },
  sourceInventory: {
    schema: 22,
    sourceCoverage: {
      schema: 1,
      root: '.',
      declaredInventories: ['sourceInventory.localFiles', 'sourceInventory.portedFiles'],
      excludedInventories: ['sourceInventory.generatedFiles', 'sourceInventory.materializedRuntimeAssets'],
      ignoredRoots: ['.build-tools', '.git', '.test-dist', '.test-host', '.upstream', 'node_modules', 'vendor'],
      inventoryContracts: [
        {
          inventory: 'sourceInventory.localFiles',
          requiredFields: ['path', 'kind', 'hostDependency'],
          allowedValues: {
            kind: ['package-metadata', 'skin-integration', 'host-adapter', 'origin-runtime', 'generation-tool', 'generation-contract', 'upstream-build-contract']
          }
        },
        {
          inventory: 'sourceInventory.portedFiles',
          requiredFields: ['path', 'kind', 'relation', 'hostDependency', 'repository', 'automationStatus', 'license', 'modifiedDates', 'differenceClasses', 'originInputs'],
          requiredAnyFields: ['upstreamPath', 'upstreamPaths'],
          allowedValues: { kind: ['source-port'], automationStatus: ['adapter-required'] }
        }
      ]
    },
    vendorLessClosure: {
      schema: 3,
      seeds: 'declared-less-files',
      repositoryDiscoveryPatterns: ['**/*.less', '**/*.css'],
      parser: 'less-ast',
      resolution: 'shared-resource-loader-resolver',
      compilation: 'less-import-manager',
      materialization: 'one-upstream-file-to-one-vendor-file'
    },
    vendorFiles: [...vendorByPath.values()].sort((a, b) => a.path.localeCompare(b.path, 'en')),
    portedFiles,
    localFiles,
    generatedFiles: [
      ...mustacheOutputs,
      ...resourceOutputs,
      ...codexBundleOutputs,
      ...typeaheadOutputs,
      messageOutput,
      ...javascriptOutputs
    ].sort((a, b) => a.path.localeCompare(b.path, 'en')),
    materializedRuntimeAssets: []
  },
  generation: {
    schema: 1,
    entrypoint: 'tools/generate-origin.mjs',
    nodes: [
      {
        id: 'mustache-components',
        kind: 'mustache-vue-directory',
        dependsOn: [],
        inputRoot: 'vendor/mediawiki-vector-2022/includes/templates',
        outputRoot: 'components',
        inputExtension: '.mustache',
        outputExtension: '.vue',
        outputInventory: 'sourceInventory.generatedFiles',
        inputInventory: 'sourceInventory.vendorFiles',
        partialResolution: 'template-root-name',
        outputRelationContract: { inputField: 'input', dependenciesField: 'partialDependencies' }
      },
      {
        id: 'resource-loader-css',
        kind: 'resource-loader-origin',
        dependsOn: [],
        contract: 'contracts/resource-loader-origin-contract.json',
        outputInventory: 'sourceInventory.generatedFiles'
      },
      {
        id: 'mediawiki-codex-esm',
        kind: 'commonjs-esm-origin',
        dependsOn: [],
        contract: 'contracts/commonjs-esm-origin-contract.json',
        outputInventory: 'sourceInventory.generatedFiles',
        outputRelationContract: { inputField: 'input', dependenciesField: 'dependencies' }
      },
      {
        id: 'mediawiki-typeahead-search',
        kind: 'vue-sfc-origin',
        dependsOn: ['mediawiki-codex-esm'],
        contract: 'contracts/mediawiki-typeahead-search-contract.json',
        outputInventory: 'sourceInventory.generatedFiles',
        outputRelationContract: { inputField: 'input', dependenciesField: 'dependencies' }
      },
      {
        id: 'mediawiki-vector-messages',
        kind: 'message-origin',
        dependsOn: [],
        contract: 'contracts/message-origin-contract.json',
        outputInventory: 'sourceInventory.generatedFiles',
        outputRelationContract: { inputField: 'input', dependenciesField: 'dependencies' }
      },
      {
        id: 'vector-javascript-ports',
        kind: 'javascript-ports',
        dependsOn: [],
        outputInventory: 'sourceInventory.generatedFiles',
        outputRelationContract: { inputField: 'input', dependenciesField: 'dependencies' }
      }
    ]
  },
  integration: {
    schema: 1,
    skinVariant: {
      schema: 1,
      contract: 'contracts/skin-variant-contract.json',
      runtimeModule: 'lib/skinVariant.js',
      consumer: 'components/Vector2022VariantLayout.vue',
      activationAttribute: 'data-tt-skin-variant'
    },
    moduleGraph: {
      schema: 1,
      ignoredRoots: ['.build-tools', '.git', '.test-dist', '.test-host', '.upstream', 'node_modules', 'vendor'],
      allowedBareSpecifiers: ['vue'],
      allowedSpecifierPrefixes: ['node:', '~/']
    },
    stylesheetDelivery: {
      schema: 1,
      mode: 'ordered-vue-style-src',
      selection: 'build-time-static',
      profile: 'vector-2022',
      consumer: 'components/Vector2022VariantLayout.vue',
      originBundle: 'css/vendor/resource-loader/page-styles.css',
      adapterStyles: ['css/vector-2022-adapter.css', 'css/host-content.css', 'css/host-modal.css'],
      resourceLoaderContract: 'contracts/resource-loader-origin-contract.json',
      hostLimitation: 'Vite resolves each ordered style source from the skin component; Vector 2022 owns chrome while host content remains isolated under thetree ownership.'
    }
  }
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Synchronized ${path.relative(root, manifestPath)}.`);
