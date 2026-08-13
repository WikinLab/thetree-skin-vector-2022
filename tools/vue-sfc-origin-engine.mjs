import fs from 'node:fs';
import path from 'node:path';

function normalize(source) {
  return String(source).replace(/\r\n?/g, '\n').replace(/\s*$/, '');
}

function relativeImport(from, to) {
  let value = path.posix.relative(path.posix.dirname(from), to.replaceAll('\\', '/'));
  if (!value.startsWith('.')) value = `./${value}`;
  return value;
}

function extractSingleBlock(source, tag, filename) {
  const topLevelPattern = new RegExp(`^<${tag}\\b[^>]*>`, 'gmi');
  const openers = [...source.matchAll(topLevelPattern)];
  if (openers.length !== 1) {
    throw new Error(`${filename} requires exactly one top-level <${tag}> block; found ${openers.length}.`);
  }
  const opener = openers[0];
  const start = opener.index + opener[0].length;
  const tokenPattern = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi');
  tokenPattern.lastIndex = start;
  let depth = 1;
  for (let token = tokenPattern.exec(source); token; token = tokenPattern.exec(source)) {
    if (token[0].startsWith('</')) depth -= 1;
    else if (!token[0].endsWith('/>')) depth += 1;
    if (depth === 0) return source.slice(start, token.index);
  }
  throw new Error(`${filename} has an unclosed top-level <${tag}> block.`);
}

function parseBindings(source, owner) {
  return source.split(',').map((binding) => binding.trim()).filter(Boolean).map((binding) => {
    const match = /^([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*:\s*([A-Za-z_$][A-Za-z0-9_$]*))?$/.exec(binding);
    if (!match) throw new Error(`${owner} has unsupported CommonJS destructuring binding: ${binding}`);
    return { imported: match[1], local: match[2] || match[1] };
  });
}

function splitTopLevelComma(source, owner) {
  const parts = [];
  let start = 0;
  let quote = '';
  let escaped = false;
  const depths = { '(': 0, '[': 0, '{': 0 };
  const closing = { ')': '(', ']': '[', '}': '{' };
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (Object.hasOwn(depths, character)) {
      depths[character] += 1;
      continue;
    }
    if (Object.hasOwn(closing, character)) {
      const opener = closing[character];
      depths[opener] -= 1;
      if (depths[opener] < 0) throw new Error(`${owner} has an unbalanced require declaration.`);
      continue;
    }
    if (character === ',' && Object.values(depths).every((depth) => depth === 0)) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quote || Object.values(depths).some((depth) => depth !== 0)) {
    throw new Error(`${owner} has an unbalanced require declaration.`);
  }
  parts.push(source.slice(start).trim());
  return parts.filter(Boolean);
}

