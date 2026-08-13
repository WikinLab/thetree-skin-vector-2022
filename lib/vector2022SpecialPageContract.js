/*
 * Locked thetree contentName/viewName -> Vector chrome contract.
 *
 * Page content stays owned by thetree. This table contains only the page
 * metadata needed by Vector chrome: selected tabs, action kind, namespace
 * kind, title state and subtitles. It does not describe or transform content
 * DOM surfaces.
 */

const NAMESPACE_SUBJECT = 'subject';
const NAMESPACE_TALK = 'talk';
const PAGE_STATE_NORMAL = 'normal';
const PAGE_STATE_NOT_FOUND = 'notfound';
const PAGE_STATE_ERROR = 'error';

function freezeRow(row) {
  return Object.freeze({
    ...row,
    source: Object.freeze({ ...row.source }),
    target: Object.freeze({ ...row.target }),
    transform: Object.freeze({ ...row.transform })
  });
}

function contentRow(contentName, viewName, target = {}, transform = {}) {
  return freezeRow({
    id: `host.${contentName}`,
    source: {
      contentName,
      viewName,
      frontendPath: `src/views/contents/${contentName}.vue`
    },
    target: {
      namespaceKind: NAMESPACE_SUBJECT,
      actionKind: 'view',
      selectedActionItemId: 'ca-view',
      isArticle: false,
      ...target
    },
    transform: {
      pageState: PAGE_STATE_NORMAL,
      subtitleKind: '',
      ...transform
    }
  });
}

function fallbackRow(viewName, target = {}, transform = {}) {
  return freezeRow({
    id: `host.view:${viewName}`,
    source: { viewName },
    target: {
      namespaceKind: NAMESPACE_SUBJECT,
      actionKind: 'view',
      selectedActionItemId: 'ca-view',
      isArticle: false,
      ...target
    },
    transform: {
      pageState: PAGE_STATE_NORMAL,
      subtitleKind: '',
      ...transform
    }
  });
}

