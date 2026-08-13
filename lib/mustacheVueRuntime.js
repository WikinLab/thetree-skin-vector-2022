import Mustache from 'mustache';
import { parseFragment } from 'parse5';
import { Fragment, cloneVNode, h, isVNode } from 'vue';

const MARKER_OPEN = '\uE000MVR:';
const MARKER_CLOSE = '\uE001';
const MARKER_PATTERN = /\uE000MVR:(\d+)\uE001/g;

function toHtmlString(value) {
  if (Array.isArray(value)) return value.map((item) => toHtmlString(item)).join('');
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return value.html || value.htmlItem || value['html-item'] || String(value);
}

function marker(id) {
  return `${MARKER_OPEN}${id}${MARKER_CLOSE}`;
}

class VueBoundaryWriter extends Mustache.Writer {
  constructor(rawRecords) {
    super();
    this.rawRecords = rawRecords;
  }

  unescapedValue(token, context) {
    const value = context.lookup(token[1]);
    if (value === null || value === undefined) return '';
    const slotName = value && value.__mustacheVueSlot;
    const record = slotName
      ? { kind: 'slot', value: String(slotName) }
      : { kind: 'raw', value: toHtmlString(value) };
    return marker(this.rawRecords.push(record) - 1);
  }
}

function materializeRawValues(html, records) {
  return html.replace(MARKER_PATTERN, (match, idText) => {
    const record = records[Number(idText)];
    if (!record) throw new Error(`Unknown Mustache/Vue marker ${idText}`);
    return record.kind === 'raw' ? record.value : match;
  });
}

function makeSlotAwareView(data, slotNames) {
  const base = data && typeof data === 'object' ? data : { '.': data };
  return new Proxy(base, {
    has(target, key) {
      return slotNames.has(String(key)) || Reflect.has(target, key);
    },
    get(target, key, receiver) {
      const name = String(key);
      if (slotNames.has(name)) return { __mustacheVueSlot: name };
      return Reflect.get(target, key, receiver);
    }
  });
}

function renderNamedSlot(slotName, slot) {
  const children = slot();
  const normalized = Array.isArray(children) ? children : [children];
  const key = `mvr-slot:${slotName}`;
  if (normalized.length === 1 && isVNode(normalized[0])) {
    const child = normalized[0];
    return cloneVNode(child, child.key == null ? { key } : null);
  }
  return h(Fragment, { key }, normalized);
}

function renderText(value, context) {
  const rendered = [];
  let cursor = 0;
  MARKER_PATTERN.lastIndex = 0;
  for (let match = MARKER_PATTERN.exec(value); match; match = MARKER_PATTERN.exec(value)) {
    if (match.index > cursor) rendered.push(value.slice(cursor, match.index));
    const record = context.rawRecords[Number(match[1])];
    if (!record || record.kind !== 'slot') {
      throw new Error(`Mustache/Vue marker ${match[1]} is not a renderable slot`);
    }
    const slot = context.slots[record.value];
    if (slot) rendered.push(renderNamedSlot(record.value, slot));
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) rendered.push(value.slice(cursor));
  return rendered;
}

function nodeChildren(node) {
  return node.tagName === 'template' && node.content
    ? node.content.childNodes || []
    : node.childNodes || [];
}

function renderTree(nodes, context, topLevel = false) {
  const rendered = [];
  for (const node of nodes) {
    if (node.nodeName === '#text') {
      rendered.push(...renderText(node.value || '', context));
      continue;
    }
    if (!node.tagName) continue;

    const props = {};
    for (const attribute of node.attrs || []) {
      const name = attribute.prefix ? `${attribute.prefix}:${attribute.name}` : attribute.name;
      if (String(attribute.value).includes(MARKER_OPEN) || name.includes(MARKER_OPEN)) {
        throw new Error('Vue slots cannot be rendered inside an HTML attribute');
      }
      props[name] = attribute.value;
    }
    if (props.id) props.key = `mvr-id:${props.id}`;
    if (topLevel && context.eventBoundary) {
      props.onClick = (event) => context.emit('click', event);
      props.onSubmit = (event) => {
        if (context.interceptEvents.has('submit')) event.preventDefault();
        context.emit('submit', event);
      };
    }
    rendered.push(h(node.tagName, props, renderTree(nodeChildren(node), context, false)));
  }
  return rendered;
}

export function renderMustacheTemplate(template, view, partials = {}, rawRecords = []) {
  const writer = new VueBoundaryWriter(rawRecords);
  const rendered = writer.render(template, view, partials);
  return materializeRawValues(rendered, rawRecords);
}

export function createMustacheVueComponent({ name, template, partials = {} }) {
  Mustache.parse(template);
  for (const partial of Object.values(partials)) Mustache.parse(partial);
  return {
    name,
    inheritAttrs: false,
    emits: ['click', 'submit'],
    props: {
      data: {
        default: () => ({})
      },
      eventBoundary: {
        type: Boolean,
        default: true
      },
      interceptEvents: {
        type: Array,
        default: () => []
      }
    },
    render() {
      const rawRecords = [];
      const slotNames = new Set(Object.keys(this.$slots));
      const view = makeSlotAwareView(this.data, slotNames);
      const html = renderMustacheTemplate(template, view, partials, rawRecords);
      const tree = parseFragment(html).childNodes || [];
      const children = renderTree(tree, {
        rawRecords,
        slots: this.$slots,
        emit: (event, payload) => this.$emit(event, payload),
        eventBoundary: this.eventBoundary,
        interceptEvents: new Set(this.interceptEvents)
      }, true);
      return h(Fragment, null, children);
    }
  };
}
