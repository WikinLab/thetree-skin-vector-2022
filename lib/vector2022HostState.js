/*
 * the tree -> SkinVector2022.vue wrapper adapter.
 *
 * This helper keeps the tree-only wrapper inputs out of the generated shell
 * and the Vue component body.
 * The REL1_46 skin.mustache graph remains owned by the generated components.
 */
import { getConfiguredString } from './vector2022HostAdapterPolicy';
import { getVector2022PageContract } from './vector2022PageContract';
import {
  getVector2022Account,
  getVector2022Document,
  getVector2022PageData,
  hasVector2022Document,
  makeDocumentActionTarget,
  makeUserDocumentTarget
} from './vector2022TheTreeAdapter';

export function makeSiteNoticeHtml(context = {}) {
  return getConfiguredString(context.config || {}, 'siteNoticeHtml', '');
}

export function makeUnreadUserDiscussionState(context = {}) {
  const session = context.session || {};
  const localConfig = context.localConfig || {};
  const account = getVector2022Account(context);
  const accountName = account.name || account.username || '';
  const discussionKey = session.user_document_discuss || '';
  const isHidden = localConfig['wiki.hide_user_document_discuss'] === discussionKey;
  const hasUnreadUserDiscussion = !!discussionKey && !isHidden;

  return {
    hasUnreadUserDiscussion,
    userDiscussionKey: discussionKey,
    userDiscussionTarget: hasUnreadUserDiscussion && accountName
      ? makeDocumentActionTarget(context, makeUserDocumentTarget(context, accountName, account.type), 'discuss')
      : null
  };
}

export function makeAclMessageState(context = {}, pageContract = null) {
  const pageData = getVector2022PageData(context);
  const editAclMessageHtml = pageData.edit_acl_message || '';
  const document = getVector2022Document(context);
  const requestable = pageData.editable === true && !!editAclMessageHtml && pageContract?.canRequestEdit !== false;

  return {
    editAclMessageHtml,
    requestable,
    editRequestTarget: requestable && document
      ? makeDocumentActionTarget(context, document, 'new_edit_request')
      : null
  };
}

export function makeVector2022HostState(context = {}) {
  const pageContract = getVector2022PageContract(context);
  const unreadUserDiscussion = makeUnreadUserDiscussionState(context);
  const aclMessage = makeAclMessageState(context, pageContract);

  return {
    siteNoticeHtml: makeSiteNoticeHtml(context),
    hasDocument: hasVector2022Document(context),
    ...unreadUserDiscussion,
    ...aclMessage
  };
}
