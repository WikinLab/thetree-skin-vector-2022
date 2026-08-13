import { mediaWikiMessage } from './mediawiki-runtime.js';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderI18nHtml(element, binding) {
  const parameters = Array.isArray(binding?.value) ? binding.value : [];
  element.innerHTML = mediaWikiMessage(
    binding?.arg || '',
    ...parameters.map(escapeHtml)
  ).parse();
}

const i18nHtml = Object.freeze({
  bind: renderI18nHtml,
  update: renderI18nHtml,
  mounted: renderI18nHtml,
  updated: renderI18nHtml
});

export default {
  methods: {
    $i18n(key, ...parameters) {
      return mediaWikiMessage(key, ...parameters);
    }
  },
  directives: {
    i18nHtml
  }
};
