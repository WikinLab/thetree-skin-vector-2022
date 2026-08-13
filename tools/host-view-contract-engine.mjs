import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  CONTENT_VIEW_MAP,
  HOST_VIEW_INVENTORY,
  validateVector2022HostViewContract
} from '../lib/vector2022SpecialPageContract.js';
import { walkFiles } from './shared/files.mjs';

function normalizeRelativePath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
}

function isIdentifierStart(char) {
  return /[A-Za-z_$]/.test(char || '');
}

function isIdentifierPart(char) {
  return /[A-Za-z0-9_$]/.test(char || '');
}

function decodeHex(raw, length, owner, offset) {
  const value = raw.slice(offset, offset + length);
  if (!new RegExp(`^[0-9A-Fa-f]{${length}}$`).test(value)) {
    throw new Error(`${owner} contains an invalid hexadecimal escape.`);
  }
  return { value: String.fromCodePoint(Number.parseInt(value, 16)), next: offset + length };
}

function readStaticStringLiteral(source, start, owner) {
  const quote = source[start];
  if (!['\'', '"', '`'].includes(quote)) return null;
  let value = '';
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === quote) return { value, end: index + 1, template: quote === '`' };
    if (quote === '`' && char === '$' && source[index + 1] === '{') {
      return { dynamic: true, end: index + 2, template: true };
    }
    if (char === '\n' || char === '\r') {
      if (quote !== '`') {
        throw new Error(`${owner} contains an unterminated string literal.`);
      }
      value += '\n';
      index += char === '\r' && source[index + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (char !== '\\') {
      value += char;
      index += 1;
      continue;
    }

    index += 1;
    if (index >= source.length) throw new Error(`${owner} contains an unterminated escape sequence.`);
    const escaped = source[index];
    if (escaped === '\n') {
      index += 1;
      continue;
    }
    if (escaped === '\r') {
      index += source[index + 1] === '\n' ? 2 : 1;
      continue;
    }
    const simple = {
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
      v: '\v',
      0: '\0',
      '\\': '\\',
      '\'': '\'',
      '"': '"',
      '`': '`'
    };
    if (Object.prototype.hasOwnProperty.call(simple, escaped)) {
      value += simple[escaped];
      index += 1;
      continue;
    }
    if (escaped === 'x') {
      const decoded = decodeHex(source, 2, owner, index + 1);
      value += decoded.value;
      index = decoded.next;
      continue;
    }
    if (escaped === 'u') {
      if (source[index + 1] === '{') {
        const close = source.indexOf('}', index + 2);
        if (close === -1) throw new Error(`${owner} contains an unterminated Unicode escape.`);
        const raw = source.slice(index + 2, close);
        if (!/^[0-9A-Fa-f]{1,6}$/.test(raw)) throw new Error(`${owner} contains an invalid Unicode escape.`);
        value += String.fromCodePoint(Number.parseInt(raw, 16));
        index = close + 1;
        continue;
      }
      const decoded = decodeHex(source, 4, owner, index + 1);
      value += decoded.value;
      index = decoded.next;
      continue;
    }
    value += escaped;
    index += 1;
  }
  throw new Error(`${owner} contains an unterminated string literal.`);
}

function skipLineComment(source, start) {
  const end = source.indexOf('\n', start + 2);
  return end === -1 ? source.length : end + 1;
}

function skipBlockComment(source, start, owner) {
  const end = source.indexOf('*/', start + 2);
  if (end === -1) throw new Error(`${owner} contains an unterminated block comment.`);
  return end + 2;
}

function skipRegexLiteral(source, start, owner) {
  let index = start + 1;
  let inClass = false;
  while (index < source.length) {
    const char = source[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === '\n' || char === '\r') throw new Error(`${owner} contains an unterminated regular expression literal.`);
    if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (char === '/' && !inClass) {
      index += 1;
      while (/[A-Za-z]/.test(source[index] || '')) index += 1;
      return index;
    }
    index += 1;
  }
  throw new Error(`${owner} contains an unterminated regular expression literal.`);
}

