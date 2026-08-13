import fs from 'node:fs';
import path from 'node:path';

import { probeResourceLoaderLessVariables } from './resource-loader-less.mjs';
import { findUnresolvedCssCustomPropertyReferences } from './resource-loader-output-adapter.mjs';
import { walkFiles } from './shared/files.mjs';

function localCssConsumers(root, contract) {
  const generatedRoot = path.resolve(root, contract.generatedRoot);
  const files = [];
  for (const relRoot of contract.customPropertyClosure?.localConsumerRoots || []) {
    for (const file of walkFiles(path.join(root, relRoot))) {
      const absolute = path.resolve(file);
      if (absolute === generatedRoot || absolute.startsWith(`${generatedRoot}${path.sep}`)) continue;
      if (file.endsWith('.css')) files.push(file);
    }
  }
  return files;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractStaticTemplateLiteral(source, constantName, sourcePath) {
  const pattern = new RegExp(
    '(?:const|let|var)\\s+' + escapeRegExp(constantName) + '\\s*=\\s*`([\\s\\S]*?)`\\s*;',
    'g'
  );
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`Static DOM origin must contain exactly one ${constantName} template literal: ${sourcePath}`);
  }
  const html = matches[0][1];
  if (html.includes('${')) throw new Error(`Static DOM origin template interpolation is unsupported: ${sourcePath}`);
  return html;
}

function extractStaticClassAssignment(source, assignment, sourcePath) {
  const target = escapeRegExp(assignment.target);
  const property = escapeRegExp(assignment.property || 'className');
  const pattern = new RegExp(`${target}\\.${property}\\s*=\\s*(['"])([^'"]*)\\1\\s*;`, 'g');
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(
      `Static DOM origin must contain exactly one ${assignment.target}.${assignment.property || 'className'} assignment: ${sourcePath}`
    );
  }
  return matches[0][2].trim().split(/\s+/).filter(Boolean);
}

