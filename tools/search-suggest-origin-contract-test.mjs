#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (pathname) => fs.readFileSync(path.join(root, pathname), 'utf8');
const json = (pathname) => JSON.parse(read(pathname));

const contract = json('contracts/mediawiki-typeahead-search-contract.json');
assert.equal(contract.schema, 2);
assert.ok(contract.components.some((entry) => entry.input.endsWith('/App.vue')));
assert.ok(contract.components.some((entry) => entry.input.endsWith('/TypeaheadSearchWrapper.vue')));
const component = read('components/SkinVector2022.vue');
assert.match(component, /MediaWikiTypeaheadSearchOrigin/);
assert.match(component, /`\/Complete\?q=\$\{encodeURIComponent\(query\)\}`/);
assert.match(component, /app\.mount\(target\)/);
const adapter = read('lib/adapters/thetree-search-suggest.js');
assert.match(adapter, /requestSuggestions/);
assert.match(adapter, /AbortController/);
assert.doesNotMatch(adapter, /innerHTML\s*=/);
const manifest = json('ORIGIN-MANIFEST.json');
for (const output of [
  'lib/generated/mediawiki.skinning.typeaheadSearch/App.vue',
  'lib/generated/mediawiki.skinning.typeaheadSearch/TypeaheadSearchWrapper.vue'
]) assert.ok(manifest.sourceInventory.generatedFiles.some((entry) => entry.path === output));

console.log('Vector 2022 TypeaheadSearch origin contract passed.');
