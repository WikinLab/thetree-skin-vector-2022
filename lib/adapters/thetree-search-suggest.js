/*
 * the tree /Complete and DOM-lifecycle boundary for MediaWiki's generated
 * mediawiki.skinning.typeaheadSearch component. This adapter supplies data,
 * URLs and a mount lifetime; the upstream component owns all search DOM.
 */

// Locked mediawiki.skinning.typeaheadSearch requests ten results.
export const SEARCH_SUGGESTION_LIMIT = 10;
// App.vue's locked dialogBreakpoint default. The parity contract checks drift.
export const SEARCH_DIALOG_BREAKPOINT = 639;

export function normalizeTheTreeSuggestions(value, limit = SEARCH_SUGGESTION_LIMIT) {
  const source = Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [];
  const seen = new Set();
  const result = [];
  for (const candidate of source) {
    const title = String(candidate ?? '').trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    result.push(title);
    if (result.length >= limit) break;
  }
  return result;
}

export function makeTheTreeCodexSearchResults(
  value,
  { limit = SEARCH_SUGGESTION_LIMIT, urlForTitle = () => '#' } = {}
) {
  return normalizeTheTreeSuggestions(value, limit).map((title) => ({
    value: title,
    label: title,
    url: String(urlForTitle(title) || '#'),
    thumbnail: null
  }));
}

export function makeTheTreeTypeaheadRestClient({ requestSuggestions, urlForTitle }) {
  let controller = null;
  return Object.freeze({
    fetchByTitle(query, limit) {
      controller?.abort?.();
      const requestController = typeof AbortController === 'undefined' ? null : new AbortController();
      controller = requestController;
      const request = Promise.resolve(requestSuggestions(query, requestController?.signal))
        .then((value) => ({
          results: makeTheTreeCodexSearchResults(value, { limit, urlForTitle }),
          searchId: null
        }))
        .finally(() => {
          if (controller === requestController) controller = null;
        });
      return { fetch: request };
    },
    destroy() {
      controller?.abort?.();
      controller = null;
    }
  });
}

export function makeTheTreeTypeaheadUrlGenerator(searchUrl) {
  return Object.freeze({
    generateUrl: (query) => String(searchUrl(query) || '/Search')
  });
}

export function makeTheTreeTypeaheadRouter(onExit) {
  const routeListeners = new Set();
  const routes = [];
  return Object.freeze({
    on(event, listener) {
      if (event === 'route' && typeof listener === 'function') routeListeners.add(listener);
    },
    addRoute(pattern, listener) {
      if (pattern instanceof RegExp && typeof listener === 'function') routes.push({ pattern, listener });
    },
    clearAddressBar() {
      onExit?.();
    },
    navigate(pathname) {
      for (const route of routes) {
        route.pattern.lastIndex = 0;
        if (route.pattern.test(pathname)) route.listener({ path: pathname });
      }
      for (const listener of routeListeners) listener({ path: pathname });
    },
    destroy() {
      routeListeners.clear();
      routes.length = 0;
    }
  });
}

export function isSearchDialogViewport(view = globalThis.window) {
  return !!view?.matchMedia?.(`(max-width: ${SEARCH_DIALOG_BREAKPOINT}px)`)?.matches;
}

export function createTheTreeSearchSuggestRuntime(options = {}) {
  const documentRoot = options.documentRoot || (typeof document === 'undefined' ? null : document);
  const requestSuggestions = options.requestSuggestions || (() => Promise.resolve([]));
  const documentUrl = options.documentUrl || (() => '#');
  const searchUrl = options.searchUrl || (() => '/Search');
  const mountSearchApp = options.mountSearchApp;
  const formSelector = options.formSelector || '#searchform';
  const targetSelector = options.targetSelector || '.vector-typeahead-search-container';
  const inputSelector = options.inputSelector || '#searchInput';
  let input = null;
  let restClient = null;
  let router = null;
  let unmount = null;
  let urlGenerator = null;

  function mount() {
    if (unmount || typeof mountSearchApp !== 'function' || !documentRoot) return !!unmount;
    const searchForm = documentRoot.querySelector(formSelector);
    const target = documentRoot.querySelector(targetSelector);
    if (!input || !searchForm || !target) return false;
    const titleInput = searchForm.querySelector('input[name=title]');
    restClient = makeTheTreeTypeaheadRestClient({ requestSuggestions, urlForTitle: documentUrl });
    urlGenerator = makeTheTreeTypeaheadUrlGenerator(searchUrl);
    router = makeTheTreeTypeaheadRouter(options.onExit);
    const cleanup = mountSearchApp(target, {
      router,
      restClient,
      urlGenerator,
      supportsMobileExperience: true,
      id: options.id || 'vector-search',
      autofocusInput: input === documentRoot.activeElement,
      searchButtonLabel: '',
      autoExpandWidth: true,
      showEmptySearchRecommendations: false,
      showThumbnail: true,
      showDescription: true,
      action: searchForm.getAttribute('action') || '',
      searchQuery: input.value,
      searchTitle: input.getAttribute('title') || undefined,
      searchPlaceholder: input.getAttribute('placeholder') || undefined,
      searchPageTitle: titleInput?.value,
      autocapitalizeValue: input.getAttribute('autocapitalize') || undefined,
      searchAccessKey: input.getAttribute('accesskey') || undefined
    });
    unmount = typeof cleanup === 'function' ? cleanup : () => {};
    return true;
  }

  function init() {
    if (!documentRoot) return false;
    input = documentRoot.querySelector(inputSelector);
    if (!input) return false;
    input.addEventListener('focus', mount, { once: true });
    if (input === documentRoot.activeElement) mount();
    return true;
  }

  function destroy() {
    input?.removeEventListener?.('focus', mount);
    unmount?.();
    restClient?.destroy?.();
    router?.destroy?.();
    input = null;
    restClient = null;
    router = null;
    unmount = null;
    urlGenerator = null;
  }

  return Object.freeze({ init, destroy, mount });
}
