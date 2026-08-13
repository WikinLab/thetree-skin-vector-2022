/*
 * the tree -> REL1_46 Vector 2022 data adapter boundary.
 *
 * Components should not infer MediaWiki template data directly from Pinia store
 * shapes.  They should first build this normalized context, then call the
 * upstream-shaped adapter helpers below.  This keeps unavoidable the tree
 * differences in one compatibility layer instead of spreading them across
 * Mustache-shaped Vue component ports.
 */

import {
  DOCUMENT_ACTION_MAP,
  NAMESPACE_MAP,
  PERSONAL_TOOL_MAP,
  SEARCH_TARGET_POLICY,
  SIDEBAR_NAVIGATION_MAP,
  SIDEBAR_TOOLBOX_MAP,
  featureRowsForPortlet,
  getConfiguredString
} from './vector2022HostAdapterPolicy';
import { getVector2022PageContract, makeVector2022PageContract } from './vector2022PageContract';
import { makeTheTreeWatchstarItem } from './adapters/thetree-watchstar';
import { settingsToggleAttributes } from './adapters/thetree-settings';

export function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function makeVector2022TheTreeContext({ storeState = {}, route = {}, linkBuilders = {} } = {}) {
  const page = storeState.page || {};
  const pageData = page.data || {};
  const config = storeState.config || {};
  const session = storeState.session || {};
  const baseContext = {
    page,
    pageData,
    viewData: storeState.viewData || {},
    config,
    session,
    localConfig: storeState.localConfig || {},
    currentTheme: storeState.currentTheme || 'light',
    route,
    linkBuilders
  };

  return {
    ...baseContext,
    pageContract: makeVector2022PageContract(baseContext)
  };
}

export function getVector2022PageData(context = {}) {
  return context.pageData || context.page?.data || {};
}


export function getVector2022Document(context = {}) {
  return getVector2022PageData(context).document || null;
}

export function hasVector2022Document(context = {}) {
  return !!getVector2022Document(context);
}

export function getVector2022Account(context = {}) {
  return context.session?.account || {};
}

export function isVector2022AccountLoggedIn(context = {}) {
  return getVector2022Account(context).type === 1;
}

export function getRedirectPath(context = {}) {
  return context.route?.fullPath || '/';
}

export function getVector2022SearchQuery(context = {}) {
  return context.route?.query?.q || '';
}

function callBuilder(context, name, ...args) {
  const fn = context.linkBuilders?.[name];
  return typeof fn === 'function' ? fn(...args) : null;
}

function hasItemTarget(item = {}) {
  return !!(item.to || item.href || item.arrayLinks?.length);
}

function normalizeAdapterItem(item = {}, index = 0, prefix = 'item') {
  if (!item || item.hidden === true || item.disabled === true) return null;
  const label = typeof item.label === 'string' ? item.label : '';
  if (!label) return null;

  const normalized = {
    ...item,
    id: item.id || `${prefix}-${index}`,
    label,
    text: item.text || label,
    to: item.to || null,
    href: item.href || null,
    selected: !!item.selected,
    collapsible: !!item.collapsible,
    watchlink: !!item.watchlink,
    watchlinkTemp: !!item.watchlinkTemp
  };

  if (!hasItemTarget(normalized)) {
    delete normalized.to;
    delete normalized.href;
  }

  return normalized;
}

