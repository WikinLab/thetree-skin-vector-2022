#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (pathname) => fs.readFileSync(path.join(root, pathname), 'utf8');
const json = (pathname) => JSON.parse(read(pathname));
const manifest = json('ORIGIN-MANIFEST.json');
const generated = manifest.sourceInventory.generatedFiles;

const templates = manifest.sourceInventory.vendorFiles
  .filter((entry) => entry.repository === 'mediawiki-skins-Vector' && entry.upstreamPath?.startsWith('includes/templates/') && entry.upstreamPath.endsWith('.mustache'));
assert.equal(templates.length, 46);
for (const template of templates) {
  const relative = template.upstreamPath.slice('includes/templates/'.length, -'.mustache'.length);
  assert.ok(generated.some((entry) => entry.path === `components/${relative}.vue` && entry.input === template.path));
}
assert.ok(generated.some((entry) => entry.path === 'components/skin.vue'));
assert.ok(generated.some((entry) => entry.path === 'lib/generated/vector-2022-messages.js'));
assert.ok(generated.some((entry) => entry.path === 'lib/generated/vector-client-preferences.js'));
assert.ok(generated.some((entry) => entry.path === 'lib/generated/vector-client-preferences-config.js'));

const skinData = read('lib/vector2022SkinData.js');
assert.match(skinData, /'data-vector-sticky-header': stickyHeaderData/);
assert.match(skinData, /'data-lang-dropdown': null/);
assert.match(skinData, /skin\.vector-2022\.logo_icon/);
assert.match(skinData, /replaceAll\('-', '_'\)/);
assert.doesNotMatch(skinData, /querySelector|innerHTML/);
assert.equal((skinData.match(/makeSidebarToolboxItems\(context\)/g) || []).length, 1);
const skin = read('components/SkinVector2022.vue');
assert.match(skin, /<SkinOrigin/);
assert.match(skin, /data-tt-host-content="1"/);
assert.doesNotMatch(skin, /<header|<main|vector-page-titlebar/);
assert.match(skin, /isSettingsToggleTarget/);
const environment = read('lib/vector2022DocumentEnvironment.js');
assert.match(environment, /skin-vector-2022/);
assert.match(environment, /vector-feature-limited-width-clientpref-/);
assert.match(environment, /config\['skin\.vector-2022\.font_size'\]/);
const composable = json('COMPOSABLE-SKIN.json');
assert.equal(composable.entry, 'components/Vector2022VariantLayout.vue');
assert.equal(composable.contentSurface, 'host');

console.log('Vector 2022 upstream-template and host-boundary parity contract passed.');
