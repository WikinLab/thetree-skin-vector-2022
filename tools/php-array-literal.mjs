function skipSpace(source, state) {
  while (state.i < source.length) {
    if (/\s/.test(source[state.i])) { state.i += 1; continue; }
    if (source.startsWith('//', state.i) || source[state.i] === '#') {
      state.i = source.indexOf('\n', state.i);
      if (state.i < 0) state.i = source.length;
      continue;
    }
    if (source.startsWith('/*', state.i)) {
      const end = source.indexOf('*/', state.i + 2);
      if (end < 0) throw new Error('Unterminated PHP block comment');
      state.i = end + 2;
      continue;
    }
    break;
  }
}

function parseString(source, state) {
  const quote = source[state.i++];
  let value = '';
  while (state.i < source.length) {
    const char = source[state.i++];
    if (char === '\\') {
      const next = source[state.i++];
      value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
    } else if (char === quote) return value;
    else value += char;
  }
  throw new Error('Unterminated PHP string');
}

function skipExpression(source, state) {
  const depth = { '(': 0, '[': 0, '{': 0 };
  const close = { ')': '(', ']': '[', '}': '{' };
  let quote = '';
  let lineComment = false;
  let blockComment = false;
  const start = state.i;
  while (state.i < source.length) {
    const char = source[state.i];
    const next = source[state.i + 1] || '';
    if (lineComment) {
      state.i += 1;
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      state.i += 1;
      if (char === '*' && next === '/') { blockComment = false; state.i += 1; }
      continue;
    }
    if (quote) {
      if (char === '\\') state.i += 2;
      else { state.i += 1; if (char === quote) quote = ''; }
      continue;
    }
    if (char === "'" || char === '"') { quote = char; state.i += 1; continue; }
    if (char === '/' && next === '/') { lineComment = true; state.i += 2; continue; }
    if (char === '/' && next === '*') { blockComment = true; state.i += 2; continue; }
    if (char === '#') { lineComment = true; state.i += 1; continue; }
    if (Object.prototype.hasOwnProperty.call(depth, char)) depth[char] += 1;
    else if (close[char]) {
      const opener = close[char];
      if (depth[opener] === 0 && char === ']') break;
      depth[opener] -= 1;
    } else if (char === ',' && Object.values(depth).every((value) => value === 0)) break;
    state.i += 1;
  }
  return source.slice(start, state.i).trim();
}

function parseValue(source, state) {
  skipSpace(source, state);
  const char = source[state.i];
  if (char === '[') return parseArray(source, state);
  if (char === "'" || char === '"') return parseString(source, state);
  const rest = source.slice(state.i);
  const keyword = /^(true|false|null)\b/.exec(rest);
  if (keyword) { state.i += keyword[0].length; return keyword[1] === 'true' ? true : keyword[1] === 'false' ? false : null; }
  const number = /^-?\d+\b/.exec(rest);
  if (number) { state.i += number[0].length; return Number(number[0]); }
  skipExpression(source, state);
  return null;
}

function parseArray(source, state) {
  if (source[state.i] !== '[') throw new Error('Expected PHP array');
  state.i += 1;
  const items = [];
  const keyed = [];
  while (true) {
    skipSpace(source, state);
    if (source[state.i] === ']') { state.i += 1; break; }
    const first = parseValue(source, state);
    skipSpace(source, state);
    if (source.startsWith('=>', state.i)) {
      state.i += 2;
      keyed.push([String(first), parseValue(source, state)]);
    } else items.push(first);
    skipSpace(source, state);
    if (source[state.i] === ',') state.i += 1;
  }
  if (!keyed.length) return items;
  const object = Object.fromEntries(keyed);
  items.forEach((value, index) => { object[index] = value; });
  return object;
}

export function parseFirstPhpArrayAfter(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`PHP marker not found: ${marker}`);
  const start = source.indexOf('[', markerIndex + marker.length);
  if (start < 0) throw new Error(`PHP array not found after marker: ${marker}`);
  return parseArray(source, { i: start });
}

function findPhpBlockAfter(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`PHP marker not found: ${marker}`);
  const start = source.indexOf('{', markerIndex + marker.length);
  if (start < 0) throw new Error(`PHP block not found after marker: ${marker}`);
  let depth = 1;
  let i = start + 1;
  let quote = '';
  let lineComment = false;
  let blockComment = false;
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1] || '';
    if (lineComment) {
      i += 1;
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      i += 1;
      if (char === '*' && next === '/') { blockComment = false; i += 1; }
      continue;
    }
    if (quote) {
      if (char === '\\') i += 2;
      else { i += 1; if (char === quote) quote = ''; }
      continue;
    }
    if (char === "'" || char === '"') { quote = char; i += 1; continue; }
    if (char === '/' && next === '/') { lineComment = true; i += 2; continue; }
    if (char === '/' && next === '*') { blockComment = true; i += 2; continue; }
    if (char === '#') { lineComment = true; i += 1; continue; }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, i);
    }
    i += 1;
  }
  throw new Error(`Unterminated PHP block after marker: ${marker}`);
}