function normalizeAdapterItems(items = [], prefix = 'item') {
  const seen = new Set();
  return ensureArray(items)
    .map((item, index) => normalizeAdapterItem(item, index, prefix))
    .filter(Boolean)
    .filter((item) => {
      const key = item.id || `${item.text}-${item.href || item.to || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function makeUserDocumentTarget(context, userName, accountType = 1) {
  return callBuilder(context, 'userDocument', userName, accountType) || {
    namespace: accountType === 1 ? '사용자' : '아이피사용자',
    title: userName || ''
  };
}

export function makeDocumentActionTarget(context, documentOrTitle, action, query = {}) {
  return callBuilder(context, 'documentAction', documentOrTitle, action, query) || '/';
}

export function makeContributionTarget(context, uuid) {
  return callBuilder(context, 'contribution', uuid) || '/RecentChanges';
}

export function getRelevantUserUuid(context = {}) {
  const pageData = getVector2022PageData(context);
  if (pageData.user?.uuid) return pageData.user.uuid;
  if (pageData.account?.uuid) return pageData.account.uuid;

  const document = getVector2022Document(context);
  const account = getVector2022Account(context);
  const isUserDocument = document && ['사용자', '아이피사용자'].includes(document.namespace);
  const accountName = account.name || account.username || '';
  return isUserDocument && account.uuid && accountName && document.title === accountName
    ? account.uuid
    : null;
}

function mappedLabel(mapping, accountName = '', context = {}) {
  if (mapping.target.labelSource === 'accountName') return accountName;
  if (mapping.target.labelSource === 'notificationCount') {
    const count = ensureArray(context.session?.notifications).length;
    return count ? `알림 (${count >= 5 ? '5+' : count})` : mapping.target.labelFallback;
  }
  return mapping.target.labelFallback || '';
}

function mappedPersonalTarget(context, mapping, account) {
  switch (mapping.transform.kind) {
    case 'no-target':
      return null;
    case 'login-with-redirect':
      return { path: mapping.source.route, query: { redirect: getRedirectPath(context) } };
    case 'logout-with-redirect':
      return { path: mapping.source.route, query: { redirect: getRedirectPath(context) } };
    case 'static-route':
      return mapping.source.route;
    case 'settings-action':
      return null;
    case 'user-document':
      return makeDocumentActionTarget(
        context,
        makeUserDocumentTarget(context, account.name || account.username || '', account.type),
        SEARCH_TARGET_POLICY.goAction
      );
    case 'user-discussion':
      return makeDocumentActionTarget(
        context,
        makeUserDocumentTarget(context, account.name || account.username || '', account.type),
        'discuss'
      );
    case 'contribution':
      return makeContributionTarget(context, account.uuid);
    default:
      return null;
  }
}

export function makePersonalToolsItems(context = {}) {
  const account = getVector2022Account(context);
  const accountType = isVector2022AccountLoggedIn(context) ? 'logged-in' : 'anonymous';
  const accountName = account.name || account.username || '';
  const baseItems = PERSONAL_TOOL_MAP.map((mapping) => {
    if (mapping.source.accountType !== accountType) return null;
    if (mapping.source.requires === 'uuid' && !account.uuid) return null;
    if (mapping.target.labelSource === 'accountName' && !accountName) return null;

    const item = {
      id: mapping.target.itemId,
      label: mappedLabel(mapping, accountName, context),
      to: mappedPersonalTarget(context, mapping, account)
    };
    if (mapping.transform.kind === 'settings-action') {
      item.href = '#';
      item.arrayAttributes = settingsToggleAttributes();
    }
    if (mapping.id === 'personal.notifications') {
      const unreadCount = ensureArray(context.session?.notifications).length;
      item.arrayAttributes = [{
        key: 'title',
        value: unreadCount ? `읽지 않은 알림 ${unreadCount >= 5 ? '5개 이상' : `${unreadCount}개`}` : '알림'
      }];
    }
    return item;
  });

  return normalizeAdapterItems(baseItems, `pt-${accountType}`);
}

function makeDocumentMappedItems(context, featureMap, portletKey, isSelected) {
  const document = getVector2022Document(context);
  if (!document) return [];

  return normalizeAdapterItems(featureRowsForPortlet(featureMap, portletKey).map((mapping) => {
    if (mapping.transform.kind === 'watchstar') {
      return makeTheTreeWatchstarItem({
        mapping,
        document,
        pageData: getVector2022PageData(context),
        loggedIn: isVector2022AccountLoggedIn(context),
        makeActionTarget: (targetDocument, action) => (
          makeDocumentActionTarget(context, targetDocument, action)
        )
      });
    }

    const revisionContext = mapping.transform?.revisionContext;
    const pageData = getVector2022PageData(context);
    const query = revisionContext === 'uuid' && pageData.uuid
      ? { uuid: pageData.uuid }
      : revisionContext === 'from' && pageData.rev
        ? { from: pageData.rev }
        : {};
    const discussProgress = mapping.source.action === 'discuss' && !!pageData.discuss_progress;

    return {
      id: mapping.target.itemId,
      label: mapping.target.labelFallback,
      to: makeDocumentActionTarget(context, document, mapping.source.action, query),
      selected: isSelected(mapping),
      collapsible: !!mapping.target.collapsible,
      class: discussProgress ? 'tt-discuss-progress' : null,
      arrayAttributes: discussProgress
        ? [{ key: 'title', value: '진행 중인 토론 또는 편집 요청이 있습니다' }]
        : []
    };
  }), `mapped-${portletKey}`);
}

export function makeNamespaceItems(context = {}) {
  const pageContract = getVector2022PageContract(context);
  return makeDocumentMappedItems(
    context,
    NAMESPACE_MAP,
    'data-associated-pages',
    (mapping) => mapping.target.namespaceKind === pageContract.namespaceKind
  );
}

export function makeViewItems(context = {}) {
  const pageContract = getVector2022PageContract(context);
  return makeDocumentMappedItems(
    context,
    DOCUMENT_ACTION_MAP,
    'data-views',
    (mapping) => mapping.target.itemId === pageContract.selectedActionItemId
  );
}

export function makeActionItems(context = {}) {
  const pageContract = getVector2022PageContract(context);
  return makeDocumentMappedItems(
    context,
    DOCUMENT_ACTION_MAP,
    'data-actions',
    (mapping) => mapping.target.itemId === pageContract.selectedActionItemId
  );
}

function makeStaticFeatureItems(featureMap, prefix, context = {}) {
  return normalizeAdapterItems(featureMap.map((mapping) => {
    if (mapping.transform.kind === 'relevant-user-contribution') {
      const uuid = getRelevantUserUuid(context);
      if (!uuid) return null;
      return {
        id: mapping.target.itemId,
        label: mapping.target.labelFallback,
        to: makeContributionTarget(context, uuid)
      };
    }
    return {
      id: mapping.target.itemId,
      label: mapping.target.labelFallback,
      to: mapping.source.route
    };
  }), prefix);
}

export function makeSidebarNavigationItems() {
  return makeStaticFeatureItems(SIDEBAR_NAVIGATION_MAP, 'n-navigation');
}

export function makeSidebarToolboxItems(context = {}) {
  return makeStaticFeatureItems(SIDEBAR_TOOLBOX_MAP, 't-toolbox', context);
}

function makeHostSessionMenuItem(item = {}, index = 0) {
  if (!item || item.disabled === true || item.hidden === true) return null;
  const label = typeof item.t === 'string' ? item.t : '';
  if (!label) return null;
  return {
    id: item.id || `pt-user-${index}`,
    label,
    to: item.l || null
  };
}

export function makeSidebarPersonalItems(context = {}) {
  return normalizeAdapterItems(ensureArray(context.session?.menus).map(makeHostSessionMenuItem), 'pt-user');
}

export function makeLanguageItems() {
  return [];
}

export function makeFooterPlacesHtml(context = {}) {
  return getConfiguredString(context.config || {}, 'footerPlacesHtml', '');
}


function parseFooterPlaceItemsFromHtml(html) {
  const raw = String(html || '').trim();
  if (!raw) return [];

  const itemPattern = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
  const items = [];
  let match;
  while ((match = itemPattern.exec(raw))) {
    const attrs = match[1] || '';
    const idMatch = /\bid=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(attrs);
    items.push({
      id: idMatch?.[1] || idMatch?.[2] || idMatch?.[3] || `footer-places-item-${items.length}`,
      html: match[2] || ''
    });
  }

  if (items.length) return items;
  return [{ id: 'footer-places-the-tree', html: raw }];
}

export function makeFooterPlacesData(context = {}) {
  const html = makeFooterPlacesHtml(context);
  const arrayItems = parseFooterPlaceItemsFromHtml(html);
  if (!arrayItems.length) return null;

  return {
    id: 'footer-places',
    className: null,
    'array-items': arrayItems
  };
}

export function makeIndicatorsData(pageState = {}) {
  const pageData = pageState.data || {};
  return ensureArray(pageData.indicators).map((indicator, index) => ({
    id: indicator?.id || `mw-indicator-${index}`,
    class: indicator?.class || 'mw-indicator',
    html: indicator?.html || ''
  }));
}

export function makeDockBottomData(pageState = {}) {
  const pageData = pageState.data || {};
  const dock = pageData.dockBottom;
  if (!dock) return null;

  return {
    id: dock.id || 'mw-dock-bottom',
    class: dock.class || '',
    'array-items': ensureArray(dock.arrayItems).filter(Boolean).map((item) => {
      if (item['html-item']) return { 'html-item': item['html-item'] };
      if (item.htmlItem) return { 'html-item': item.htmlItem };
      if (!item.html) return { 'html-item': '' };
      const id = item.id ? ` id="${escapeHtml(item.id)}"` : '';
      return { 'html-item': `<li${id}>${item.html}</li>` };
    })
  };
}

export function makeVector2022FooterIconData() {
  return {
    id: 'footer-icons',
    className: null,
    'array-items': [
      { id: 'footer-poweredbyico', html: 'Vector for the tree' }
    ]
  };
}