function renderRequireImports(script, output, modules, owner) {
  const imports = [];
  const dependencies = new Set();
  let moduleIndex = 0;
  const renderDestructured = (bindingSource, specifier) => {
    const mapping = modules?.[specifier];
    if (!mapping) throw new Error(`${owner} imports unmapped CommonJS module ${specifier}.`);
    const bindings = parseBindings(bindingSource, owner);
    if (mapping.kind === 'named') {
      const from = typeof mapping.source === 'string' && mapping.source
        ? relativeImport(output, mapping.source)
        : mapping.from;
      if (typeof from !== 'string' || !from) {
        throw new Error(`${owner} named mapping for ${specifier} lacks source or from.`);
      }
      imports.push(`import { ${bindings.map(({ imported, local }) => (
        imported === local ? imported : `${imported} as ${local}`
      )).join(', ')} } from '${from}';`);
      if (mapping.source) dependencies.add(mapping.source);
      return;
    }
    if (mapping.kind === 'default-object') {
      if (typeof mapping.source !== 'string' || !mapping.source) {
        throw new Error(`${owner} default-object mapping for ${specifier} lacks source.`);
      }
      const identifier = `__originModule${moduleIndex++}`;
      imports.push(`import ${identifier} from '${relativeImport(output, mapping.source)}';`);
      imports.push(`const { ${bindings.map(({ imported, local }) => (
        imported === local ? imported : `${imported}: ${local}`
      )).join(', ')} } = ${identifier};`);
      dependencies.add(mapping.source);
      return;
    }
    if (mapping.kind === 'default-files') {
      for (const { imported, local } of bindings) {
        const source = mapping.exports?.[imported];
        if (typeof source !== 'string' || !source) {
          throw new Error(`${owner} default-files mapping for ${specifier} lacks export ${imported}.`);
        }
        imports.push(`import ${local} from '${relativeImport(output, source)}';`);
        dependencies.add(source);
      }
      return;
    }
    throw new Error(`${owner} has unsupported CommonJS mapping kind ${mapping.kind || 'none'} for ${specifier}.`);
  };
  const renderDefault = (local, specifier) => {
    const mapping = modules?.[specifier];
    if (!mapping) throw new Error(`${owner} imports unmapped CommonJS module ${specifier}.`);
    if (mapping.kind !== 'default' || typeof mapping.source !== 'string' || !mapping.source) {
      throw new Error(`${owner} default require mapping for ${specifier} lacks a default source.`);
    }
    imports.push(`import ${local} from '${relativeImport(output, mapping.source)}';`);
    dependencies.add(mapping.source);
  };
  const declarationPattern = /\b(?:const|let|var)\s+([^;]+);/g;
  const transformed = script.replace(declarationPattern, (statement, declarationSource) => {
    if (!declarationSource.includes('require(')) return statement;
    for (const declarator of splitTopLevelComma(declarationSource, owner)) {
      const destructured = /^\{\s*([^}]+?)\s*\}\s*=\s*require\(\s*(['"])([^'"]+)\2\s*\)$/.exec(declarator);
      if (destructured) {
        renderDestructured(destructured[1], destructured[3]);
        continue;
      }
      const direct = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*require\(\s*(['"])([^'"]+)\2\s*\)$/.exec(declarator);
      if (direct) {
        renderDefault(direct[1], direct[3]);
        continue;
      }
      throw new Error(`${owner} has an unsupported CommonJS require declarator: ${declarator}`);
    }
    return '';
  });
  if (/\brequire\s*\(/.test(transformed)) {
    throw new Error(`${owner} contains a CommonJS require form not supported by the structural converter.`);
  }
  return { script: transformed, imports, dependencies: [...dependencies].sort() };
}

function renderEnvironmentImports(definition, output, owner) {
  const imports = [];
  const dependencies = new Set();
  let mixinIndex = 0;
  for (const [identifier, mapping] of Object.entries(definition.globals || {})) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(identifier)) {
      throw new Error(`${owner} has an invalid global adapter identifier: ${identifier}`);
    }
    if (mapping?.kind !== 'default' || typeof mapping.source !== 'string' || !mapping.source) {
      throw new Error(`${owner} global adapter ${identifier} must declare a default source.`);
    }
    imports.push(`import ${identifier} from '${relativeImport(output, mapping.source)}';`);
    dependencies.add(mapping.source);
  }
  const mixins = [];
  for (const source of definition.mixins || []) {
    if (typeof source !== 'string' || !source) throw new Error(`${owner} declares an invalid component mixin.`);
    const identifier = `__originMixin${mixinIndex++}`;
    imports.push(`import ${identifier} from '${relativeImport(output, source)}';`);
    dependencies.add(source);
    mixins.push(identifier);
  }
  return { imports, dependencies: [...dependencies].sort(), mixins };
}

function renderComponent(root, definition) {
  const input = definition.input?.replaceAll('\\', '/');
  const output = definition.output?.replaceAll('\\', '/');
  if (!input || !output) throw new Error(`Invalid Vue SFC origin definition: ${JSON.stringify(definition)}`);
  const absolute = path.join(root, input);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new Error(`Vue SFC origin input is missing: ${input}`);
  }
  const source = normalize(fs.readFileSync(absolute, 'utf8'));
  const template = extractSingleBlock(source, 'template', input);
  const script = extractSingleBlock(source, 'script', input);
  const converted = renderRequireImports(script, output, definition.modules, input);
  const environment = renderEnvironmentImports(definition, output, input);
  const exportPattern = /\bmodule\.exports\s*=\s*exports\s*=\s*defineComponent\s*\(/g;
  const matches = [...converted.script.matchAll(exportPattern)];
  if (matches.length !== 1) {
    throw new Error(`${input} requires exactly one CommonJS defineComponent export; found ${matches.length}.`);
  }
  let esmScript = converted.script.replace(exportPattern, 'export default defineComponent( ').trim();
  if (environment.mixins.length) {
    const optionsPattern = /export default defineComponent\(\s*\{/;
    if (!optionsPattern.test(esmScript)) throw new Error(`${input} has no object component options for mixin injection.`);
    esmScript = esmScript.replace(
      optionsPattern,
      `export default defineComponent( {\n\tmixins: [ ${environment.mixins.join(', ')} ],`
    );
  }
  if (/\b(?:module\.exports|exports\s*=)/.test(esmScript)) {
    throw new Error(`${input} retains a CommonJS export after conversion.`);
  }
  const content = [
    `<!-- @generated from ${input}; template and component options remain upstream-owned. -->`,
    '<template>',
    template.trim(),
    '</template>',
    '',
    '<script>',
    ...converted.imports,
    ...environment.imports,
    '',
    esmScript,
    '</script>',
    ''
  ].join('\n');
  return {
    input,
    output,
    content,
    dependencies: [...new Set([...converted.dependencies, ...environment.dependencies])].sort()
  };
}

function writeOutput(root, result, check) {
  const target = path.join(root, result.output);
  if (check) {
    if (!fs.existsSync(target) || normalize(fs.readFileSync(target, 'utf8')) !== normalize(result.content)) {
      throw new Error(`Generated Vue SFC origin is stale: ${result.output}`);
    }
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, result.content);
}

export function generateVueSfcOrigins({ root, contractPath, check = false }) {
  const contract = JSON.parse(fs.readFileSync(path.join(root, contractPath), 'utf8'));
  if (![1, 2].includes(contract.schema) || !Array.isArray(contract.components) || contract.components.length === 0) {
    throw new Error(`Unsupported or empty Vue SFC origin contract: ${contractPath}`);
  }
  const results = contract.components.map((definition) => renderComponent(root, definition));
  for (const result of results) writeOutput(root, result, check);
  return {
    inputs: [...new Set(results.flatMap((result) => [result.input, ...result.dependencies]))].sort(),
    outputs: results.map((result) => result.output).sort(),
    relations: results.map((result) => ({
      path: result.output,
      input: result.input,
      dependencies: result.dependencies
    })).sort((left, right) => left.path.localeCompare(right.path, 'en'))
  };
}
