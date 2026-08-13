import catalog from '../generated/mediawiki-less-messages.json';

function activeLanguage() {
  if (typeof document !== 'undefined') {
    const language = String(document.documentElement?.lang || '').trim();
    if (language && catalog.languages[language]) return language;
    const base = language.split('-')[0];
    if (base && catalog.languages[base]) return base;
  }
  return catalog.languages.ko ? 'ko' : Object.keys(catalog.languages)[0];
}

function sourceMessage(key) {
  let language = activeLanguage();
  const visited = new Set();
  while (language && !visited.has(language)) {
    visited.add(language);
    const definition = catalog.languages[language];
    if (typeof definition?.messages?.[key] === 'string') return definition.messages[key];
    language = definition?.fallback;
  }
  return `⧼${key}⧽`;
}

function format(message, parameters) {
  return parameters.reduce(
    (value, parameter, index) => value.replaceAll(`$${index + 1}`, String(parameter ?? '')),
    String(message)
  );
}

export function mediaWikiMessage(key, ...parameters) {
  const value = format(sourceMessage(String(key)), parameters);
  return Object.freeze({
    text: () => value.replace(/<[^>]*>/g, ''),
    parse: () => value
  });
}

const mw = Object.freeze({
  msg: (key, ...parameters) => mediaWikiMessage(key, ...parameters).text(),
  config: Object.freeze({ get: () => undefined }),
  log: Object.freeze({
    warn: (...values) => {
      if (typeof console !== 'undefined') console.warn(...values);
    }
  })
});

export default mw;
