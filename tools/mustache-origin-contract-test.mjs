#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Mustache from 'mustache';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templateRoot = path.join(root, 'vendor', 'mediawiki-vector-2022', 'includes', 'templates');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

assert.equal(
  Mustache.render('{{#items}}<{{name}}>{{/items}}', { items: [{ name: 'a' }, { name: 'b' }] }),
  '<a><b>'
);
assert.equal(
  Mustache.render('{{#wrap}}value{{/wrap}}', { wrap: () => (text, render) => `[${render(text)}]` }),
  '[value]'
);
assert.equal(
  Mustache.render('begin\n  {{> row}}\nend', {}, { row: 'x\ny' }),
  'begin\n  x\n  yend'
);

if (fs.existsSync(templateRoot)) {
  const templates = walk(templateRoot).filter((file) => file.endsWith('.mustache'));
  assert.ok(templates.length > 0, 'No materialized Vector Mustache templates were found');
  for (const template of templates) Mustache.parse(fs.readFileSync(template, 'utf8'));
}

const generator = fs.readFileSync(path.join(root, 'tools', 'mustache-vue-origin-engine.mjs'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'lib', 'mustacheVueRuntime.js'), 'utf8');
assert.match(generator, /from 'mustache'/);
assert.match(runtime, /from 'mustache'/);
assert.match(runtime, /from 'parse5'/);
assert.doesNotMatch(generator + runtime, /mustacheTemplateEngine/);

console.log('Mustache origin contract passed.');
