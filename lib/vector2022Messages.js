import catalog from './generated/vector-2022-messages.js';

function languageChain(language) {
  const chain = [];
  const visited = new Set();
  let current = language;
  while (current && !visited.has(current)) {
    visited.add(current);
    chain.push(current);
    current = catalog.languages[current]?.fallback || null;
  }
  if (!visited.has('en') && catalog.languages.en) chain.push('en');
  return chain;
}

function sourceMessage(language, key) {
  for (const candidate of languageChain(language)) {
    const value = catalog.languages[candidate]?.messages?.[key];
    if (typeof value === 'string') return value;
  }
  return null;
}

export function hasVector2022Message(config = {}, key) {
  if (config[`skin.vector-2022.message.${key}`] != null) return true;
  const requested = String(config.lang || config['wiki.lang'] || 'ko').toLowerCase();
  const language = catalog.languages[requested] ? requested : requested.split('-')[0];
  return sourceMessage(language, key) != null;
}

function formatMediaWikiMessage(value, parameters, siteName) {
  let output = String(value).replaceAll('{{SITENAME}}', siteName);
  parameters.forEach((parameter, index) => {
    output = output.replaceAll(`$${index + 1}`, String(parameter ?? ''));
  });
  return output;
}

export function makeVector2022MessageLocalizer(config = {}) {
  const requested = String(config.lang || config['wiki.lang'] || 'ko').toLowerCase();
  const language = catalog.languages[requested] ? requested : requested.split('-')[0];
  const siteName = String(config.site_name || config['wiki.site_name'] || 'the tree');
  return (key, fallback = key, ...parameters) => {
    const configured = config[`skin.vector-2022.message.${key}`];
    const source = configured == null ? sourceMessage(language, key) : String(configured);
    return formatMediaWikiMessage(source ?? fallback, parameters, siteName);
  };
}
