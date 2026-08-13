#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (pathname) => fs.readFileSync(path.join(root, pathname), 'utf8');
const imports = (source) => [...source.matchAll(/@import\s+["']([^"']+)["']\s*;/g)].map((match) => match[1]);
const styleSources = (source) => [...source.matchAll(/<style\s+src=["']([^"']+)["']\s*><\/style>/g)].map((match) => match[1]);
const rules = (pathname) => {
  const output = [];
  postcss.parse(read(pathname), { from: pathname }).walkRules((rule) => {
    selectorParser().processSync(rule.selector);
    output.push(rule);
  });
  return output;
};

assert.deepEqual(styleSources(read('components/Vector2022VariantLayout.vue')), [
  '../css/vendor/resource-loader/page-styles.css',
  '../css/vector-2022-adapter.css',
  '../css/host-content.css',
  '../css/host-modal.css'
]);
const skin = read('components/SkinVector2022.vue');
assert.match(skin, /id="mw-content-text"/);
assert.match(skin, /data-tt-host-content="1"/);
assert.match(skin, /<slot\s*\/>/);
assert.doesNotMatch(skin, /querySelectorAll\([^)]*h[1-6]/);

assert.deepEqual(imports(read('css/host-content.css')), [
  './host-content/foundation.css',
  './host-content/links.css'
]);
for (const pathname of ['css/host-content/foundation.css', 'css/host-content/links.css']) {
  const source = read(pathname);
  for (const rule of rules(pathname)) assert.match(rule.selector, /data-tt-host-content/);
  assert.doesNotMatch(source, /!important/);
}
for (const rule of rules('css/host-modal.css')) assert.match(rule.selector, /\.thetree-modal-container/);

const contract = JSON.parse(read('contracts/resource-loader-origin-contract.json'));
assert.equal(contract.pageStyleQueue.profile, 'vector-2022');
assert.equal(contract.shared.hostSurfaces.hostContent, '#mw-content-text[data-tt-host-content="1"]');
assert.deepEqual(contract.shared.ownershipPolicies.skin.excludedSurfaces, ['hostModal']);
const generated = read('css/vendor/resource-loader/skins.vector.styles.css');
assert.match(generated, /data-tt-host-content/);
assert.match(generated, /thetree-modal-container/);

console.log('Vector 2022 chrome and the tree host-content ownership contract passed.');
