/*
 * Vue-side equivalents of small REL1_46 Vector component getTemplateData()
 * helpers. Host-shaped input is accepted only at these adapter entrypoints;
 * every returned template-data object uses the exact upstream Mustache keys.
 */

export function normalizeClass(...parts) {
  return parts
    .flatMap((part) => {
      if (!part) return [];
      if (Array.isArray(part)) return part;
      if (typeof part === 'object') {
        return Object.entries(part).filter(([, enabled]) => enabled).map(([name]) => name);
      }
      return String(part).split(/\s+/);
    })
    .map((part) => String(part).trim())
    .filter(Boolean)
    .filter((part, index, array) => array.indexOf(part) === index)
    .join(' ');
}

export function makeButtonData({
  label = '',
  icon = null,
  id = null,
  class: extraClass = null,
  attributes = {},
  weight = 'normal',
  action = 'default',
  iconOnly = false,
  href = null
} = {}) {
  let normalisedWeight = weight;
  if (normalisedWeight !== 'primary' && normalisedWeight !== 'quiet') {
    normalisedWeight = 'normal';
  }

  let normalisedAction = action;
  if (normalisedAction !== 'progressive' && normalisedAction !== 'destructive') {
    normalisedAction = 'default';
  }

  const buttonClass = normalizeClass(
    'cdx-button',
    href && 'cdx-button--fake-button cdx-button--fake-button--enabled',
    normalisedWeight === 'primary' && 'cdx-button--weight-primary',
    normalisedWeight === 'quiet' && 'cdx-button--weight-quiet',
    normalisedAction === 'progressive' && 'cdx-button--action-progressive',
    normalisedAction === 'destructive' && 'cdx-button--action-destructive',
    iconOnly && 'cdx-button--icon-only',
    extraClass
  );

  return {
    label,
    icon,
    id,
    class: buttonClass,
    href,
    'array-attributes': Object.entries(attributes || {})
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => ({ key, value }))
  };
}

export function serializeVector2022Href(target) {
  if (!target) return null;
  if (typeof target === 'string') return target;
  if (typeof target !== 'object') return String(target);

  const path = target.path || target.href || target.url || null;
  if (!path) return null;

  const query = target.query && typeof target.query === 'object'
    ? Object.entries(target.query).filter(([, value]) => value !== null && value !== undefined)
    : [];
  if (!query.length) return path;

  const params = new URLSearchParams();
  for (const [key, value] of query) {
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, entry);
    } else {
      params.set(key, value);
    }
  }
  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
}

export function normalizeLinkArrayAttributes({ href = null, to = null, arrayAttributes = [] } = {}) {
  const attrs = Array.isArray(arrayAttributes) ? [...arrayAttributes] : [];
  const hasHref = attrs.some((attribute) => attribute && attribute.key === 'href');
  const normalizedHref = href || serializeVector2022Href(to);
  if (normalizedHref && !hasHref) {
    attrs.unshift({ key: 'href', value: normalizedHref });
  }
  return attrs;
}

export function makeLinkData({
  href = null,
  to = null,
  text = '',
  label = '',
  icon = null,
  arrayAttributes = []
} = {}) {
  return {
    icon,
    text: text || label,
    'array-attributes': normalizeLinkArrayAttributes({ href, to, arrayAttributes })
  };
}

export function makeMenuListItem(item = {}) {
  const text = item.text || item.label || '';
  const providedLinks = Array.isArray(item.arrayLinks) ? item.arrayLinks : [];
  const arrayLinks = providedLinks.length
    ? providedLinks.map((link) => makeLinkData({ ...link, text: link.text || link.label || text }))
    : [makeLinkData({
      href: item.href,
      to: item.to,
      text,
      icon: item.icon,
      arrayAttributes: item.arrayAttributes
    })].filter((link) => link['array-attributes'].some((attribute) => attribute.key === 'href'));

  return {
    id: item.id || null,
    class: normalizeClass(
      'mw-list-item',
      item.class,
      item.itemClass,
      item.classes,
      {
        selected: item.selected,
        new: item.new,
        icon: item.icon,
        collapsible: item.collapsible,
        'mw-watchlink': item.watchlink,
        'mw-watchlink-temp': item.watchlinkTemp
      }
    ),
    text: arrayLinks.length ? '' : text,
    'array-links': arrayLinks
  };
}

export function makeMenuData(data = {}) {
  const arrayListItems = Array.isArray(data['array-list-items'])
    ? data['array-list-items']
    : [];

  return {
    id: data.id || null,
    class: data.class || '',
    label: data.label || '',
    'html-tooltip': data['html-tooltip'] || '',
    'html-user-language-attributes': data['html-user-language-attributes'] || '',
    'aria-label': data['aria-label'] || '',
    'checkbox-class': data['checkbox-class'] || '',
    'heading-class': data['heading-class'] || '',
    'html-vector-heading-icon': data['html-vector-heading-icon'] || '',
    'is-dropdown': !!data['is-dropdown'],
    'html-before-portal': data['html-before-portal'] || '',
    'html-items': data['html-items'] || '',
    'html-after-portal': data['html-after-portal'] || '',
    'array-list-items': arrayListItems.map((item) => makeMenuListItem(item))
  };
}
