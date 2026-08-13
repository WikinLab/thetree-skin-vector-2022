#!/usr/bin/env node
import assert from 'node:assert/strict';
import { makeTheTreeWatchstarItem } from '../lib/adapters/thetree-watchstar.js';
import { makeMenuListItem } from '../lib/vector2022TemplateData.js';
import { DOCUMENT_ACTION_MAP } from '../lib/vector2022HostAdapterPolicy.js';

const mapping = DOCUMENT_ACTION_MAP.find((row) => row.id === 'document.action.watchstar');
const document = Object.freeze({ namespace: '문서', title: '주시 기능' });
const makeItem = (pageData, loggedIn = true) => makeTheTreeWatchstarItem({
  mapping,
  document,
  pageData,
  loggedIn,
  makeActionTarget: (target, action) => `/${action}/${target.title}`
});

assert.equal(makeItem({ starred: false }, false), null);
assert.equal(makeItem({}, true), null);
const watch = makeItem({ starred: false });
const unwatch = makeItem({ starred: true });
assert.equal(watch.id, 'ca-watch');
assert.equal(unwatch.id, 'ca-unwatch');
assert.match(makeMenuListItem(watch).class, /\bmw-watchlink\b/);
assert.equal(makeMenuListItem(watch)['array-links'][0]['array-attributes'][0].value, '/member/star/주시 기능');

console.log('Vector 2022 watchstar adapter contract passed.');