function parseStaticHtmlClassTree(html, sourcePath) {
  const documentNode = { classes: new Set(), children: [] };
  const stack = [documentNode];
  const voidTags = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr'
  ]);
  const tokenPattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>]*>/g;
  for (const match of html.matchAll(tokenPattern)) {
    const token = match[0];
    if (token.startsWith('<!--') || token.startsWith('<!')) continue;
    const closing = /^<\//.test(token);
    const tagMatch = token.match(/^<\/?\s*([A-Za-z][\w:-]*)/);
    if (!tagMatch) continue;
    const tag = tagMatch[1].toLowerCase();
    if (closing) {
      if (stack.length === 1 || stack[stack.length - 1].tag !== tag) {
        throw new Error(`Static DOM origin has unbalanced closing tag </${tag}>: ${sourcePath}`);
      }
      stack.pop();
      continue;
    }
    const classes = new Set();
    const classMatch = token.match(/\bclass\s*=\s*(['"])([\s\S]*?)\1/i);
    if (classMatch) {
      for (const name of classMatch[2].trim().split(/\s+/)) {
        if (name) classes.add(name);
      }
    }
    const node = { tag, classes, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!/\/>\s*$/.test(token) && !voidTags.has(tag)) stack.push(node);
  }
  if (stack.length !== 1) throw new Error(`Static DOM origin has unclosed HTML elements: ${sourcePath}`);
  if (documentNode.children.length !== 1) {
    throw new Error(`Static DOM origin must contain exactly one root element: ${sourcePath}`);
  }
  return documentNode.children[0];
}

function addDomClassContainment(graph, node, ancestorClasses = []) {
  const currentClasses = [...node.classes];
  for (const ancestor of ancestorClasses) {
    const descendants = graph.get(ancestor) || new Set();
    for (const descendant of currentClasses) {
      if (ancestor !== descendant) descendants.add(descendant);
    }
    graph.set(ancestor, descendants);
  }
  const nextAncestors = [...new Set([...ancestorClasses, ...currentClasses])];
  for (const child of node.children) addDomClassContainment(graph, child, nextAncestors);
}

function deriveStaticDomClassContainment(root, compositions = []) {
  const graph = new Map();
  for (const composition of compositions) {
    const wrapperSource = fs.readFileSync(path.join(root, composition.wrapperSource), 'utf8');
    const wrapperRoot = parseStaticHtmlClassTree(
      extractStaticTemplateLiteral(wrapperSource, composition.wrapperTemplateConstant, composition.wrapperSource),
      composition.wrapperSource
    );
    const contentRootClasses = extractStaticClassAssignment(
      wrapperSource,
      composition.contentRootClassAssignment,
      composition.wrapperSource
    );
    for (const template of composition.contentTemplates || []) {
      const templateSource = fs.readFileSync(path.join(root, template.source), 'utf8');
      const contentRoot = parseStaticHtmlClassTree(
        extractStaticTemplateLiteral(templateSource, template.templateConstant, template.source),
        template.source
      );
      for (const className of contentRootClasses) contentRoot.classes.add(className);
      wrapperRoot.children.push(contentRoot);
    }
    addDomClassContainment(graph, wrapperRoot);
  }
  return graph;
}

function unresolvedCustomPropertyNames(root, contract, cssSources) {
  const hostPrefixes = contract.customPropertyClosure?.hostProvidedPrefixes || [];
  const domClassDescendants = deriveStaticDomClassContainment(
    root,
    contract.customPropertyClosure?.domCompositions || []
  );
  const unresolved = findUnresolvedCssCustomPropertyReferences(cssSources, { domClassDescendants });
  const runtimeProvided = runtimeProvidedCustomPropertyNames(root, contract, unresolved);
  return unresolved
    .filter((name) => !runtimeProvided.has(name))
    .filter((name) => !hostPrefixes.some((prefix) => name.startsWith(prefix)));
}

function runtimeProvidedCustomPropertyNames(root, contract, candidates) {
  const roots = contract.customPropertyClosure?.runtimeCustomPropertyProviderRoots || [];
  if (!roots.length || !candidates.length) return new Set();
  const sources = [];
  for (const relRoot of roots) {
    const absolute = path.join(root, relRoot);
    if (!fs.existsSync(absolute)) continue;
    const stat = fs.statSync(absolute);
    const files = stat.isDirectory() ? walkFiles(absolute) : [absolute];
    for (const file of files) {
      if (!/\.(?:c?js|mjs)$/.test(file)) continue;
      const source = fs.readFileSync(file, 'utf8');
      if (source.includes('useCssVars')) sources.push(source);
    }
  }
  const provided = new Set();
  for (const candidate of candidates) {
    const key = escapeRegExp(candidate.slice(2));
    const propertyPattern = new RegExp(`['"]${key}['"]\\s*:`);
    if (sources.some((source) => propertyPattern.test(source))) provided.add(candidate);
  }
  return provided;
}

function combinedCustomPropertyClosureRequirements(root, contract, generatedCss) {
  const localCss = localCssConsumers(root, contract).map((file) => fs.readFileSync(file, 'utf8'));
  return unresolvedCustomPropertyNames(root, contract, [...generatedCss, ...localCss]);
}

function uniqueProbeOptions(options) {
  const seen = new Set();
  return options.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function publishedLocalCustomPropertyNames(root, contract, candidates) {
  if (!candidates.length) return new Set();
  const entrypoints = contract.customPropertyClosure?.localPublishedLessTokenEntrypoints || [];
  if (!Array.isArray(entrypoints) || entrypoints.length === 0) {
    throw new Error(
      'ResourceLoader custom property closure requires localPublishedLessTokenEntrypoints ' +
      'when local CSS consumes upstream LESS tokens.'
    );
  }
  const names = new Set();
  const probes = entrypoints.map((entrypoint, index) => ({
    root,
    moduleName: `${contract.customPropertyClosure.name}-published-local-${index}`,
    entrypoint,
    preludeEntries: [],
    importPaths: [path.posix.dirname(entrypoint), ...contract.shared.importPaths],
    importAliases: contract.shared.importAliases
  }));
  for (const probe of uniqueProbeOptions(probes)) {
    const resolved = await probeResourceLoaderLessVariables(probe, candidates);
    for (const name of resolved.keys()) names.add(name);
  }
  return names;
}

function validateLocalCssCustomPropertyClosure(root, contract, generatedCss, shimCss) {
  const cssSources = [
    ...generatedCss,
    shimCss,
    ...localCssConsumers(root, contract).map((file) => fs.readFileSync(file, 'utf8'))
  ];
  const unresolved = unresolvedCustomPropertyNames(root, contract, cssSources);
  if (unresolved.length) {
    throw new Error(
      'Local adapter CSS references custom properties that are not supplied by generated upstream CSS, ' +
      `the authoritative skin shim, or the host contract: ${unresolved.join(', ')}`
    );
  }
}

export async function compileCustomPropertyClosure(root, contract, generatedCss) {
  const closure = contract.customPropertyClosure;
  if (!closure) return null;

  const generatedRequired = unresolvedCustomPropertyNames(root, contract, generatedCss);
  const combinedRequired = combinedCustomPropertyClosureRequirements(root, contract, generatedCss);
  const generatedRequiredSet = new Set(generatedRequired);
  const localOnlyRequired = combinedRequired.filter((name) => !generatedRequiredSet.has(name));
  const publishedLocalNames = await publishedLocalCustomPropertyNames(root, contract, localOnlyRequired);
  const unsupportedLocal = localOnlyRequired.filter((name) => !publishedLocalNames.has(name));
  if (unsupportedLocal.length) {
    throw new Error(
      'Local adapter CSS references custom properties that are neither supplied by generated upstream CSS ' +
      `nor declared by the published upstream LESS token contract: ${unsupportedLocal.join(', ')}`
    );
  }

  const entrypoints = closure.authoritativeLessEntrypoints || [];
  if (!Array.isArray(entrypoints) || entrypoints.length === 0) {
    throw new Error('ResourceLoader custom property closure requires authoritativeLessEntrypoints.');
  }
  const probes = entrypoints.map((entrypoint, index) => ({
    root,
    moduleName: `${closure.name}-authoritative-${index}`,
    entrypoint,
    preludeEntries: contract.shared.lessPreludeEntries,
    importPaths: [path.posix.dirname(entrypoint), ...contract.shared.importPaths],
    importAliases: contract.shared.importAliases
  }));
  const values = new Map();
  for (const probe of uniqueProbeOptions(probes)) {
    const resolved = await probeResourceLoaderLessVariables(probe, combinedRequired);
    for (const [name, value] of resolved) {
      const existing = values.get(name);
      if (existing != null && existing !== value) {
        throw new Error(
          `Authoritative skin LESS environments disagree for ResourceLoader custom property ${name}: ${existing} != ${value}`
        );
      }
      values.set(name, value);
    }
  }
  const unresolved = combinedRequired.filter((name) => !values.has(name));
  if (unresolved.length) {
    throw new Error(
      `Unable to derive ResourceLoader custom properties from authoritative skin LESS environments: ${unresolved.join(', ')}`
    );
  }
  const declarations = combinedRequired.map((name) => `  ${name}: ${values.get(name)};`);
  const shimCss = `/* Generated from the authoritative skin LESS variable closure. */\n:root {\n${declarations.join('\n')}\n}\n`;
  validateLocalCssCustomPropertyClosure(root, contract, generatedCss, shimCss);
  return shimCss;
}
