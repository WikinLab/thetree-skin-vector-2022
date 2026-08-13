import { getConfiguredString } from './vector2022HostAdapterPolicy';

function buildPageTitle(pageState = {}, pageContract = {}) {
  const data = pageState.data || {};
  const document = data.document;
  if (document && pageContract.canUseDocumentTitle) {
    const title = document.title || '';
    if (document.forceShowNamespace === false || !document.namespace) {
      return title;
    }
    return `${document.namespace}:${title}`;
  }
  return pageState.title || '';
}

function buildMsgTagline(config = {}) {
  const configuredTagline = getConfiguredString(config, 'tagline', '');
  if (configuredTagline) return configuredTagline;
  return `From ${getConfiguredString(config, 'siteName', 'the tree')}`;
}

function buildHtmlUndeleteLink(pageState = {}) {
  const data = pageState.data || {};
  return data.htmlUndeleteLink || data.htmlUndelete || data.undeleteLink || '';
}

function buildHtmlSubtitle(pageContract = {}) {
  return pageContract.defaultSubtitleHtml || '';
}

export function buildVector2022TitleHeadingData(pageState = {}, pageContract = {}) {
  return {
    'page-title': buildPageTitle(pageState, pageContract)
  };
}

export function buildVector2022SkinTitleData(pageState = {}, config = {}, pageContract = {}) {
  return {
    'is-article': !!pageContract.isArticle,
    'msg-tagline': buildMsgTagline(config),
    'html-subtitle': buildHtmlSubtitle(pageContract),
    'html-undelete-link': buildHtmlUndeleteLink(pageState),
    'html-user-language-attributes': ''
  };
}