function skipTemplateLiteral(source, start, owner) {
  let index = start + 1;
  let expressionDepth = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (expressionDepth === 0 && char === '`') return index + 1;
    if (char === '$' && next === '{') {
      expressionDepth += 1;
      index += 2;
      continue;
    }
    if (expressionDepth > 0) {
      if (char === '\'' || char === '"') {
        const literal = readStaticStringLiteral(source, index, owner);
        index = literal.end;
        continue;
      }
      if (char === '`') {
        index = skipTemplateLiteral(source, index, owner);
        continue;
      }
      if (char === '/' && next === '/') {
        index = skipLineComment(source, index);
        continue;
      }
      if (char === '/' && next === '*') {
        index = skipBlockComment(source, index, owner);
        continue;
      }
      if (char === '{') expressionDepth += 1;
      else if (char === '}') expressionDepth -= 1;
    }
    index += 1;
  }
  throw new Error(`${owner} contains an unterminated template literal.`);
}

function skipTrivia(source, start, owner) {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index);
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index, owner);
      continue;
    }
    break;
  }
  return index;
}

function tokenizeJavaScript(source, owner = '<javascript>') {
  const tokens = [];
  let index = 0;
  let canStartRegex = true;

  const push = (type, value, start, end, extra = {}) => {
    tokens.push(Object.freeze({ type, value, start, end, ...extra }));
  };

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      index = skipLineComment(source, index);
      continue;
    }
    if (char === '/' && next === '*') {
      index = skipBlockComment(source, index, owner);
      continue;
    }
    if (char === '\'' || char === '"') {
      const literal = readStaticStringLiteral(source, index, owner);
      push('string', literal.value, index, literal.end, { dynamic: false });
      index = literal.end;
      canStartRegex = false;
      continue;
    }
    if (char === '`') {
      const literal = readStaticStringLiteral(source, index, owner);
      if (literal?.dynamic) {
        const end = skipTemplateLiteral(source, index, owner);
        push('template', null, index, end, { dynamic: true });
        index = end;
      } else {
        push('string', literal.value, index, literal.end, { dynamic: false, template: true });
        index = literal.end;
      }
      canStartRegex = false;
      continue;
    }
    if (char === '/' && canStartRegex) {
      const end = skipRegexLiteral(source, index, owner);
      push('regex', null, index, end);
      index = end;
      canStartRegex = false;
      continue;
    }
    if (isIdentifierStart(char)) {
      const start = index;
      index += 1;
      while (isIdentifierPart(source[index])) index += 1;
      const identifier = source.slice(start, index);
      push('identifier', identifier, start, index);
      canStartRegex = ['return', 'throw', 'case', 'delete', 'void', 'typeof', 'instanceof', 'in', 'of', 'new', 'yield', 'await'].includes(identifier);
      continue;
    }
    if (/[0-9]/.test(char)) {
      const start = index;
      index += 1;
      while (/[0-9A-Za-z_.]/.test(source[index] || '')) index += 1;
      push('number', source.slice(start, index), start, index);
      canStartRegex = false;
      continue;
    }

    const two = source.slice(index, index + 2);
    const three = source.slice(index, index + 3);
    const operator = ['===', '!==', '>>>', '**=', '&&=', '||=', '??=', '<<=', '>>='].includes(three)
      ? three
      : ['=>', '==', '!=', '<=', '>=', '++', '--', '&&', '||', '??', '?.', '**', '<<', '>>', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^='].includes(two)
        ? two
        : char;
    push('punctuator', operator, index, index + operator.length);
    index += operator.length;
    if ([')', ']', '}'].includes(operator) || ['++', '--'].includes(operator)) canStartRegex = false;
    else if (['.', '?.'].includes(operator)) canStartRegex = false;
    else canStartRegex = true;
  }
  return Object.freeze(tokens);
}