export const CONTENT_VIEW_MAP = Object.freeze({
  wiki: contentRow('wiki', 'wiki', { isArticle: true }, { subtitleKind: 'revision-view' }),
  notfound: contentRow('notfound', 'notfound', {}, { pageState: PAGE_STATE_NOT_FOUND }),
  search: contentRow('search', 'search'),
  thread: contentRow('thread', 'thread', { namespaceKind: NAMESPACE_TALK }, { subtitleKind: 'thread' }),

  'document/edit': contentRow('document/edit', 'edit', { actionKind: 'edit', selectedActionItemId: 'ca-edit' }, { subtitleKind: 'edit' }),
  'document/editRequest': contentRow('document/editRequest', 'edit_request', { actionKind: 'edit', selectedActionItemId: 'ca-edit' }, { subtitleKind: 'edit-request' }),
  'document/closedEditRequest': contentRow('document/closedEditRequest', 'edit_request_close', { actionKind: 'edit', selectedActionItemId: 'ca-edit' }, { subtitleKind: 'edit-request-closed' }),
  'document/history': contentRow('document/history', 'history', { actionKind: 'history', selectedActionItemId: 'ca-history' }, { subtitleKind: 'history' }),
  'document/diff': contentRow('document/diff', 'diff', { actionKind: 'history', selectedActionItemId: 'ca-history' }, { subtitleKind: 'diff' }),
  'document/revert': contentRow('document/revert', 'revert', { actionKind: 'history', selectedActionItemId: 'ca-history' }, { subtitleKind: 'revert' }),
  'document/backlink': contentRow('document/backlink', 'backlink', { actionKind: 'backlink', selectedActionItemId: 'ca-backlink' }, { subtitleKind: 'backlink' }),
  'document/acl': contentRow('document/acl', 'acl', { actionKind: 'acl', selectedActionItemId: 'ca-acl' }, { subtitleKind: 'acl' }),
  'document/raw': contentRow('document/raw', 'raw', { actionKind: 'raw', selectedActionItemId: 'ca-raw' }, { subtitleKind: 'raw' }),
  'document/blame': contentRow('document/blame', 'blame', { actionKind: 'blame', selectedActionItemId: 'ca-blame' }, { subtitleKind: 'blame' }),
  'document/move': contentRow('document/move', 'move', { actionKind: 'move', selectedActionItemId: 'ca-move' }, { subtitleKind: 'move' }),
  'document/delete': contentRow('document/delete', 'delete', { actionKind: 'delete', selectedActionItemId: 'ca-delete' }, { subtitleKind: 'delete' }),
  'document/discuss': contentRow('document/discuss', 'thread_list', { namespaceKind: NAMESPACE_TALK }, { subtitleKind: 'thread-list' }),
  'document/closedDiscuss': contentRow('document/closedDiscuss', 'thread_list_close', { namespaceKind: NAMESPACE_TALK }, { subtitleKind: 'thread-list-closed' }),

  'special/recentChanges': contentRow('special/recentChanges', 'recent_changes'),
  'special/recentDiscuss': contentRow('special/recentDiscuss', 'recent_discuss'),
  'special/blockHistory': contentRow('special/blockHistory', 'block_history'),
  'special/randomPage': contentRow('special/randomPage', 'random_page'),
  'special/upload': contentRow('special/upload', 'upload'),
  'special/license': contentRow('special/license', 'license'),
  'special/terms': contentRow('special/terms', 'terms'),

  'docList/UncategorizedPages': contentRow('docList/UncategorizedPages', 'uncategorized_pages'),
  'docList/OldPages': contentRow('docList/OldPages', 'old_pages'),
  'docList/ContentLength': contentRow('docList/ContentLength', 'content_length'),
  'docList/NeededPages': contentRow('docList/NeededPages', 'needed_pages'),
  'docList/OrphanedPages': contentRow('docList/OrphanedPages', 'orphaned_pages'),
  'docList/OrphanedCategories': contentRow('docList/OrphanedCategories', 'orphaned_categories'),

  'member/login': contentRow('member/login', 'login'),
  'member/signup': contentRow('member/signup', 'signup'),
  'member/signup_email_sent': contentRow('member/signup_email_sent', 'signup'),
  'member/signup_verify': contentRow('member/signup_verify', 'signup_verify'),
  'member/signup_verify_code': contentRow('member/signup_verify_code', 'signup_verify_code'),
  'member/signup_final': contentRow('member/signup_final', 'signup_final'),
  'member/pin_verification': contentRow('member/pin_verification', 'pin_verification'),
  'member/mypage': contentRow('member/mypage', 'mypage'),
  'member/change_password': contentRow('member/change_password', 'change_password'),
  'member/change_name': contentRow('member/change_name', 'change_name'),
  'member/change_email': contentRow('member/change_email', 'change_email'),
  'member/activate_otp': contentRow('member/activate_otp', 'activate_otp'),
  'member/deactivate_otp': contentRow('member/deactivate_otp', 'deactivate_otp'),
  'member/recover_password': contentRow('member/recover_password', 'recover_password'),
  'member/recover_password_email_sent': contentRow('member/recover_password_email_sent', 'recover_password'),
  'member/recover_password_final': contentRow('member/recover_password_final', 'recover_password'),
  'member/notifications': contentRow('member/notifications', 'notifications'),
  'member/starred_documents': contentRow('member/starred_documents', 'starred_documents'),
  'member/withdraw': contentRow('member/withdraw', 'withdraw'),

  'userContribution/document': contentRow('userContribution/document', 'contribution'),
  'userContribution/discuss': contentRow('userContribution/discuss', 'contribution_discuss'),
  'userContribution/editRequest': contentRow('userContribution/editRequest', 'contribution_edit_request'),

  'admin/config': contentRow('admin/config', 'Config'),
  'admin/developer': contentRow('admin/developer', 'developer'),
  'admin/initialSetup': contentRow('admin/initialSetup', 'initial_setup'),
  'admin/auditLog': contentRow('admin/auditLog', 'audit_log'),
  'admin/manageAccount': contentRow('admin/manageAccount', 'manage_account'),
  'admin/grant': contentRow('admin/grant', 'grant'),
  'admin/batch_revert': contentRow('admin/batch_revert', 'batch_revert'),
  'admin/login_history': contentRow('admin/login_history', 'login_history'),
  'admin/login_history_result': contentRow('admin/login_history_result', 'login_history'),
  'admin/aclgroup': contentRow('admin/aclgroup', 'aclgroup'),
  'admin/aclgroupManage': contentRow('admin/aclgroupManage', 'aclgroup_manage')
});

