/*
 * the tree starred-document state -> MediaWiki Vector legacy watchstar item.
 *
 * This adapter owns the host-specific state field and action routes. Vector's
 * upstream portlet template, watchstar classes, icons, and responsive behavior
 * remain unchanged.
 */

function stateValue(pageData, mapping) {
  const field = mapping?.source?.stateField;
  const value = field ? pageData?.[field] : undefined;
  return typeof value === 'boolean' ? value : null;
}

export function makeTheTreeWatchstarItem({
  mapping = {},
  document = null,
  pageData = {},
  loggedIn = false,
  makeActionTarget = () => null
} = {}) {
  if (!document) return null;
  if (mapping?.source?.accountType === 'logged-in' && !loggedIn) return null;

  const active = stateValue(pageData, mapping);
  if (active === null) return null;

  const source = mapping.source || {};
  const target = mapping.target || {};
  const action = active ? source.activeAction : source.action;
  const id = active ? target.activeItemId : target.itemId;
  const label = active ? target.activeLabelFallback : target.labelFallback;
  const tooltip = active ? target.activeTooltipFallback : target.tooltipFallback;
  if (!action || !id || !label) return null;

  return {
    id,
    label,
    to: makeActionTarget(document, action),
    class: 'icon',
    watchlink: true,
    arrayAttributes: tooltip ? [{ key: 'title', value: tooltip }] : []
  };
}
