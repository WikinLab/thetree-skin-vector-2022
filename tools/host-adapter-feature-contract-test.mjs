#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOCUMENT_ACTION_MAP,
  NAMESPACE_MAP,
  PERSONAL_TOOL_MAP,
  SIDEBAR_TOOLBOX_MAP
} from '../lib/vector2022HostAdapterPolicy.js';
import { normalizeTheTreeSuggestions } from '../lib/adapters/thetree-search-suggest.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (pathname) => fs.readFileSync(path.join(root, pathname), 'utf8');
const row = (map, id) => map.find((candidate) => candidate.id === id);

assert.equal(row(DOCUMENT_ACTION_MAP, 'document.action.watchstar').transform.kind, 'watchstar');
assert.equal(row(NAMESPACE_MAP, 'namespace.talk').source.action, 'discuss');
assert.equal(row(PERSONAL_TOOL_MAP, 'personal.settings').transform.kind, 'settings-action');
assert.equal(row(SIDEBAR_TOOLBOX_MAP, 'toolbox.relevant-user-contributions').transform.kind, 'relevant-user-contribution');
assert.deepEqual(normalizeTheTreeSuggestions([' 문서 ', '', '문서', '분류:테스트'], 10), ['문서', '분류:테스트']);

const adapter = read('lib/vector2022TheTreeAdapter.js');
assert.match(adapter, /makeVector2022PageContract/);
assert.match(adapter, /revisionContext === 'uuid'/);
assert.match(adapter, /pageData\.discuss_progress/);
const skin = read('components/SkinVector2022.vue');
assert.match(skin, /createTheTreeSearchSuggestRuntime/);
assert.match(skin, /makeVector2022HostState/);
assert.match(skin, /wiki\.hide_user_document_discuss/);
const runtime = read('lib/runtime/createVector2022RuntimeController.js');
assert.match(runtime, /renderClientPreferences/);
assert.match(runtime, /setupStickyHeader/);
assert.match(runtime, /vector-dropdown-checkbox:checked/);

console.log('Vector 2022 host adapter feature contract passed.');
