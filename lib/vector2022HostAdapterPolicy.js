/*
 * Deterministic the tree feature -> MediaWiki Vector 2022 feature map.
 *
 * This file does not build template data. It declares one source feature and
 * one target feature per row, together with the transform kind, equivalence
 * grade, and any semantic loss. Adapter code consumes these rows mechanically.
 */

export const FEATURE_EQUIVALENCE = Object.freeze({
  EXACT: 'exact',
  ANALOG: 'analog',
  LOCAL_ONLY: 'local-only',
  UNSUPPORTED: 'unsupported'
});

function freezeFeatureRow(row) {
  return Object.freeze({
    ...row,
    source: Object.freeze({ ...(row.source || {}) }),
    target: Object.freeze({ ...(row.target || {}) }),
    transform: Object.freeze({ ...(row.transform || {}) }),
    loss: Object.freeze([...(row.loss || [])])
  });
}

function defineFeatureMap(rows) {
  return Object.freeze(rows.map(freezeFeatureRow));
}

export const CONFIG_FALLBACKS = Object.freeze({
  siteNoticeHtml: ['wiki.sitenotice'],
  footerPlacesHtml: ['skin.vector-2022.footer_html', 'footer_html', 'wiki.footer_text'],
  logoImage: ['skin.vector-2022.logo_icon'],
  logoUrl: ['wiki.logo_url'],
  logoTooltip: ['skin.vector-2022.logo_title', 'wiki.site_name', 'wiki.name', 'site_name'],
  searchTitle: ['skin.vector-2022.search_title'],
  searchPlaceholder: ['skin.vector-2022.search_placeholder'],
  navigationHeading: ['skin.vector-2022.navigation_heading'],
  themeColor: ['skin.vector-2022.theme_color'],
  tagline: ['skin.vector-2022.tagline', 'wiki.tagline'],
  siteName: ['wiki.site_name', 'wiki.name', 'site_name', 'siteName']
});