function findMatchingToken(tokens, start, open, close, owner) {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const value = tokens[index].value;
    if (value === open) depth += 1;
    else if (value === close) {
      depth -= 1;
      if (depth === 0) return index;
      if (depth < 0) break;
    }
  }
  throw new Error(`${owner} contains an unbalanced ${open}${close} token range.`);
}

function topLevelArgumentRanges(tokens, openIndex, closeIndex) {
  const ranges = [];
  let start = openIndex + 1;
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  for (let index = start; index < closeIndex; index += 1) {
    const value = tokens[index].value;
    if (value === '(') paren += 1;
    else if (value === ')') paren -= 1;
    else if (value === '[') bracket += 1;
    else if (value === ']') bracket -= 1;
    else if (value === '{') brace += 1;
    else if (value === '}') brace -= 1;
    else if (value === ',' && paren === 0 && bracket === 0 && brace === 0) {
      ranges.push([start, index]);
      start = index + 1;
    }
  }
  if (start < closeIndex) ranges.push([start, closeIndex]);
  return ranges;
}

function findDirectObjectProperty(tokens, openIndex, closeIndex, propertyName) {
  let paren = 0;
  let bracket = 0;
  let brace = 1;
  for (let index = openIndex + 1; index < closeIndex; index += 1) {
    const token = tokens[index];
    const value = token.value;
    if (value === '(') paren += 1;
    else if (value === ')') paren -= 1;
    else if (value === '[') bracket += 1;
    else if (value === ']') bracket -= 1;
    else if (value === '{') brace += 1;
    else if (value === '}') brace -= 1;
    if (brace !== 1 || paren !== 0 || bracket !== 0) continue;
    if (!['identifier', 'string'].includes(token.type) || token.value !== propertyName) continue;
    if (tokens[index + 1]?.value !== ':') continue;
    return { keyIndex: index, valueIndex: index + 2 };
  }
  return null;
}

export function extractRenderSkinContentNames(source, owner = '<javascript>') {
  const tokens = tokenizeJavaScript(source, owner);
  const names = [];
  const dynamic = [];
  let calls = 0;

  for (let index = 0; index < tokens.length - 3; index += 1) {
    if (tokens[index].type !== 'identifier' || tokens[index].value !== 'res') continue;
    if (!['.', '?.'].includes(tokens[index + 1]?.value)) continue;
    if (tokens[index + 2]?.type !== 'identifier' || tokens[index + 2]?.value !== 'renderSkin') continue;
    if (tokens[index + 3]?.value !== '(') continue;

    calls += 1;
    const openIndex = index + 3;
    const closeIndex = findMatchingToken(tokens, openIndex, '(', ')', owner);
    const argumentsList = topLevelArgumentRanges(tokens, openIndex, closeIndex);
    const dataRange = argumentsList[1];
    if (!dataRange) {
      index = closeIndex;
      continue;
    }
    const [dataStart, dataEnd] = dataRange;
    if (tokens[dataStart]?.value !== '{') {
      dynamic.push({ owner, offset: tokens[dataStart]?.start ?? tokens[openIndex].end, reason: 'non-literal renderSkin data argument' });
      index = closeIndex;
      continue;
    }
    const objectClose = findMatchingToken(tokens, dataStart, '{', '}', owner);
    if (objectClose < dataEnd) {
      const property = findDirectObjectProperty(tokens, dataStart, objectClose, 'contentName');
      if (property) {
        const value = tokens[property.valueIndex];
        if (value?.type === 'string' && !value.dynamic) names.push(value.value);
        else dynamic.push({ owner, offset: value?.start ?? tokens[property.keyIndex].end, reason: 'dynamic contentName value' });
      }
    }
    index = closeIndex;
  }

  return Object.freeze({ names: Object.freeze(names), dynamic: Object.freeze(dynamic), calls });
}

export const extractStaticContentNames = extractRenderSkinContentNames;


