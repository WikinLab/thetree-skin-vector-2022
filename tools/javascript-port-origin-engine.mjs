import fs from 'node:fs';
import path from 'node:path';
import { compareCodePoints } from './shared/deterministic.mjs';

function normalizeSource(source) {
  return String(source).replace(/\r\n?/g, '\n').replace(/\s*$/, '');
}

function writeGeneratedFile(root, relativePath, content, check) {
  const target = path.join(root, relativePath);
  const normalized = `${normalizeSource(content)}\n`;
  if (check) {
    if (!fs.existsSync(target)) {
      throw new Error(`Missing generated JavaScript port: ${relativePath}`);
    }
    const current = fs.readFileSync(target, 'utf8').replace(/\r\n?/g, '\n');
    if (current !== normalized) {
      throw new Error(`Generated JavaScript port is stale: ${relativePath}`);
    }
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, normalized);
}

function findUniqueAnchor(source, anchor, owner) {
  const first = source.indexOf(anchor);
  if (first === -1) throw new Error(`${owner} no longer contains required anchor: ${anchor}`);
  if (source.indexOf(anchor, first + anchor.length) !== -1) {
    throw new Error(`${owner} contains duplicate anchor: ${anchor}`);
  }
  return first;
}

function findFunctionBodyStart(source, start, owner) {
  let state = 'normal';
  let parenthesisDepth = 0;
  let bracketDepth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === 'line-comment') {
      if (char === '\n') state = 'normal';
      continue;
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        state = 'normal';
        index += 1;
      }
      continue;
    }
    if (state === 'single-quote' || state === 'double-quote' || state === 'template') {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if ((state === 'single-quote' && char === "'")
        || (state === 'double-quote' && char === '"')
        || (state === 'template' && char === '`')) {
        state = 'normal';
      }
      continue;
    }
    if (char === '/' && next === '/') {
      state = 'line-comment';
      index += 1;
    } else if (char === '/' && next === '*') {
      state = 'block-comment';
      index += 1;
    } else if (char === "'") {
      state = 'single-quote';
    } else if (char === '"') {
      state = 'double-quote';
    } else if (char === '`') {
      state = 'template';
    } else if (char === '(') {
      parenthesisDepth += 1;
    } else if (char === ')') {
      parenthesisDepth -= 1;
      if (parenthesisDepth < 0) throw new Error(`${owner} function declaration has unbalanced parentheses.`);
    } else if (char === '[') {
      bracketDepth += 1;
    } else if (char === ']') {
      bracketDepth -= 1;
      if (bracketDepth < 0) throw new Error(`${owner} function declaration has unbalanced brackets.`);
    } else if (char === '{' && parenthesisDepth === 0 && bracketDepth === 0) {
      return index;
    }
  }
  throw new Error(`${owner} function declaration has no body.`);
}

function findBalancedFunctionEnd(source, bodyStart, owner) {
  let depth = 0;
  let state = 'normal';
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === 'line-comment') {
      if (char === '\n') state = 'normal';
      continue;
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        state = 'normal';
        index += 1;
      }
      continue;
    }
    if (state === 'single-quote' || state === 'double-quote' || state === 'template') {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if ((state === 'single-quote' && char === "'")
        || (state === 'double-quote' && char === '"')
        || (state === 'template' && char === '`')) {
        state = 'normal';
      }
      continue;
    }
    if (char === '/' && next === '/') {
      state = 'line-comment';
      index += 1;
    } else if (char === '/' && next === '*') {
      state = 'block-comment';
      index += 1;
    } else if (char === "'") {
      state = 'single-quote';
    } else if (char === '"') {
      state = 'double-quote';
    } else if (char === '`') {
      state = 'template';
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
      if (depth < 0) break;
    }
  }
  throw new Error(`${owner} function body is not balanced.`);
}

function extractExportedFunction(source, name, owner) {
  const anchor = `export function ${name}`;
  const start = findUniqueAnchor(source, anchor, owner);
  const bodyStart = findFunctionBodyStart(source, start + anchor.length, owner);
  const end = findBalancedFunctionEnd(source, bodyStart, owner);
  return source.slice(start, end).trimEnd();
}

function renderImports(imports = []) {
  return imports.map((entry) => {
    if (!Array.isArray(entry.names) || entry.names.length === 0 || typeof entry.from !== 'string') {
      throw new Error(`Invalid generated JavaScript import declaration: ${JSON.stringify(entry)}`);
    }
    return `import { ${entry.names.join(', ')} } from '${entry.from}';`;
  }).join('\n');
}

function renderCommonJsDefaultFunction(source, entry) {
  const exportName = entry.transform?.exportName;
  if (!exportName) throw new Error(`${entry.path} commonjs-default-function transform lacks exportName.`);
  return `/* Generated from ${entry.input}; upstream source is executed unchanged inside a CommonJS boundary. */
const __upstreamModule = { exports: {} };
const __upstreamRequire = ( moduleName ) => {
  throw new Error( 'Unsupported CommonJS dependency in ${entry.input}: ' + moduleName );
};
( function ( module, exports, require ) {
${normalizeSource(source)}
}( __upstreamModule, __upstreamModule.exports, __upstreamRequire ) );

const ${exportName} = __upstreamModule.exports;
if ( typeof ${exportName} !== 'function' ) {
  throw new TypeError( '${entry.input} no longer exports a function.' );
}

export { ${exportName} };
export default ${exportName};`;
}


