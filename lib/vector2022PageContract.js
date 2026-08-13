/* thetree page state -> Vector chrome page contract. */

import { getVector2022HostViewMapping } from './vector2022SpecialPageContract';

export const NAMESPACE_KIND_SUBJECT = 'subject';
export const NAMESPACE_KIND_TALK = 'talk';
export const ACTION_KIND_VIEW = 'view';

const PAGE_STATE_NORMAL = 'normal';
const PAGE_STATE_NOT_FOUND = 'notfound';
const PAGE_STATE_ERROR = 'error';

function getContractPageData(context = {}) {
  return context.pageData || context.page?.data || {};
}

function getContractViewName(context = {}) {
  return context.page?.viewName || context.viewData?.viewName || '';
}

function getContractContentName(context = {}) {
  return context.page?.contentName || context.viewData?.contentName || '';
}

function getContractDocument(context = {}) {
  return getContractPageData(context).document || null;
}

function normalizeNamespaceId(namespace) {
  if (typeof namespace === 'number' && Number.isFinite(namespace)) return namespace;
  if (typeof namespace === 'string' && namespace.trim() !== '') {
    const numeric = Number(namespace);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function namespaceIdFromPageData(pageData = {}, document = null) {
  const candidates = [
    document?.namespaceId,
    document?.namespace_id,
    document?.ns,
    document?.namespace,
    pageData.namespaceId,
    pageData.namespace_id,
    pageData.ns,
    pageData.namespace
  ];
  for (const candidate of candidates) {
    const namespaceId = normalizeNamespaceId(candidate);
    if (namespaceId !== null) return namespaceId;
  }
  return 0;
}

function makeRevisionSubtitle(pageData = {}, suffix = '') {
  return pageData.rev ? `(r${pageData.rev} ${suffix})` : '';
}

function makeEditSubtitle(pageData = {}) {
  const body = pageData.body || {};
  if (body.section) return `(r${body.baserev} 문단 편집)`;
  if (body.baserev === '0') return '(새 문서 생성)';
  if (body.baserev) return `(r${body.baserev} 편집)`;
  return '';
}

function makeDefaultSubtitleHtml(pageData = {}, mapping = {}) {
  if (pageData.htmlSubtitle) return pageData.htmlSubtitle;
  if (pageData.subtitle) return pageData.subtitle;
  switch (mapping.transform?.subtitleKind) {
    case 'edit-request': return '(편집 요청)';
    case 'edit': return makeEditSubtitle(pageData);
    case 'history': return '(역사)';
    case 'backlink': return '(역링크)';
    case 'move': return '(이동)';
    case 'delete': return '(삭제)';
    case 'acl': return '(ACL)';
    case 'thread': return '(토론)';
    case 'thread-list': return '(토론 목록)';
    case 'thread-list-closed': return '(닫힌 토론)';
    case 'edit-request-closed': return '(닫힌 편집 요청)';
    case 'diff': return '(비교)';
    case 'revert': return pageData.rev ? `(r${pageData.rev}로 되돌리기)` : '';
    case 'raw': return makeRevisionSubtitle(pageData, 'RAW');
    case 'blame': return makeRevisionSubtitle(pageData, 'Blame');
    case 'revision-view': return makeRevisionSubtitle(pageData, '판');
    default: return '';
  }
}

export function makeVector2022PageContract(context = {}) {
  const viewName = getContractViewName(context);
  const contentName = getContractContentName(context);
  const pageData = getContractPageData(context);
  const document = getContractDocument(context);
  const mapping = getVector2022HostViewMapping(viewName, contentName);
  const pageState = mapping.transform?.pageState || PAGE_STATE_NORMAL;
  const hasDocument = !!document;
  const isDocumentPage = hasDocument && pageState !== PAGE_STATE_ERROR && pageState !== PAGE_STATE_NOT_FOUND;
  const isArticle = isDocumentPage && mapping.target?.isArticle === true;

  return Object.freeze({
    hasDocument,
    isDocumentPage,
    isArticle,
    canUseDocumentTitle: hasDocument && pageState !== PAGE_STATE_ERROR,
    canRequestEdit: pageState !== PAGE_STATE_NOT_FOUND,
    showLastModifiedFooter: isArticle && !!pageData.date,
    namespaceId: namespaceIdFromPageData(pageData, document),
    namespaceKind: mapping.target?.namespaceKind || NAMESPACE_KIND_SUBJECT,
    actionKind: mapping.target?.actionKind || ACTION_KIND_VIEW,
    selectedActionItemId: mapping.target?.selectedActionItemId || null,
    hostViewName: viewName,
    hostContentName: contentName,
    defaultSubtitleHtml: makeDefaultSubtitleHtml(pageData, mapping)
  });
}

export function getVector2022PageContract(context = {}) {
  return context.pageContract || makeVector2022PageContract(context);
}