export function firstConfiguredString(config = {}, keys = [], fallback = '') {
  for (const key of keys) {
    const value = config?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return fallback;
}

export function getConfiguredString(config = {}, name, fallback = '') {
  return firstConfiguredString(config, CONFIG_FALLBACKS[name] || [], fallback);
}

export const SEARCH_TARGET_POLICY = Object.freeze({
  fulltextPath: '/Search',
  queryParam: 'q',
  goAction: 'w',
  defaultSubmitMode: 'fulltext'
});

export const LOGO_POLICY = Object.freeze({
  ownsVisibleTextFallback: false,
  ownsDomGeometry: 'upstream-vector',
  assetVariable: '--tt-vector-logo'
});

export const DOCUMENT_ACTION_MAP = defineFeatureMap([
  {
    id: 'document.action.view',
    source: { system: 'thetree', feature: 'document-view', action: 'w' },
    target: {
      system: 'mediawiki-vector-2022', feature: 'page-view', portletKey: 'data-views',
      portletId: 'p-views', itemId: 'ca-view', actionKind: 'view',
      labelMessageKey: 'view', labelFallback: '읽기', collapsible: true
    },
    transform: { kind: 'document-action', revisionContext: 'uuid' },
    equivalence: FEATURE_EQUIVALENCE.ANALOG,
    loss: []
  },
  {
    id: 'document.action.edit',
    source: { system: 'thetree', feature: 'document-edit', action: 'edit' },
    target: {
      system: 'mediawiki-vector-2022', feature: 'page-edit', portletKey: 'data-views',
      portletId: 'p-views', itemId: 'ca-edit', actionKind: 'edit',
      labelMessageKey: 'edit', labelFallback: '편집', collapsible: true
    },
    transform: { kind: 'document-action' },
    equivalence: FEATURE_EQUIVALENCE.ANALOG,
    loss: ['TheTree edit form is not MediaWiki action=edit.']
  },
  {
    id: 'document.action.history',
    source: { system: 'thetree', feature: 'document-history', action: 'history' },
    target: {
      system: 'mediawiki-vector-2022', feature: 'page-history', portletKey: 'data-views',
      portletId: 'p-views', itemId: 'ca-history', actionKind: 'history',
      labelMessageKey: 'history_short', labelFallback: '역사 보기', collapsible: true
    },
    transform: { kind: 'document-action', revisionContext: 'from' },
    equivalence: FEATURE_EQUIVALENCE.ANALOG,
    loss: []
  },
  {
    id: 'document.action.watchstar',
    source: {
      system: 'thetree', feature: 'starred-document', accountType: 'logged-in',
      stateField: 'starred', action: 'member/star', activeAction: 'member/unstar'
    },
    target: {
      system: 'mediawiki-vector-2022', feature: 'watchstar', portletKey: 'data-views',
      portletId: 'p-views', itemId: 'ca-watch', activeItemId: 'ca-unwatch',
      labelMessageKey: 'watch', labelFallback: '주시',
      activeLabelMessageKey: 'unwatch', activeLabelFallback: '주시 해제',
      tooltipMessageKey: 'tooltip-ca-watch', tooltipFallback: '이 문서를 주시문서 목록에 추가',
      activeTooltipMessageKey: 'tooltip-ca-unwatch', activeTooltipFallback: '이 문서를 주시문서 목록에서 제거'
    },
    transform: { kind: 'watchstar' },
    equivalence: FEATURE_EQUIVALENCE.ANALOG,
    loss: ['TheTree stars one document without MediaWiki talk-page pairing, expiry, or temporary watching.']
  },
  {
    id: 'document.action.backlink',
    source: { system: 'thetree', feature: 'document-backlink', action: 'backlink' },
    target: {
      system: 'mediawiki-vector-2022', feature: 'special-whatlinkshere', portletKey: 'data-actions',
      portletId: 'p-cactions', itemId: 'ca-backlink', actionKind: 'backlink',
      labelMessageKey: 'whatlinkshere', labelFallback: '역링크'
    },
    transform: { kind: 'document-action' },
    equivalence: FEATURE_EQUIVALENCE.ANALOG,
    loss: ['MediaWiki exposes WhatLinksHere as a toolbox/SpecialPage feature rather than this local page-action item.']
  },
  {
    id: 'document.action.acl',
    source: { system: 'thetree', feature: 'document-acl', action: 'acl' },
    target: {
      system: 'mediawiki-vector-2022', feature: 'local-page-action', portletKey: 'data-actions',
      portletId: 'p-cactions', itemId: 'ca-acl', actionKind: 'acl', labelFallback: 'ACL'
    },
    transform: { kind: 'document-action' },
    equivalence: FEATURE_EQUIVALENCE.LOCAL_ONLY,
    loss: ['No MediaWiki core page-action equivalent exists for TheTree ACL.']
  },
  {
    id: 'document.action.raw',
    source: { system: 'thetree', feature: 'document-raw', action: 'raw' },
    target: {
      system: 'mediawiki-vector-2022', feature: 'action-raw', portletKey: 'data-actions',
      portletId: 'p-cactions', itemId: 'ca-raw', actionKind: 'raw', labelFallback: '원본'
    },
    transform: { kind: 'document-action', revisionContext: 'uuid' },
    equivalence: FEATURE_EQUIVALENCE.ANALOG,
    loss: ['TheTree raw route is not MediaWiki action=raw response handling.']
  },
  {
    id: 'document.action.blame',
    source: { system: 'thetree', feature: 'document-blame', action: 'blame' },
    target: {
      system: 'mediawiki-vector-2022', feature: 'local-page-action', portletKey: 'data-actions',
      portletId: 'p-cactions', itemId: 'ca-blame', actionKind: 'blame', labelFallback: 'Blame'
    },
    transform: { kind: 'document-action', revisionContext: 'uuid' },
    equivalence: FEATURE_EQUIVALENCE.LOCAL_ONLY,
    loss: ['No MediaWiki core page-action equivalent exists for TheTree blame.']
  },
  {
    id: 'document.action.move',
    source: { system: 'thetree', feature: 'document-move', action: 'move' },
    target: {
      system: 'mediawiki-vector-2022', feature: 'page-move', portletKey: 'data-actions',
      portletId: 'p-cactions', itemId: 'ca-move', actionKind: 'move',
      labelMessageKey: 'move', labelFallback: '이동'
    },
    transform: { kind: 'document-action' },
    equivalence: FEATURE_EQUIVALENCE.ANALOG,
    loss: []
  },
  {
    id: 'document.action.delete',
    source: { system: 'thetree', feature: 'document-delete', action: 'delete' },
    target: {
      system: 'mediawiki-vector-2022', feature: 'page-delete', portletKey: 'data-actions',
      portletId: 'p-cactions', itemId: 'ca-delete', actionKind: 'delete',
      labelMessageKey: 'delete', labelFallback: '삭제'
    },
    transform: { kind: 'document-action' },
    equivalence: FEATURE_EQUIVALENCE.ANALOG,
    loss: []
  }
]);

export const NAMESPACE_MAP = defineFeatureMap([
  {
    id: 'namespace.subject',
    source: { system: 'thetree', feature: 'document-subject', action: 'w', namespaceKind: 'subject' },
    target: {
      system: 'mediawiki-vector-2022', feature: 'subject-namespace-tab', portletKey: 'data-associated-pages',
      portletId: 'p-namespaces', itemId: 'ca-nstab-main', namespaceKind: 'subject',
      labelMessageKey: 'nstab-main', labelFallback: '문서'
    },
    transform: { kind: 'document-action', revisionContext: 'uuid' },
    equivalence: FEATURE_EQUIVALENCE.ANALOG,
    loss: ['TheTree namespace model is not MediaWiki namespace metadata.']
  },
  {
    id: 'namespace.talk',
    source: { system: 'thetree', feature: 'document-discussion', action: 'discuss', namespaceKind: 'talk' },
    target: {
      system: 'mediawiki-vector-2022', feature: 'talk-namespace-tab', portletKey: 'data-associated-pages',
      portletId: 'p-namespaces', itemId: 'ca-talk', namespaceKind: 'talk',
      labelMessageKey: 'talk', labelFallback: '토론'
    },
    transform: { kind: 'document-action' },
    equivalence: FEATURE_EQUIVALENCE.ANALOG,
    loss: ['TheTree discussion route is not a MediaWiki Talk namespace page.']
  }
]);

export const PERSONAL_TOOL_MAP = defineFeatureMap([
  {
    id: 'personal.anonymous-user',
    source: { system: 'thetree', feature: 'anonymous-session', accountType: 'anonymous' },
    target: {
      system: 'mediawiki-vector-2022', feature: 'anonymous-user', portletKey: 'data-user-menu',
      portletId: 'p-personal', itemId: 'pt-anonuserpage', labelFallback: '로그인하지 않음'
    },
    transform: { kind: 'no-target' },
    equivalence: FEATURE_EQUIVALENCE.EXACT,
    loss: []
  },
  {
    id: 'personal.anonymous-talk',
    source: { system: 'thetree', feature: 'ip-user-document-discussion', accountType: 'anonymous' },
    target: {
      system: 'mediawiki-vector-2022', feature: 'anonymous-talk', portletKey: 'data-user-menu',
      portletId: 'p-personal', itemId: 'pt-anontalk', labelFallback: '토론'
    },
    transform: { kind: 'user-discussion' },
    equivalence: FEATURE_EQUIVALENCE.ANALOG,
    loss: ['TheTree IP user discussions are document discussions, not MediaWiki user-talk pages.']
  },
  {
    id: 'personal.anonymous-settings',
    source: { system: 'thetree', feature: 'local-settings', accountType: 'anonymous' },
    target: {
      system: 'mediawiki-vector-2022', feature: 'preferences', portletKey: 'data-user-menu',
      portletId: 'p-personal', itemId: 'pt-preferences', labelFallback: '환경 설정'
    },
    transform: { kind: 'settings-action' },
    equivalence: FEATURE_EQUIVALENCE.ANALOG,
    loss: ['TheTree local settings open a client modal instead of a MediaWiki special page.']
  },
  {
    id: 'personal.anonymous-contributions',
    source: { system: 'thetree', feature: 'ip-contributions', accountType: 'anonymous', requires: 'uuid' },
    target: {
      system: 'mediawiki-vector-2022', feature: 'anonymous-contributions', portletKey: 'data-user-menu',
      portletId: 'p-personal', itemId: 'pt-anoncontribs', labelFallback: '기여'
    },
    transform: { kind: 'contribution' },
    equivalence: FEATURE_EQUIVALENCE.ANALOG,
    loss: []
  },
  {
    id: 'personal.login',
    source: { system: 'thetree', feature: 'login-route', accountType: 'anonymous', route: '/member/login' },
    target: {
      system: 'mediawiki-vector-2022', feature: 'login', portletKey: 'data-user-menu',
      portletId: 'p-personal', itemId: 'pt-login', labelMessageKey: 'login', labelFallback: '로그인'
    },
    transform: { kind: 'login-with-redirect' },
    equivalence: FEATURE_EQUIVALENCE.ANALOG,
    loss: []
  },
  {
    id: 'personal.userpage',
    source: { system: 'thetree', feature: 'user-document', accountType: 'logged-in' },
    target: {
      system: 'mediawiki-vector-2022', feature: 'user-page', portletKey: 'data-user-menu',
      portletId: 'p-personal', itemId: 'pt-userpage', labelSource: 'accountName'
    },
    transform: { kind: 'user-document' },
    equivalence: FEATURE_EQUIVALENCE.ANALOG,
    loss: ['TheTree user document is not guaranteed to share MediaWiki user-namespace semantics.']
  },
  {
    id: 'personal.notifications',
    source: { system: 'thetree', feature: 'notifications', accountType: 'logged-in', route: '/member/notifications' },
    target: {
      system: 'mediawiki-vector-2022', feature: 'notifications', portletKey: 'data-user-menu',
      portletId: 'p-personal', itemId: 'pt-notifications', labelSource: 'notificationCount',
      labelFallback: '알림'
    },
    transform: { kind: 'static-route' },
    equivalence: FEATURE_EQUIVALENCE.ANALOG,
    loss: ['TheTree provides one notification stream, so it is not split into Echo alert and notice groups.']
  },
  {
    id: 'personal.user-talk',
    source: { system: 'thetree', feature: 'user-document-discussion', accountType: 'logged-in' },
    target: {
      system: 'mediawiki-vector-2022', feature: 'user-talk', portletKey: 'data-user-menu',
      portletId: 'p-personal', itemId: 'pt-mytalk', labelFallback: '토론'
    },
    transform: { kind: 'user-discussion' },
    equivalence: FEATURE_EQUIVALENCE.ANALOG,
    loss: ['TheTree user discussions are document discussions, not MediaWiki user-talk pages.']
  },
  {
    id: 'personal.settings',
    source: { system: 'thetree', feature: 'local-settings', accountType: 'logged-in' },
    target: {
      system: 'mediawiki-vector-2022', feature: 'preferences', portletKey: 'data-user-menu',
      portletId: 'p-personal', itemId: 'pt-preferences', labelMessageKey: 'preferences', labelFallback: '환경 설정'
    },
    transform: { kind: 'settings-action' },
    equivalence: FEATURE_EQUIVALENCE.ANALOG,
    loss: ['TheTree local settings open a client modal instead of a MediaWiki special page.']
  },
  {
    id: 'personal.member-info',
    source: { system: 'thetree', feature: 'member-page', accountType: 'logged-in', route: '/member/mypage' },
    target: {
      system: 'mediawiki-vector-2022', feature: 'local-account-management', portletKey: 'data-user-menu',
      portletId: 'p-personal', itemId: 'pt-memberinfo', labelFallback: '내 정보'
    },
    transform: { kind: 'static-route' },
    equivalence: FEATURE_EQUIVALENCE.LOCAL_ONLY,
    loss: ['TheTree account and security management has no single MediaWiki personal-tool equivalent.']
  },
  {
    id: 'personal.watchlist',
    source: { system: 'thetree', feature: 'starred-documents', accountType: 'logged-in', route: '/member/starred_documents' },
    target: {
      system: 'mediawiki-vector-2022', feature: 'watchlist', portletKey: 'data-user-menu',
      portletId: 'p-personal', itemId: 'pt-watchlist', labelMessageKey: 'watchlist', labelFallback: '주시문서 목록'
    },
    transform: { kind: 'static-route' },
    equivalence: FEATURE_EQUIVALENCE.ANALOG,
    loss: ['TheTree starred documents are not MediaWiki watchlist events.']
  },
  {
    id: 'personal.contributions',
    source: { system: 'thetree', feature: 'account-contributions', accountType: 'logged-in', requires: 'uuid' },
    target: {
      system: 'mediawiki-vector-2022', feature: 'user-contributions', portletKey: 'data-user-menu',
      portletId: 'p-personal', itemId: 'pt-mycontris', labelMessageKey: 'mycontris', labelFallback: '기여'
    },
    transform: { kind: 'contribution' },
    equivalence: FEATURE_EQUIVALENCE.ANALOG,
    loss: []
  },
  {
    id: 'personal.logout',
    source: { system: 'thetree', feature: 'logout-route', accountType: 'logged-in', route: '/member/logout' },
    target: {
      system: 'mediawiki-vector-2022', feature: 'logout', portletKey: 'data-user-menu',
      portletId: 'p-personal', itemId: 'pt-logout', labelMessageKey: 'logout', labelFallback: '로그아웃'
    },
    transform: { kind: 'logout-with-redirect' },
    equivalence: FEATURE_EQUIVALENCE.ANALOG,
    loss: []
  }
]);

export const SESSION_MENU_MAP = defineFeatureMap([
  {
    id: 'sidebar.session-menu',
    source: {
      system: 'thetree', feature: 'session-menu-collection', field: 'session.menus',
      itemIdField: 'id', itemLabelField: 't', itemTargetField: 'l'
    },
    target: {
      system: 'mediawiki-vector-2022', feature: 'local-user-tools-portlet',
      portletKey: 'array-portlets-rest', portletId: 'p-user-tools'
    },
    transform: { kind: 'collection-item-passthrough' },
    equivalence: FEATURE_EQUIVALENCE.LOCAL_ONLY,
    loss: ['TheTree session menus are host-defined and have no fixed MediaWiki personal-tool inventory.']
  }
]);

export const SIDEBAR_NAVIGATION_MAP = defineFeatureMap([
  {
    id: 'sidebar.mainpage',
    source: { system: 'thetree', feature: 'front-page-route', route: '/' },
    target: { system: 'mediawiki-vector-2022', feature: 'main-page', portletKey: 'data-portlets-first', portletId: 'p-navigation', itemId: 'n-mainpage-description', labelMessageKey: 'mainpage-description', labelFallback: '대문' },
    transform: { kind: 'static-route' }, equivalence: FEATURE_EQUIVALENCE.ANALOG, loss: []
  },
  {
    id: 'sidebar.recentchanges',
    source: { system: 'thetree', feature: 'recent-changes-route', route: '/RecentChanges' },
    target: { system: 'mediawiki-vector-2022', feature: 'special-recentchanges', portletKey: 'data-portlets-first', portletId: 'p-navigation', itemId: 'n-recentchanges', labelMessageKey: 'recentchanges', labelFallback: '최근 변경' },
    transform: { kind: 'static-route' }, equivalence: FEATURE_EQUIVALENCE.ANALOG, loss: []
  },
  {
    id: 'sidebar.recentdiscuss',
    source: { system: 'thetree', feature: 'recent-discussions-route', route: '/RecentDiscuss' },
    target: { system: 'mediawiki-vector-2022', feature: 'local-navigation-item', portletKey: 'data-portlets-first', portletId: 'p-navigation', itemId: 'n-recentdiscuss', labelFallback: '최근 토론' },
    transform: { kind: 'static-route' }, equivalence: FEATURE_EQUIVALENCE.LOCAL_ONLY, loss: ['No MediaWiki core navigation equivalent exists for TheTree recent discussions.']
  },
  {
    id: 'sidebar.randompage',
    source: { system: 'thetree', feature: 'random-document-route', route: '/random' },
    target: { system: 'mediawiki-vector-2022', feature: 'special-random', portletKey: 'data-portlets-first', portletId: 'p-navigation', itemId: 'n-randompage', labelMessageKey: 'randompage', labelFallback: '임의 문서' },
    transform: { kind: 'static-route' }, equivalence: FEATURE_EQUIVALENCE.ANALOG, loss: []
  }
]);

export const SIDEBAR_TOOLBOX_MAP = defineFeatureMap([
  {
    id: 'toolbox.upload',
    source: { system: 'thetree', feature: 'upload-route', route: '/Upload' },
    target: { system: 'mediawiki-vector-2022', feature: 'special-upload', portletKey: 'array-portlets-rest', portletId: 'p-tb', itemId: 't-upload', labelMessageKey: 'upload', labelFallback: '파일 올리기' },
    transform: { kind: 'static-route' }, equivalence: FEATURE_EQUIVALENCE.ANALOG, loss: []
  },
  {
    id: 'toolbox.neededpages',
    source: { system: 'thetree', feature: 'needed-pages-route', route: '/NeededPages' },
    target: { system: 'mediawiki-vector-2022', feature: 'special-wantedpages', portletKey: 'array-portlets-rest', portletId: 'p-tb', itemId: 't-neededpages', labelMessageKey: 'wantedpages', labelFallback: '작성이 필요한 문서' },
    transform: { kind: 'static-route' }, equivalence: FEATURE_EQUIVALENCE.ANALOG, loss: []
  },
  {
    id: 'toolbox.orphanedpages',
    source: { system: 'thetree', feature: 'orphaned-pages-route', route: '/OrphanedPages' },
    target: { system: 'mediawiki-vector-2022', feature: 'special-lonelypages', portletKey: 'array-portlets-rest', portletId: 'p-tb', itemId: 't-orphanedpages', labelMessageKey: 'lonelypages', labelFallback: '고립된 문서' },
    transform: { kind: 'static-route' }, equivalence: FEATURE_EQUIVALENCE.ANALOG, loss: []
  },
  {
    id: 'toolbox.orphanedcategories',
    source: { system: 'thetree', feature: 'orphaned-categories-route', route: '/OrphanedCategories' },
    target: { system: 'mediawiki-vector-2022', feature: 'special-lonelycategories', portletKey: 'array-portlets-rest', portletId: 'p-tb', itemId: 't-orphanedcategories', labelFallback: '고립된 분류' },
    transform: { kind: 'static-route' }, equivalence: FEATURE_EQUIVALENCE.ANALOG, loss: []
  },
  {
    id: 'toolbox.uncategorizedpages',
    source: { system: 'thetree', feature: 'uncategorized-pages-route', route: '/UncategorizedPages' },
    target: { system: 'mediawiki-vector-2022', feature: 'special-uncategorizedpages', portletKey: 'array-portlets-rest', portletId: 'p-tb', itemId: 't-uncategorizedpages', labelMessageKey: 'uncategorizedpages', labelFallback: '분류가 되지 않은 문서' },
    transform: { kind: 'static-route' }, equivalence: FEATURE_EQUIVALENCE.ANALOG, loss: []
  },
  {
    id: 'toolbox.oldpages',
    source: { system: 'thetree', feature: 'old-pages-route', route: '/OldPages' },
    target: { system: 'mediawiki-vector-2022', feature: 'special-ancientpages', portletKey: 'array-portlets-rest', portletId: 'p-tb', itemId: 't-oldpages', labelMessageKey: 'ancientpages', labelFallback: '오래된 문서' },
    transform: { kind: 'static-route' }, equivalence: FEATURE_EQUIVALENCE.ANALOG, loss: []
  },
  {
    id: 'toolbox.shortpages',
    source: { system: 'thetree', feature: 'short-pages-route', route: '/ShortestPages' },
    target: { system: 'mediawiki-vector-2022', feature: 'special-shortpages', portletKey: 'array-portlets-rest', portletId: 'p-tb', itemId: 't-shortpages', labelMessageKey: 'shortpages', labelFallback: '짧은 문서' },
    transform: { kind: 'static-route' }, equivalence: FEATURE_EQUIVALENCE.ANALOG, loss: []
  },
  {
    id: 'toolbox.longpages',
    source: { system: 'thetree', feature: 'long-pages-route', route: '/LongestPages' },
    target: { system: 'mediawiki-vector-2022', feature: 'special-longpages', portletKey: 'array-portlets-rest', portletId: 'p-tb', itemId: 't-longpages', labelMessageKey: 'longpages', labelFallback: '긴 문서' },
    transform: { kind: 'static-route' }, equivalence: FEATURE_EQUIVALENCE.ANALOG, loss: []
  },
  {
    id: 'toolbox.blockhistory',
    source: { system: 'thetree', feature: 'block-history-route', route: '/BlockHistory' },
    target: { system: 'mediawiki-vector-2022', feature: 'special-blocklist-log', portletKey: 'array-portlets-rest', portletId: 'p-tb', itemId: 't-blockhistory', labelFallback: '차단 내역' },
    transform: { kind: 'static-route' }, equivalence: FEATURE_EQUIVALENCE.ANALOG,
    loss: ['TheTree BlockHistory is not identical to MediaWiki block log or block list.']
  },
  {
    id: 'toolbox.randompage-list',
    source: { system: 'thetree', feature: 'random-page-list-route', route: '/RandomPage' },
    target: { system: 'mediawiki-vector-2022', feature: 'special-randompage-list', portletKey: 'array-portlets-rest', portletId: 'p-tb', itemId: 't-randompage-list', labelFallback: '임의 문서 목록' },
    transform: { kind: 'static-route' }, equivalence: FEATURE_EQUIVALENCE.LOCAL_ONLY,
    loss: ['TheTree RandomPage returns a namespace-filtered sample list rather than one random redirect.']
  },
  {
    id: 'toolbox.license',
    source: { system: 'thetree', feature: 'license-route', route: '/License' },
    target: { system: 'mediawiki-vector-2022', feature: 'special-version-license', portletKey: 'array-portlets-rest', portletId: 'p-tb', itemId: 't-license', labelFallback: '라이선스' },
    transform: { kind: 'static-route' }, equivalence: FEATURE_EQUIVALENCE.ANALOG,
    loss: ['TheTree License route is not MediaWiki Special:Version license output.']
  },
  {
    id: 'toolbox.relevant-user-contributions',
    source: {
      system: 'thetree', feature: 'relevant-user-contributions',
      fields: ['page.data.user.uuid', 'page.data.account.uuid', 'session.account.uuid for own user document']
    },
    target: { system: 'mediawiki-vector-2022', feature: 'relevant-user-contributions', portletKey: 'array-portlets-rest', portletId: 'p-tb', itemId: 't-contributions', labelFallback: '사용자 기여' },
    transform: { kind: 'relevant-user-contribution' },
    equivalence: FEATURE_EQUIVALENCE.ANALOG,
    loss: []
  }
]);

export function featureRowsForPortlet(featureMap, portletKey) {
  return featureMap.filter((row) => row.target.portletKey === portletKey);
}

export function featureTargetForPortlet(featureMap, portletKey) {
  return featureRowsForPortlet(featureMap, portletKey)[0]?.target || null;
}

export const HOST_ADAPTER_SLOT_POLICY = Object.freeze({
  documentActions: {
    namespace: 'data-associated-pages/#p-namespaces',
    views: 'data-views/#p-views',
    more: 'data-actions/#p-cactions'
  },
  personalTools: 'data-user-menu/#p-personal',
  sidebar: 'data-portlets-main-menu',
  search: 'data-search-box + submit adapter',
  footer: 'footerData.dataPlaces',
  notices: 'SkinVector2022.vue wrapper slots',
  logo: '#p-logo/.mw-wiki-logo asset variable only'
});