export function validateHostViewExtractorContract() {
  const multilineTemplateSource = [
    "newGroup.aclMessage = `",
    "${req.t('default_aclgroups.warn_message')}",
    '',
    '<a href="/aclgroup/self_remove?id={id}">[${req.t(\'default_aclgroups.checked_message\')} #{id}]</a>',
    "${req.t('acl.deny_string.reason')}: {note}",
    "`.trim().replaceAll('\\n', '<br>');",
    "res.renderSkin('aclgroup', { contentName: 'admin/aclgroup' });"
  ].join('\n');
  const multilineResult = extractRenderSkinContentNames(multilineTemplateSource, '<multiline-template-contract>');
  if (JSON.stringify(multilineResult.names) !== JSON.stringify(['admin/aclgroup']) || multilineResult.dynamic.length) {
    throw new Error('Host view extractor failed the multiline template literal contract.');
  }

  const staticTemplateContentName = "res.renderSkin('test', { contentName: `member/login` });";
  const staticTemplateResult = extractRenderSkinContentNames(staticTemplateContentName, '<static-template-contract>');
  if (JSON.stringify(staticTemplateResult.names) !== JSON.stringify(['member/login']) || staticTemplateResult.dynamic.length) {
    throw new Error('Host view extractor failed the static template contentName contract.');
  }

  const dynamicContentName = "res.renderSkin('test', { contentName: `member/${kind}` });";
  const dynamicResult = extractRenderSkinContentNames(dynamicContentName, '<dynamic-template-contract>');
  if (dynamicResult.names.length || dynamicResult.dynamic.length !== 1 || dynamicResult.dynamic[0].reason !== 'dynamic contentName value') {
    throw new Error('Host view extractor failed the dynamic contentName rejection contract.');
  }
  return true;
}

