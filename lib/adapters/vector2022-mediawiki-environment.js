function createHook() {
  const listeners = new Set();
  return Object.freeze({
    add(listener) { if (typeof listener === 'function') listeners.add(listener); return this; },
    remove(listener) { listeners.delete(listener); return this; },
    fire(...values) { listeners.forEach((listener) => listener(...values)); return this; }
  });
}

function addVectorPortlet(id, label, documentObject) {
  const portlet = documentObject.createElement('div');
  portlet.id = id;
  portlet.className = `mw-portlet mw-portlet-${id} emptyPortlet vector-menu`;
  if (label) {
    const heading = documentObject.createElement('div');
    heading.className = 'vector-menu-heading';
    heading.textContent = label;
    portlet.appendChild(heading);
  }
  const content = documentObject.createElement('div');
  content.className = 'vector-menu-content';
  const list = documentObject.createElement('ul');
  list.className = 'vector-menu-content-list';
  content.appendChild(list);
  portlet.appendChild(content);
  return portlet;
}

function addPortletLink(portletId, href, text, id, documentObject) {
  const portlet = documentObject.getElementById(portletId);
  if (!portlet) return null;
  const list = portlet.querySelector('ul') || portlet.appendChild(documentObject.createElement('ul'));
  const item = documentObject.createElement('li');
  item.className = 'mw-list-item mw-list-item-js';
  if (id) item.id = id;
  const link = documentObject.createElement('a');
  link.href = href || '';
  link.textContent = text || '';
  item.appendChild(link);
  list.appendChild(item);
  return item;
}

function currentPreference(documentObject, featureName) {
  const prefix = `${featureName}-clientpref-`;
  const className = [...documentObject.documentElement.classList].find((value) => value.startsWith(prefix));
  return className ? className.slice(prefix.length) : false;
}

function setPreferenceClass(documentObject, featureName, value) {
  const prefix = `${featureName}-clientpref-`;
  [...documentObject.documentElement.classList]
    .filter((className) => className.startsWith(prefix))
    .forEach((className) => documentObject.documentElement.classList.remove(className));
  documentObject.documentElement.classList.add(`${prefix}${value}`);
}

export function installVector2022MediaWikiEnvironment({
  message,
  messageExists,
  isNamed = false,
  savePreference,
  preferenceDefinitions = {},
  pageName = '',
  title = '',
  documentObject = globalThis.document,
  globalObject = globalThis
} = {}) {
  if (!documentObject?.documentElement || !globalObject) return () => {};
  const previous = globalObject.mw;
  const featureByPreferenceKey = new Map(
    Object.entries(preferenceDefinitions).map(([featureName, definition]) => [definition.preferenceKey, featureName])
  );
  const hooks = new Map();
  const hook = (name) => {
    if (!hooks.has(name)) hooks.set(name, createHook());
    return hooks.get(name);
  };
  const mwMessage = (key, ...parameters) => {
    const value = message(String(key), String(key), ...parameters);
    return Object.freeze({
      text: () => value.replace(/<[^>]*>/g, ''),
      parse: () => value,
      exists: () => messageExists(String(key))
    });
  };
  const runtime = {
    hook,
    msg: (key, ...parameters) => mwMessage(key, ...parameters).text(),
    message: mwMessage,
    requestIdleCallback: (callback) => (
      typeof globalObject.requestIdleCallback === 'function'
        ? globalObject.requestIdleCallback(callback)
        : globalObject.setTimeout(callback, 0)
    ),
    config: {
      get(key) {
        if (key === 'wgUserLanguage') return documentObject.documentElement.lang || 'en';
        if (key === 'wgPageName' || key === 'wgRelevantPageName') return pageName;
        if (key === 'wgTitle') return title;
        return undefined;
      }
    },
    user: {
      isNamed: () => !!isNamed,
      isAnon: () => !isNamed,
      clientPrefs: {
        get: (featureName) => currentPreference(documentObject, featureName),
        set(featureName, value) {
          setPreferenceClass(documentObject, featureName, value);
          savePreference?.(featureName, value);
        }
      }
    },
    util: {
      addPortlet: (id, label) => addVectorPortlet(id, label, documentObject),
      addPortletLink: (portletId, href, text, id) => addPortletLink(portletId, href, text, id, documentObject),
      debounce(callback) { return (...values) => callback(...values); },
      getUrl(value) { return `/w/${encodeURIComponent(String(value || '').replaceAll(' ', '_'))}`; }
    },
    Api: class {
      saveOptions(values) {
        Object.entries(values || {}).forEach(([key, value]) => savePreference?.(featureByPreferenceKey.get(key) || key, value));
        return Promise.resolve();
      }
    }
  };
  globalObject.mw = runtime;
  return () => {
    if (previous === undefined) delete globalObject.mw;
    else globalObject.mw = previous;
  };
}