function tokenizePhp(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1] || '';
    if (/\s/.test(char)) { i += 1; continue; }
    if (char === '/' && next === '/') {
      i += 2;
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) throw new Error('Unterminated PHP block comment');
      i = end + 2;
      continue;
    }
    if (char === '#') {
      i += 1;
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      const state = { i };
      tokens.push({ type: 'string', value: parseString(source, state) });
      i = state.i;
      continue;
    }
    const variable = /^\$[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i));
    if (variable) {
      tokens.push({ type: 'variable', value: variable[0] });
      i += variable[0].length;
      continue;
    }
    const identifier = /^[A-Za-z_\\][A-Za-z0-9_\\]*/.exec(source.slice(i));
    if (identifier) {
      tokens.push({ type: 'identifier', value: identifier[0] });
      i += identifier[0].length;
      continue;
    }
    const operator = ['===', '!==', '=>', '&&', '||', '==', '!=', '.=', '::'].find((value) => source.startsWith(value, i));
    if (operator) {
      tokens.push({ type: 'symbol', value: operator });
      i += operator.length;
      continue;
    }
    tokens.push({ type: 'symbol', value: char });
    i += 1;
  }
  return tokens;
}

function matchingToken(tokens, start, open, close) {
  if (tokens[start]?.value !== open) throw new Error(`Expected PHP token ${open}`);
  let depth = 1;
  for (let i = start + 1; i < tokens.length; i += 1) {
    if (tokens[i].value === open) depth += 1;
    else if (tokens[i].value === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`Unterminated PHP token group ${open}${close}`);
}

function featureAccessAt(tokens, index) {
  if (tokens[index]?.type !== 'variable' || tokens[index].value !== '$features') return null;
  if (tokens[index + 1]?.value !== '[' || tokens[index + 2]?.type !== 'string' || tokens[index + 3]?.value !== ']') return null;
  return { key: tokens[index + 2].value, next: index + 4 };
}

function analyseFeatureCondition(tokens) {
  const isset = new Set();
  const notIsset = new Set();
  const truthy = new Set();
  const variables = new Set(tokens.filter((token) => token.type === 'variable').map((token) => token.value));
  for (let i = 0; i < tokens.length; i += 1) {
    const access = featureAccessAt(tokens, i);
    if (!access) continue;
    const isIsset = tokens[i - 2]?.value === 'isset' && tokens[i - 1]?.value === '(';
    const isNegatedIsset = isIsset && tokens[i - 3]?.value === '!';
    if (isNegatedIsset) notIsset.add(access.key);
    else if (isIsset) isset.add(access.key);
    else truthy.add(access.key);
    i = access.next - 1;
  }
  return { isset, notIsset, truthy, variables };
}

function parseFeatureAssignments(tokens) {
  const assignments = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const target = featureAccessAt(tokens, i);
    if (!target || tokens[target.next]?.value !== '=') continue;
    const rhsIndex = target.next + 1;
    if (tokens[rhsIndex]?.type === 'identifier' && tokens[rhsIndex].value === 'true') {
      assignments.push({ index: i, target: target.key, kind: 'true' });
      i = rhsIndex;
      continue;
    }
    const source = featureAccessAt(tokens, rhsIndex);
    if (source) {
      assignments.push({ index: i, target: target.key, kind: 'copy', source: source.key });
      i = source.next - 1;
      continue;
    }
    throw new Error(`Unsupported SkinModule feature assignment for ${target.key}`);
  }
  return assignments;
}

function parseUnsetFeature(tokens, index) {
  if (tokens[index]?.type !== 'identifier' || tokens[index].value !== 'unset' || tokens[index + 1]?.value !== '(') return null;
  const access = featureAccessAt(tokens, index + 2);
  if (!access || tokens[access.next]?.value !== ')' || tokens[access.next + 1]?.value !== ';') return null;
  return { key: access.key, next: access.next + 2 };
}