function gitHead(checkout) {
  const result = spawnSync(process.platform === 'win32' ? 'git.exe' : 'git', [
    '-c', `safe.directory=${checkout.replaceAll('\\', '/')}`,
    '-C', checkout, 'rev-parse', 'HEAD'
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Unable to read locked host checkout HEAD: ${checkout}\n${String(result.stderr || result.stdout).trim()}`);
  }
  return String(result.stdout).trim();
}

function checkoutPath(root, entry) {
  return path.join(root, '.upstream', entry.checkout);
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`hostLock is missing ${label}.`);
}

function validateHostRepository(entry, label, { sourceRoots = false } = {}) {
  if (!entry || typeof entry !== 'object') throw new Error(`hostLock is missing ${label}.`);
  for (const field of ['repository', 'ref', 'commit', 'checkout']) requireString(entry[field], `${label}.${field}`);
  if (!/^[0-9a-f]{40}$/.test(entry.commit)) throw new Error(`hostLock ${label}.commit must be an exact Git commit.`);
  const paths = sourceRoots ? entry.sourceRoots : [entry.sourceRoot];
  if (!Array.isArray(paths) || paths.some((value) => typeof value !== 'string' || !value)) {
    throw new Error(`hostLock ${label} source paths are incomplete.`);
  }
  if (!Array.isArray(entry.bootstrapPaths) || entry.bootstrapPaths.length === 0) {
    throw new Error(`hostLock ${label}.bootstrapPaths is incomplete.`);
  }
}

export function validateHostLockContract(lock) {
  if (lock?.schema !== 2) throw new Error(`Unsupported or missing hostLock schema: ${lock?.schema ?? 'none'}`);
  validateHostRepository(lock.frontend, 'frontend');
  validateHostRepository(lock.backend, 'backend', { sourceRoots: true });
  requireString(lock.contract, 'contract');
  requireString(lock.validator, 'validator');
  return lock;
}

function assertLockedCheckout(root, entry, label) {
  const checkout = checkoutPath(root, entry);
  if (!fs.existsSync(checkout) || !fs.statSync(checkout).isDirectory()) {
    throw new Error(`Locked ${label} checkout is missing: ${path.relative(root, checkout).replaceAll('\\', '/')}`);
  }
  const head = gitHead(checkout);
  if (head !== entry.commit) {
    throw new Error(`Locked ${label} checkout mismatch: expected ${entry.commit}, got ${head}.`);
  }
  return checkout;
}

function staticBackendContentNames(backendCheckout, sourceRoots) {
  const names = new Set();
  const owners = new Map();
  const dynamic = [];
  const files = [];
  for (const sourceRoot of sourceRoots) {
    const absoluteRoot = path.join(backendCheckout, sourceRoot);
    for (const file of walkFiles(absoluteRoot)) {
      if (!/\.(?:c|m)?js$/.test(file)) continue;
      files.push(file);
      const owner = path.relative(backendCheckout, file).replaceAll('\\', '/');
      const result = extractRenderSkinContentNames(fs.readFileSync(file, 'utf8'), owner);
      dynamic.push(...result.dynamic);
      for (const name of result.names) {
        names.add(name);
        const list = owners.get(name) || [];
        list.push(owner);
        owners.set(name, list);
      }
    }
  }
  return Object.freeze({ names, owners, dynamic, files: Object.freeze(files.sort()) });
}

function frontendContentFile(frontendCheckout, sourceRoot, contentName) {
  return path.join(frontendCheckout, sourceRoot, `${contentName}.vue`);
}

export function validateHostViewSourceClosure({
  frontendCheckout,
  backendCheckout,
  frontendSourceRoot,
  backendSourceRoots,
  inventory = HOST_VIEW_INVENTORY,
  rows = CONTENT_VIEW_MAP
}) {
  validateVector2022HostViewContract();
  validateHostViewExtractorContract();
  const errors = [];
  const backend = staticBackendContentNames(backendCheckout, backendSourceRoots);
  if (backend.dynamic.length) {
    for (const item of backend.dynamic) errors.push(`dynamic contentName declaration: ${item.owner}@${item.offset}`);
  }

  const declared = new Set(inventory);
  for (const contentName of backend.names) {
    if (!declared.has(contentName)) errors.push(`backend contentName lacks a host view contract: ${contentName}`);
  }
  for (const contentName of declared) {
    if (!backend.names.has(contentName)) errors.push(`host view contract is not emitted by the locked backend: ${contentName}`);
    const row = rows[contentName];
    const expectedFrontendPath = `src/views/contents/${contentName}.vue`;
    if (normalizeRelativePath(row?.source?.frontendPath) !== expectedFrontendPath) {
      errors.push(`host view contract frontend path mismatch: ${contentName}`);
    }
    const frontendFile = frontendContentFile(frontendCheckout, frontendSourceRoot, contentName);
    if (!fs.existsSync(frontendFile) || !fs.statSync(frontendFile).isFile()) {
      errors.push(`locked frontend view is missing: ${expectedFrontendPath}`);
    }
  }

  if (!backend.files.length) errors.push('locked backend source roots contain no JavaScript files');
  if (errors.length) throw new Error(`Locked host view source closure mismatch:\n- ${errors.join('\n- ')}`);
  return Object.freeze({
    contentNames: Object.freeze([...backend.names].sort()),
    backendFiles: backend.files,
    frontendFiles: Object.freeze([...declared].sort().map((contentName) => `src/views/contents/${contentName}.vue`))
  });
}

export function validateLockedHostViewSourceContract(root, manifest) {
  const lock = validateHostLockContract(manifest?.hostLock);
  const frontend = lock.frontend;
  const backend = lock.backend;

  const frontendCheckout = assertLockedCheckout(root, frontend, 'thetree frontend');
  const backendCheckout = assertLockedCheckout(root, backend, 'thetree backend');
  return validateHostViewSourceClosure({
    frontendCheckout,
    backendCheckout,
    frontendSourceRoot: frontend.sourceRoot,
    backendSourceRoots: backend.sourceRoots
  });
}
