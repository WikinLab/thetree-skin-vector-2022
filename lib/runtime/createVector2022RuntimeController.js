import { createTheTreeSearchSuggestRuntime } from '../adapters/thetree-search-suggest.js';
import clientPreferenceConfig from '../generated/vector-client-preferences-config.js';
import { render as renderClientPreferences } from '../generated/vector-client-preferences.js';
import { installVector2022MediaWikiEnvironment } from '../adapters/vector2022-mediawiki-environment.js';

function checkedDropdownClose(event) {
  if (event.key !== 'Escape') return;
  const checkbox = event.target?.closest?.('.vector-dropdown')?.querySelector?.('.vector-dropdown-checkbox');
  if (checkbox?.checked) {
    checkbox.checked = false;
    checkbox.focus();
  }
}

function stickyHeaderAllowed(namespace, action, isNamed) {
  const namespaceNumber = Number(namespace);
  const allowedNamespaces = [0, 2, 4, 10, 12, 14, 100, 828];
  const allowedTalk = namespaceNumber > 0 && namespaceNumber % 2 !== 0;
  return !!isNamed && (allowedTalk || allowedNamespaces.includes(namespaceNumber))
    && !['history', 'edit'].includes(action);
}

function suffixCloneIds(root, suffix) {
  const idMap = new Map();
  if (root.id) idMap.set(root.id, `${root.id}${suffix}`);
  root.querySelectorAll('[id]').forEach((element) => idMap.set(element.id, `${element.id}${suffix}`));
  idMap.forEach((next, current) => {
    const element = root.id === current
      ? root
      : [...root.querySelectorAll('[id]')].find((candidate) => candidate.id === current);
    if (element) element.id = next;
  });
  root.querySelectorAll('[for]').forEach((element) => {
    const target = element.getAttribute('for');
    if (idMap.has(target)) element.setAttribute('for', idMap.get(target));
  });
}