export function parsePhpFeatureCompatibilityAfter(source, marker) {
  const tokens = tokenizePhp(findPhpBlockAfter(source, marker));
  const operations = [];
  const recognisedAssignments = new Set();
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i]?.type !== 'identifier' || tokens[i].value !== 'if' || tokens[i + 1]?.value !== '(') {
      i += 1;
      continue;
    }
    const conditionEnd = matchingToken(tokens, i + 1, '(', ')');
    if (tokens[conditionEnd + 1]?.value !== '{') throw new Error('SkinModule compatibility if-statement must use a block');
    const blockEnd = matchingToken(tokens, conditionEnd + 1, '{', '}');
    const condition = analyseFeatureCondition(tokens.slice(i + 2, conditionEnd));
    const blockTokens = tokens.slice(conditionEnd + 2, blockEnd);
    const assignments = parseFeatureAssignments(blockTokens);
    if (!assignments.length) {
      i = blockEnd + 1;
      continue;
    }
    assignments.forEach((assignment) => recognisedAssignments.add(conditionEnd + 2 + assignment.index));
    if (assignments.length === 1 && assignments[0].kind === 'copy') {
      const assignment = assignments[0];
      if (!condition.isset.has(assignment.source) || !condition.notIsset.has(assignment.target)) {
        throw new Error(`Unable to derive SkinModule propagation condition: ${assignment.source} -> ${assignment.target}`);
      }
      operations.push({
        type: 'propagate',
        from: assignment.source,
        to: assignment.target,
        requiresAddUnspecifiedFeatures: condition.variables.has('$addUnspecifiedFeatures')
      });
      i = blockEnd + 1;
      continue;
    }
    if (assignments.every((assignment) => assignment.kind === 'true')) {
      const sources = [...condition.isset].filter((key) => condition.truthy.has(key));
      if (sources.length !== 1) throw new Error('Unable to derive SkinModule shorthand source');
      const unset = parseUnsetFeature(tokens, blockEnd + 1);
      if (!unset || unset.key !== sources[0]) throw new Error(`SkinModule shorthand ${sources[0]} must be followed by an exact unset`);
      operations.push({ type: 'shorthand', from: sources[0], enables: assignments.map((assignment) => assignment.target) });
      i = unset.next;
      continue;
    }
    throw new Error('Unsupported SkinModule feature compatibility block');
  }

  const allAssignments = parseFeatureAssignments(tokens);
  for (const assignment of allAssignments) {
    if (!recognisedAssignments.has(assignment.index)) {
      throw new Error(`Unrecognised SkinModule feature compatibility assignment for ${assignment.target}`);
    }
  }
  return operations;
}

function optionLessMessagesAccessAt(tokens, index) {
  if (tokens[index]?.type !== 'variable' || tokens[index].value !== '$options') return null;
  if (tokens[index + 1]?.value !== '[' || tokens[index + 2]?.type !== 'string' || tokens[index + 2].value !== 'lessMessages' || tokens[index + 3]?.value !== ']') return null;
  return { next: index + 4 };
}

function conditionFeatureMembership(tokens) {
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i]?.type !== 'identifier' || tokens[i].value !== 'in_array' || tokens[i + 1]?.value !== '(') continue;
    const end = matchingToken(tokens, i + 1, '(', ')');
    const args = tokens.slice(i + 2, end);
    const feature = args.find((token) => token.type === 'string')?.value;
    const hasFeatures = args.some((token, index) => token.type === 'variable'
      && token.value === '$this'
      && args[index + 1]?.value === '-'
      && args[index + 2]?.value === '>'
      && args[index + 3]?.type === 'identifier'
      && args[index + 3]?.value === 'features');
    if (feature && hasFeatures) return feature;
  }
  return null;
}

function lessMessageConstantAssignment(tokens) {
  const assignments = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const target = optionLessMessagesAccessAt(tokens, i);
    if (!target || tokens[target.next]?.value !== '=') continue;
    let constant = null;
    for (let j = target.next + 1; j < tokens.length - 2; j += 1) {
      if (tokens[j]?.type === 'identifier' && tokens[j].value === 'self'
        && tokens[j + 1]?.value === '::'
        && tokens[j + 2]?.type === 'identifier') {
        constant = tokens[j + 2].value;
        break;
      }
    }
    if (!constant || !tokens.slice(target.next + 1).some((token) => token.type === 'identifier' && token.value === 'array_merge')) {
      throw new Error('Unsupported SkinModule lessMessages assignment');
    }
    assignments.push({ index: i, constant });
  }
  return assignments;
}

export function parsePhpFeatureLessMessageBindingsAfter(source, marker) {
  const tokens = tokenizePhp(findPhpBlockAfter(source, marker));
  const bindings = [];
  const recognised = new Set();
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i]?.type !== 'identifier' || tokens[i].value !== 'if' || tokens[i + 1]?.value !== '(') continue;
    const conditionEnd = matchingToken(tokens, i + 1, '(', ')');
    if (tokens[conditionEnd + 1]?.value !== '{') continue;
    const blockEnd = matchingToken(tokens, conditionEnd + 1, '{', '}');
    const assignments = lessMessageConstantAssignment(tokens.slice(conditionEnd + 2, blockEnd));
    if (!assignments.length) {
      i = blockEnd;
      continue;
    }
    if (assignments.length !== 1) throw new Error('SkinModule feature block must declare exactly one lessMessages constant');
    const feature = conditionFeatureMembership(tokens.slice(i + 2, conditionEnd));
    if (!feature) throw new Error('Unable to derive SkinModule feature for lessMessages assignment');
    bindings.push({ feature, constant: assignments[0].constant });
    recognised.add(conditionEnd + 2 + assignments[0].index);
    i = blockEnd;
  }
  const allAssignments = lessMessageConstantAssignment(tokens);
  for (const assignment of allAssignments) {
    if (!recognised.has(assignment.index)) throw new Error('Unrecognised SkinModule lessMessages assignment');
  }
  return bindings;
}