function renderCommonJsObjectExports(source, entry) {
  const exportNames = entry.transform?.exportNames;
  if (!Array.isArray(exportNames) || exportNames.length === 0) {
    throw new Error(`${entry.path} commonjs-object-exports transform lacks exportNames.`);
  }
  const declarations = exportNames.map((name) => {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
      throw new Error(`${entry.path} has invalid CommonJS named export ${name}.`);
    }
    return `const ${name} = __upstreamExports.${name};\nif ( typeof ${name} !== 'function' ) {\n  throw new TypeError( '${entry.input} no longer exports function ${name}.' );\n}`;
  }).join('\n\n');
  return `/* Generated from ${entry.input}; upstream source is executed unchanged inside a CommonJS boundary. */
const __upstreamModule = { exports: {} };
const __upstreamRequire = ( moduleName ) => {
  throw new Error( 'Unsupported CommonJS dependency in ${entry.input}: ' + moduleName );
};
( function ( module, exports, require ) {
${normalizeSource(source)}
}( __upstreamModule, __upstreamModule.exports, __upstreamRequire ) );

const __upstreamExports = __upstreamModule.exports;
if ( !__upstreamExports || typeof __upstreamExports !== 'object' ) {
  throw new TypeError( '${entry.input} no longer exports an object.' );
}

${declarations}

export { ${exportNames.join(', ')} };
export default __upstreamExports;`;
}

function renderEsmCopy(source, entry) {
  const imports = entry.transform?.imports || [];
  if (imports.length) {
    throw new Error(`${entry.path} esm-copy does not support rewritten imports.`);
  }
  return `/* Generated as an exact ESM source copy from ${entry.input}. */\n${normalizeSource(source)}`;
}

function renderJsonDefault(source, entry) {
  const parsed = JSON.parse(source);
  return `/* Generated from ${entry.input}; JSON values are preserved exactly. */\nconst value = ${JSON.stringify(parsed, null, 2)};\n\nexport default Object.freeze(value);`;
}

function renderEsmNamedDefault(source, entry) {
  const exportName = entry.transform?.exportName;
  if (!exportName) throw new Error(`${entry.path} esm-named-default transform lacks exportName.`);
  findUniqueAnchor(source, `export default function ${exportName}`, entry.input);
  return `/* Generated from ${entry.input}; only the named re-export is added. */
${normalizeSource(source)}

export { ${exportName} };`;
}

function renderEsmFunctionSlices(source, entry) {
  const names = entry.transform?.exportNames;
  if (!Array.isArray(names) || names.length === 0) {
    throw new Error(`${entry.path} esm-function-slices transform lacks exportNames.`);
  }
  const importEntries = entry.transform?.imports || [];
  const resolvedImports = importEntries.map((importEntry) => path.posix.normalize(
    path.posix.join(path.posix.dirname(entry.path), importEntry.from)
  )).sort();
  const declaredDependencies = [...(entry.dependencies || [])].sort();
  if (JSON.stringify(resolvedImports) !== JSON.stringify(declaredDependencies)) {
    throw new Error(`${entry.path} generated import dependencies do not match its manifest dependencies.`);
  }
  const imports = renderImports(importEntries);
  const functions = names.map((name) => extractExportedFunction(source, name, entry.input));
  return `/* Generated from exact exported function slices in ${entry.input}. */
${imports}${imports ? '\n\n' : ''}${functions.join('\n\n')}`;
}

function renderEntry(root, entry) {
  const inputPath = path.join(root, entry.input || '');
  if (!entry.input || !fs.existsSync(inputPath)) {
    throw new Error(`Generated JavaScript port input is missing: ${entry.input || 'none'}`);
  }
  const source = fs.readFileSync(inputPath, 'utf8').replace(/\r\n?/g, '\n');
  switch (entry.transform?.kind) {
    case 'commonjs-default-function':
      return renderCommonJsDefaultFunction(source, entry);
    case 'commonjs-object-exports':
      return renderCommonJsObjectExports(source, entry);
    case 'esm-copy':
      return renderEsmCopy(source, entry);
    case 'json-default':
      return renderJsonDefault(source, entry);
    case 'esm-named-default':
      return renderEsmNamedDefault(source, entry);
    case 'esm-function-slices':
      return renderEsmFunctionSlices(source, entry);
    default:
      throw new Error(`${entry.path} has unsupported JavaScript port transform ${entry.transform?.kind || 'none'}.`);
  }
}

export function generateJavaScriptPorts({ root, nodeId, entries, vendorEntries = [], check = false }) {
  const declaredInputs = new Set((vendorEntries || []).map((entry) => typeof entry === 'string' ? entry : entry?.path).filter(Boolean));
  const selected = (entries || []).filter((entry) => entry?.originNode === nodeId);
  const outputs = [];
  const inputs = new Set();
  const relations = [];
  for (const entry of selected) {
    if (!declaredInputs.has(entry.input)) {
      throw new Error(`Generated JavaScript port input is not declared in vendorFiles: ${entry.input || 'none'}`);
    }
    const content = renderEntry(root, entry);
    writeGeneratedFile(root, entry.path, content, check);
    outputs.push(entry.path);
    inputs.add(entry.input);
    relations.push({
      path: entry.path,
      input: entry.input,
      dependencies: entry.dependencies || []
    });
  }
  return {
    inputs: [...inputs].sort(),
    outputs: outputs.sort(),
    relations: relations.sort((a, b) => compareCodePoints(a.path, b.path))
  };
}
