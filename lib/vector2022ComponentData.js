import { makeButtonData, makeMenuData, normalizeClass } from './vector2022TemplateData.js';

export function resolveTarget(context, target, fallback = '#') {
  if (typeof target === 'string') return target;
  if (!target) return fallback;
  const resolver = context.linkBuilders?.href;
  if (typeof resolver === 'function') return resolver(target);
  if (target.path) {
    const query = new URLSearchParams(target.query || {}).toString();
    return `${target.path}${query ? `?${query}` : ''}`;
  }
  return fallback;
}

export function makeMenu(id, label, items, context, className = '') {
  return makeMenuData({
    id,
    label,
    class: normalizeClass('mw-portlet', className),
    'array-list-items': (items || []).map((item) => ({
      ...item,
      href: item.href || resolveTarget(context, item.to),
      class: normalizeClass(item.class, item.selected && 'selected')
    }))
  });
}

export function makeDropdown(id, label, { className = '', icon = null, tooltip = '' } = {}) {
  const labelClass = normalizeClass(
    'cdx-button cdx-button--fake-button cdx-button--fake-button--enabled cdx-button--weight-quiet',
    icon && 'cdx-button--icon-only'
  );
  return {
    id,
    label,
    'label-class': labelClass,
    icon,
    class: className,
    'html-tooltip': tooltip ? `title="${String(tooltip).replaceAll('"', '&quot;')}"` : '',
    'html-vector-menu-label-attributes': '',
    'html-vector-menu-checkbox-attributes': '',
    'checkbox-class': ''
  };
}

export function makePinnable(id, featureName, label, pinned, message, labelTagName = 'div') {
  return {
    id,
    'is-pinned': pinned,
    'data-pinnable-header': {
      'is-pinned': pinned,
      label,
      'label-tag-name': labelTagName,
      'pin-label': message('vector-pin-element-label'),
      'unpin-label': message('vector-unpin-element-label'),
      'data-pinnable-element-id': id,
      'data-feature-name': featureName,
      'data-unpinned-container-id': `${id}-unpinned-container`,
      'data-pinned-container-id': `${id}-pinned-container`
    }
  };
}

export function makeSearchData(context, message, { primary = true, collapsible = true, formId = 'searchform' } = {}) {
  const query = String(context.route?.query?.q || '');
  const siteName = String(context.config?.site_name || context.config?.['wiki.site_name'] || message('sitetitle'));
  const attributes = [
    'name="search"',
    'type="search"',
    `placeholder="${siteName.replaceAll('"', '&quot;')} 검색"`,
    `aria-label="${siteName.replaceAll('"', '&quot;')} 검색"`,
    'autocapitalize="none"',
    'spellcheck="false"',
    `value="${query.replaceAll('"', '&quot;')}"`
  ].join(' ');
  return {
    class: normalizeClass(
      'vector-search-box-vue',
      collapsible && 'vector-search-box-collapses',
      'vector-search-box-show-thumbnail',
      primary && 'vector-search-box-auto-expand-width'
    ),
    'is-collapsible': collapsible,
    'is-thumbnail': true,
    'is-auto-expand': primary,
    'is-primary': primary,
    'form-id': formId,
    'input-location': 'header-moved',
    'form-action': '/Search',
    'page-title': 'Special:Search',
    'html-input-attributes': attributes,
    'msg-searchsuggest-search': message('searchsuggest-search'),
    'msg-searchbutton': message('searchbutton'),
    'data-collapsed-search-button': makeButtonData({
      label: message('search'),
      icon: 'search',
      class: 'search-toggle',
      weight: 'quiet',
      iconOnly: true,
      href: '/Search'
    })
  };
}

function normalizedHeadingLevel(heading, baseLevel) {
  const fromNumber = String(heading?.num || '').split('.').filter(Boolean).length;
  if (fromNumber) return fromNumber;
  const level = Number(heading?.actualLevel || heading?.level || baseLevel);
  return Math.max(1, level - baseLevel + 1);
}

export function makeTableOfContents(headings, pinned, message, collapseAt = 28) {
  const input = Array.isArray(headings) ? headings.filter(Boolean) : [];
  if (!input.length) return null;
  const baseLevel = Math.min(...input.map((heading) => Number(heading.level) || 1));
  const roots = [];
  const stack = [{ level: 0, children: roots }];
  input.forEach((heading, index) => {
    const level = normalizedHeadingLevel(heading, baseLevel);
    const anchor = String(heading.anchor || `s-${heading.num || index + 1}`);
    const node = {
      anchor,
      linkAnchor: anchor,
      number: String(heading.num || index + 1),
      line: String(heading.title || ''),
      toclevel: level,
      'is-top-level-section': level === 1,
      'is-parent-section': false,
      'array-sections': []
    };
    while (stack.length > 1 && stack.at(-1).level >= level) stack.pop();
    stack.at(-1).children.push(node);
    stack.push({ level, children: node['array-sections'], node });
  });
  const markParents = (items) => items.forEach((item) => {
    item['is-parent-section'] = item['array-sections'].length > 0;
    if (item['is-top-level-section'] && item['is-parent-section']) {
      item['vector-button-label'] = `${message('vector-toc-toggle-button-label')}: ${item.line}`;
    }
    markParents(item['array-sections']);
  });
  markParents(roots);
  return {
    ...makePinnable('vector-toc', 'toc-pinned', message('vector-toc-label'), pinned, message, 'h2'),
    'msg-vector-toc-beginning': message('vector-toc-beginning'),
    'array-sections': roots,
    'number-section-count': input.length,
    'vector-is-collapse-sections-enabled': roots.length > 3 && input.length >= collapseAt
  };
}