function setupStickyHeader({ documentRoot, isNamed, namespace, action }) {
  const body = documentRoot.body;
  const header = documentRoot.getElementById('vector-sticky-header');
  const firstHeading = documentRoot.getElementById('firstHeading');
  const allowed = !!header && !!firstHeading && stickyHeaderAllowed(namespace, action, isNamed);
  body.classList.add('client-js');
  body.classList.toggle('vector-sticky-header-enabled', allowed);
  if (!allowed) return () => {
    body.classList.remove('vector-sticky-header-enabled', 'vector-sticky-header-visible', 'vector-below-page-title');
  };

  ['ca-ve-edit-sticky-header', 'ca-viewsource-sticky-header'].forEach((id) => {
    documentRoot.getElementById(id)?.remove();
  });
  header.querySelectorAll('a[href="#"]').forEach((element) => {
    if (!element.textContent?.trim()) element.remove();
  });

  const stickyUserLinks = header.querySelector('.vector-sticky-header-icon-end .vector-user-links');
  const sourceUserLinks = documentRoot.getElementById('vector-user-links-dropdown');
  if (stickyUserLinks && sourceUserLinks) {
    const clone = sourceUserLinks.cloneNode(true);
    suffixCloneIds(clone, '-sticky-header');
    stickyUserLinks.appendChild(clone);
  }

  const moveUnpinnedToc = (visible) => {
    const toc = documentRoot.getElementById('vector-toc');
    if (!toc || toc.closest('#vector-toc-pinned-container')) return;
    const target = documentRoot.getElementById(
      visible ? 'vector-sticky-header-toc-unpinned-container' : 'vector-page-titlebar-toc-unpinned-container'
    );
    if (target) target.appendChild(toc);
  };
  const setVisible = (visible) => {
    body.classList.toggle('vector-sticky-header-visible', visible);
    body.classList.toggle('vector-below-page-title', visible);
    moveUnpinnedToc(visible);
    if (!visible && header.contains(documentRoot.activeElement)) body.click();
  };

  const searchToggle = header.querySelector('.vector-sticky-header-search-toggle');
  const onSearchToggle = (event) => {
    event.preventDefault();
    header.classList.add('vector-header-search-toggled');
    header.querySelector('input[type="search"]')?.focus();
  };
  searchToggle?.addEventListener('click', onSearchToggle);

  let observer = null;
  let onScroll = null;
  const view = documentRoot.defaultView || globalThis.window;
  if (typeof view?.IntersectionObserver === 'function') {
    observer = new view.IntersectionObserver(([entry]) => {
      setVisible(!entry.isIntersecting && !view.matchMedia('(max-width: 1119px)').matches);
    });
    observer.observe(firstHeading);
  } else if (view) {
    onScroll = () => setVisible(firstHeading.getBoundingClientRect().bottom < 0 && view.innerWidth >= 1120);
    view.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
  return () => {
    observer?.disconnect();
    if (onScroll) view?.removeEventListener('scroll', onScroll);
    searchToggle?.removeEventListener('click', onSearchToggle);
    setVisible(false);
    body.classList.remove('vector-sticky-header-enabled', 'vector-below-page-title');
  };
}

function createChromeRuntime({
  createSearchRuntime,
  onPinChange,
  onClientPreferenceChange,
  message,
  messageExists,
  isNamed = false,
  pageName = '',
  title = '',
  namespace = 0,
  action = 'view',
  documentRoot = globalThis.document
} = {}) {
  let searchRuntime = null;
  let uninstallMediaWikiEnvironment = null;
  let teardownStickyHeader = null;
  const onClick = (event) => {
    documentRoot.querySelectorAll('.vector-dropdown-checkbox:checked').forEach((checkbox) => {
      const dropdown = checkbox.closest('.vector-dropdown');
      if (!dropdown?.contains(event.target) || event.target?.closest?.('a')) checkbox.checked = false;
    });
    const button = event.target?.closest?.('.vector-pinnable-header-toggle-button');
    if (!button) return;
    const header = button.closest('.vector-pinnable-header');
    const id = header?.dataset?.pinnableElementId;
    const featureName = header?.dataset?.featureName;
    const element = documentRoot.getElementById(id);
    const pin = button.classList.contains('vector-pinnable-header-pin-button');
    const targetId = pin ? header.dataset.pinnedContainerId : header.dataset.unpinnedContainerId;
    const target = documentRoot.getElementById(targetId);
    if (!element || !target) return;
    event.preventDefault();
    target.appendChild(element);
    documentRoot.body.classList.toggle(`vector-feature-${featureName}-enabled`, pin);
    documentRoot.body.classList.toggle(`vector-feature-${featureName}-disabled`, !pin);
    if (featureName === 'toc-pinned' || featureName === 'appearance-pinned') {
      documentRoot.documentElement.classList.toggle(`vector-feature-${featureName}-clientpref-1`, pin);
      documentRoot.documentElement.classList.toggle(`vector-feature-${featureName}-clientpref-0`, !pin);
    }
    onPinChange?.(featureName, pin);
  };
  const onTocClick = (event) => {
    const toggle = event.target?.closest?.('.vector-toc-toggle');
    if (!toggle) return;
    const item = toggle.closest('.vector-toc-list-item');
    if (!item) return;
    item.classList.toggle('vector-toc-list-item-expanded');
    toggle.setAttribute('aria-expanded', item.classList.contains('vector-toc-list-item-expanded') ? 'true' : 'false');
  };
  const onFocusIn = (event) => {
    documentRoot.querySelectorAll('.vector-dropdown-checkbox:checked').forEach((checkbox) => {
      if (!checkbox.closest('.vector-dropdown')?.contains(event.target)) checkbox.checked = false;
    });
  };
  return {
    init() {
      uninstallMediaWikiEnvironment = installVector2022MediaWikiEnvironment({
        message,
        messageExists,
        isNamed,
        savePreference: onClientPreferenceChange,
        preferenceDefinitions: clientPreferenceConfig,
        pageName,
        title,
        documentObject: documentRoot
      });
      searchRuntime = createSearchRuntime?.() || null;
      searchRuntime?.init?.();
      if (documentRoot.querySelector('#vector-appearance')) {
        renderClientPreferences('#vector-appearance', clientPreferenceConfig).catch(() => {});
      }
      teardownStickyHeader = setupStickyHeader({ documentRoot, isNamed, namespace, action });
      documentRoot.addEventListener('click', onClick);
      documentRoot.addEventListener('click', onTocClick);
      documentRoot.addEventListener('keydown', checkedDropdownClose);
      documentRoot.addEventListener('focusin', onFocusIn);
    },
    destroy() {
      searchRuntime?.destroy?.();
      searchRuntime = null;
      uninstallMediaWikiEnvironment?.();
      uninstallMediaWikiEnvironment = null;
      teardownStickyHeader?.();
      teardownStickyHeader = null;
      documentRoot.removeEventListener('click', onClick);
      documentRoot.removeEventListener('click', onTocClick);
      documentRoot.removeEventListener('keydown', checkedDropdownClose);
      documentRoot.removeEventListener('focusin', onFocusIn);
    }
  };
}

export function createVector2022RuntimeController(options = {}) {
  let runtime = null;
  let generation = 0;
  const schedule = options.schedule || ((callback) => callback());
  const initNow = () => {
    runtime?.destroy?.();
    runtime = createChromeRuntime(options);
    runtime.init();
  };
  return Object.freeze({
    init() { generation += 1; initNow(); },
    destroy() { generation += 1; runtime?.destroy?.(); runtime = null; },
    reset() {
      const requested = ++generation;
      schedule(() => { if (requested === generation) initNow(); });
    }
  });
}

export { createTheTreeSearchSuggestRuntime };
