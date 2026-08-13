import {
  makeActionItems,
  makeFooterPlacesData,
  makeIndicatorsData,
  makeNamespaceItems,
  makePersonalToolsItems,
  makeSidebarNavigationItems,
  makeSidebarPersonalItems,
  makeSidebarToolboxItems,
  makeViewItems
} from './vector2022TheTreeAdapter.js';
import { makeFooterInfoData } from './vector2022FooterData.js';
import { buildVector2022SkinTitleData, buildVector2022TitleHeadingData } from './vector2022TitleData.js';
import { getVector2022PageContract } from './vector2022PageContract.js';
import { makeButtonData } from './vector2022TemplateData.js';
import {
  makeDropdown,
  makeMenu,
  makePinnable,
  makeSearchData,
  makeTableOfContents,
  resolveTarget
} from './vector2022ComponentData.js';
import { makeVector2022MessageLocalizer } from './vector2022Messages.js';

function stringConfig(config, keys, fallback = '') {
  for (const key of keys) {
    const value = config?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return fallback;
}

function numericConfig(config, key) {
  const value = Number(config?.[key]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function logoData(config, message) {
  const icon = stringConfig(config, ['skin.vector-2022.logo_icon', 'wiki.logo_url', 'logo_url']);
  const wordmarkSrc = stringConfig(config, ['skin.vector-2022.logo_wordmark']);
  const wordmarkWidth = numericConfig(config, 'skin.vector-2022.logo_wordmark_width');
  const wordmarkHeight = numericConfig(config, 'skin.vector-2022.logo_wordmark_height');
  const taglineSrc = stringConfig(config, ['skin.vector-2022.logo_tagline']);
  const taglineWidth = numericConfig(config, 'skin.vector-2022.logo_tagline_width');
  const taglineHeight = numericConfig(config, 'skin.vector-2022.logo_tagline_height');
  const imageData = (src, width, height) => src && width && height ? {
    src,
    width,
    height,
    style: `width: ${width / 16}em; height: ${height / 16}em;`
  } : null;
  return {
    icon: icon || null,
    wordmark: imageData(wordmarkSrc, wordmarkWidth, wordmarkHeight),
    tagline: imageData(taglineSrc, taglineWidth, taglineHeight),
    'msg-sitetitle': stringConfig(config, ['site_name', 'wiki.site_name'], message('sitetitle')),
    'msg-sitesubtitle': stringConfig(config, ['site_subtitle', 'wiki.site_subtitle'], message('sitesubtitle'))
  };
}

function pinned(context, key, fallback = true) {
  const configName = `${key.replaceAll('-', '_')}_pinned`;
  const value = context.localConfig?.[`vector-${key}-pinned`]
    ?? context.localConfig?.[`skin.vector-2022.${configName}`]
    ?? context.config?.[`skin.vector-2022.${configName}`];
  return value == null ? fallback : ![false, 0, '0', 'false'].includes(value);
}

function mainMenu(context, message) {
  const isPinned = pinned(context, 'main-menu');
  const navigation = makeMenu('p-navigation', message('navigation'), makeSidebarNavigationItems(context), context, 'vector-menu-portal portal');
  const host = makeSidebarPersonalItems(context);
  return {
    ...makePinnable('vector-main-menu', 'main-menu-pinned', message('vector-main-menu-label'), isPinned, message),
    'data-portlets-first': navigation,
    'array-portlets-rest': [host.length ? makeMenu('p-host', message('personaltools'), host, context, 'vector-menu-portal portal') : null].filter(Boolean),
    'data-languages': null,
    'is-languages-included': false
  };
}

function pageTools(context, message) {
  const isPinned = pinned(context, 'page-tools');
  const actions = makeActionItems(context);
  const tools = makeSidebarToolboxItems(context);
  return {
    ...makePinnable('vector-page-tools', 'page-tools-pinned', message('vector-page-tools-label'), isPinned, message),
    'data-menus': [
      actions.length ? makeMenu('p-cactions', message('vector-page-tools-actions-label'), actions, context, 'vector-menu-portal portal') : null,
      tools.length ? makeMenu('p-tb', message('vector-page-tools-general-label'), tools, context, 'vector-menu-portal portal') : null
    ].filter(Boolean)
  };
}

function userLinks(context, message) {
  const items = makePersonalToolsItems(context);
  const preferences = items.filter((item) => item.id === 'pt-preferences');
  const userPage = items.filter((item) => ['pt-userpage', 'pt-mytalk'].includes(item.id));
  const notifications = items.filter((item) => ['pt-notifications', 'pt-notifications-alert', 'pt-notifications-notice'].includes(item.id));
  const overflow = items.filter((item) => !preferences.includes(item) && !userPage.includes(item) && !notifications.includes(item));
  const menu = (id, values, className = '') => values.length ? makeMenu(id, '', values, context, className) : null;
  const menus = [menu('p-personal', overflow, 'vector-user-menu-overflow')].filter(Boolean);
  return {
    'is-wide': items.length > 3,
    'msg-personaltools': message('personaltools'),
    'data-user-links-preferences': menu('p-user-interface-preferences', preferences),
    'data-user-links-user-page': menu('p-user-page', userPage),
    'data-user-links-notifications': menu('p-notifications', notifications),
    'data-user-links-overflow': null,
    'data-user-links-dropdown': makeDropdown('vector-user-links-dropdown', message('personaltools'), { icon: 'ellipsis' }),
    'data-user-links-menus': menus
  };
}

function footerData(context) {
  const contract = getVector2022PageContract(context);
  return {
    'data-info': makeFooterInfoData(context.page, contract),
    'data-places': makeFooterPlacesData(context),
    'data-icons': null
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function stickyHeaderData(context, message) {
  const namespaces = makeNamespaceItems(context);
  const views = makeViewItems(context);
  const item = (...ids) => [...namespaces, ...views].find((candidate) => ids.includes(candidate.id)) || null;
  const stickyButton = ({ sourceIds, id, event, icon, className = '' }) => {
    const source = item(...sourceIds);
    return makeButtonData({
      label: source?.label || '',
      icon,
      id,
      class: className,
      attributes: { tabindex: '-1', 'data-event-name': event },
      href: source ? resolveTarget(context, source.href || source.to) : '#'
    });
  };
  const document = context.pageData?.document;
  const addSectionTarget = document && typeof context.linkBuilders?.documentAction === 'function'
    ? context.linkBuilders.documentAction(document, 'edit', { section: 'new' })
    : null;
  return {
    'array-icon-buttons': [
      stickyButton({ sourceIds: ['ca-talk'], id: 'ca-talk-sticky-header', event: 'talk-sticky-header', icon: 'speechBubbles' }),
      stickyButton({ sourceIds: ['ca-nstab-main'], id: 'ca-subject-sticky-header', event: 'subject-sticky-header', icon: 'article' }),
      stickyButton({ sourceIds: ['ca-history'], id: 'ca-history-sticky-header', event: 'history-sticky-header', icon: 'wikimedia-history' }),
      stickyButton({ sourceIds: ['ca-watch', 'ca-unwatch'], id: 'ca-watchstar-sticky-header', event: 'watch-sticky-header', icon: 'wikimedia-star', className: 'mw-watchlink' }),
      stickyButton({ sourceIds: ['ca-edit'], id: 'ca-edit-sticky-header', event: 'wikitext-edit-sticky-header', icon: 'wikimedia-wikiText' }),
      stickyButton({ sourceIds: ['ca-edit'], id: 'ca-ve-edit-sticky-header', event: 've-edit-sticky-header', icon: 'wikimedia-edit' }),
      stickyButton({ sourceIds: ['ca-edit'], id: 'ca-viewsource-sticky-header', event: 've-edit-protected-sticky-header', icon: 'wikimedia-editLock' })
    ],
    'array-buttons': [makeButtonData({
      label: message('vector-2022-action-addsection', message('skin-action-addsection', 'Add topic')),
      icon: 'speechBubbleAdd-progressive',
      id: 'ca-addsection-sticky-header',
      attributes: { tabindex: '-1', 'data-event-name': 'addsection-sticky-header' },
      weight: 'quiet',
      action: 'progressive',
      href: addSectionTarget ? resolveTarget(context, addSectionTarget) : '#'
    })],
    'data-button-start': makeButtonData({
      label: message('search'),
      icon: 'search',
      class: 'vector-sticky-header-search-toggle',
      attributes: { tabindex: '-1', 'data-event-name': 'ui.vector-sticky-search-form.icon' },
      weight: 'quiet',
      iconOnly: true
    }),
    'data-search': makeSearchData(context, message, {
      primary: false,
      collapsible: false,
      formId: 'vector-sticky-search-form'
    })
  };
}

export function makeVector2022SkinData(context = {}) {
  const config = context.config || {};
  const message = makeVector2022MessageLocalizer(config);
  const pageContract = getVector2022PageContract(context);
  const title = {
    ...buildVector2022SkinTitleData(context.page || {}, config, pageContract),
    ...buildVector2022TitleHeadingData(context.page || {}, pageContract)
  };
  const tocPinned = pinned(context, 'toc');
  const toc = makeTableOfContents(context.pageData?.headings, tocPinned, message, Number(config['skin.vector-2022.toc_collapse_at']) || 28);
  const pageToolsData = pageTools(context, message);
  const appearancePinned = pinned(context, 'appearance');
  const appearance = makePinnable('vector-appearance', 'appearance-pinned', message('vector-appearance-label'), appearancePinned, message);
  const associated = makeNamespaceItems(context);
  const views = makeViewItems(context);
  const siteName = stringConfig(config, ['site_name', 'wiki.site_name'], message('sitetitle'));
  const search = makeSearchData(context, message);
  const tocComponents = toc ? {
    'data-toc': toc,
    'data-toc-pinnable-container': { id: 'vector-toc', 'is-pinned': tocPinned },
    'data-page-titlebar-toc-dropdown': makeDropdown('vector-page-titlebar-toc', message('vector-toc-collapsible-button-label'), {
      className: 'vector-page-titlebar-toc vector-button-flush-left', icon: 'listBullet', tooltip: message('vector-toc-menu-tooltip')
    }),
    'data-page-titlebar-toc-pinnable-container': { id: 'vector-page-titlebar-toc', 'is-pinned': tocPinned },
    'data-sticky-header-toc-dropdown': makeDropdown('vector-sticky-header-toc', message('vector-toc-collapsible-button-label'), {
      className: 'mw-portlet mw-portlet-sticky-header-toc vector-sticky-header-toc vector-button-flush-left', icon: 'listBullet'
    }),
    'data-sticky-header-toc-pinnable-container': { id: 'vector-sticky-header-toc', 'is-pinned': tocPinned }
  } : {};
  return {
    ...title,
    ...tocComponents,
    'msg-vector-jumptocontent': message('vector-jumptocontent'),
    'msg-vector-site-nav-label': message('vector-site-nav-label'),
    'msg-vector-toc-label': message('vector-toc-label'),
    'msg-vector-page-tools-nav-label': message('vector-page-tools-nav-label'),
    'msg-vector-appearance-label': message('vector-appearance-label'),
    'msg-namespaces': message('namespaces'),
    'msg-views': message('views'),
    'msg-personaltools': message('personaltools'),
    'msg-tagline': message('tagline'),
    'msg-sitetitle': siteName,
    'msg-sitesubtitle': message('sitesubtitle'),
    'is-article': pageContract.actionKind === 'view',
    'is-title-blank': !title['page-title'],
    'has-buttons-in-content-top': false,
    'array-indicators': makeIndicatorsData(context.page || {}),
    'data-logos': logoData(config, message),
    'link-mainpage': '/',
    'data-search-box': search,
    'data-main-menu': mainMenu(context, message),
    'data-main-menu-dropdown': makeDropdown('vector-main-menu-dropdown', message('vector-main-menu-label'), {
      className: 'vector-main-menu-dropdown vector-button-flush-left vector-button-flush-right',
      icon: 'menu',
      tooltip: message('vector-main-menu-tooltip')
    }),
    'data-page-tools': pageToolsData,
    'data-page-tools-dropdown': makeDropdown('vector-page-tools-dropdown', message('toolbox'), { className: 'vector-page-tools-dropdown' }),
    'data-appearance': appearance,
    'data-appearance-dropdown': makeDropdown('vector-appearance-dropdown', message('vector-appearance-label'), {
      icon: 'appearance', tooltip: message('vector-appearance-tooltip')
    }),
    'data-vector-user-links': userLinks(context, message),
    'data-portlets': {
      'data-associated-pages': makeMenu('p-associated-pages', '', associated, context, 'vector-menu-tabs'),
      'data-views': makeMenu('p-views', '', views, context, 'vector-menu-tabs'),
      'data-variants': null,
      'data-actions': pageToolsData['data-menus'][0] || null,
      'data-dock-bottom': null
    },
    'data-variants': null,
    'data-lang-dropdown': null,
    'is-language-in-content-bottom': false,
    'data-footer': footerData(context),
    'data-vector-sticky-header': stickyHeaderData(context, message),
    'html-title': escapeHtml(title['page-title'] || ''),
    'html-site-notice': '',
    'html-title-heading': '',
    'html-user-language-attributes': '',
    'html-subtitle': title['html-subtitle'] || '',
    'html-undelete-link': '',
    'html-newtalk': '',
    'html-user-message': '',
    'html-body-content': '',
    'html-categories': '',
    'html-after-content': ''
  };
}