export const VIEW_FALLBACK_MAP = Object.freeze({
  wiki: CONTENT_VIEW_MAP.wiki,
  edit: CONTENT_VIEW_MAP['document/edit'],
  edit_request: CONTENT_VIEW_MAP['document/editRequest'],
  edit_edit_request: CONTENT_VIEW_MAP['document/edit'],
  edit_request_close: CONTENT_VIEW_MAP['document/closedEditRequest'],
  history: CONTENT_VIEW_MAP['document/history'],
  diff: CONTENT_VIEW_MAP['document/diff'],
  revert: CONTENT_VIEW_MAP['document/revert'],
  backlink: CONTENT_VIEW_MAP['document/backlink'],
  acl: CONTENT_VIEW_MAP['document/acl'],
  raw: CONTENT_VIEW_MAP['document/raw'],
  blame: CONTENT_VIEW_MAP['document/blame'],
  move: CONTENT_VIEW_MAP['document/move'],
  delete: CONTENT_VIEW_MAP['document/delete'],
  thread: CONTENT_VIEW_MAP.thread,
  thread_list: CONTENT_VIEW_MAP['document/discuss'],
  thread_list_close: CONTENT_VIEW_MAP['document/closedDiscuss'],
  notfound: CONTENT_VIEW_MAP.notfound,
  error: fallbackRow('error', {}, { pageState: PAGE_STATE_ERROR }),
  email_verified: fallbackRow('email_verified'),
  __default: fallbackRow('__default')
});

export const HOST_VIEW_INVENTORY = Object.freeze(Object.keys(CONTENT_VIEW_MAP).sort());

export function getVector2022HostViewMapping(viewName, contentName = '') {
  if (contentName && CONTENT_VIEW_MAP[contentName]) return CONTENT_VIEW_MAP[contentName];
  return VIEW_FALLBACK_MAP[viewName] || VIEW_FALLBACK_MAP.__default;
}

export function validateVector2022HostViewContract() {
  const errors = [];
  const ids = new Set();
  for (const [contentName, row] of Object.entries(CONTENT_VIEW_MAP)) {
    if (row.source?.contentName !== contentName) errors.push(`${contentName}: source contentName mismatch`);
    if (row.source?.frontendPath !== `src/views/contents/${contentName}.vue`) {
      errors.push(`${contentName}: frontend path is not the deterministic contentName counterpart`);
    }
    if (ids.has(row.id)) errors.push(`${contentName}: duplicate mapping id ${row.id}`);
    ids.add(row.id);
    if (![NAMESPACE_SUBJECT, NAMESPACE_TALK].includes(row.target?.namespaceKind)) {
      errors.push(`${contentName}: unsupported namespace kind ${row.target?.namespaceKind}`);
    }
    if (![PAGE_STATE_NORMAL, PAGE_STATE_NOT_FOUND, PAGE_STATE_ERROR].includes(row.transform?.pageState)) {
      errors.push(`${contentName}: unsupported page state ${row.transform?.pageState}`);
    }
  }
  if (errors.length) throw new Error(`Invalid host view contract:\n- ${errors.join('\n- ')}`);
  return true;
}
