const BODY_CLASS_UNIVERSE = [
  'vector-feature-main-menu-pinned-enabled', 'vector-feature-main-menu-pinned-disabled',
  'vector-feature-page-tools-pinned-enabled', 'vector-feature-page-tools-pinned-disabled',
  'vector-toc-available', 'vector-toc-not-available',
  'client-js', 'vector-sticky-header-enabled', 'vector-sticky-header-visible', 'vector-below-page-title'
];
const HTML_CLASS_PREFIXES = [
  'skin-theme-clientpref-', 'vector-feature-limited-width-clientpref-',
  'vector-feature-custom-font-size-clientpref-', 'vector-feature-toc-pinned-clientpref-',
  'vector-feature-appearance-pinned-clientpref-'
];

function truthyPreference(value, fallback = true) {
  return value == null ? fallback : ![false, 0, '0', 'false'].includes(value);
}

export function makeVector2022DocumentEnvironment({
  lang = 'ko', dir = 'ltr', namespace = 0, action = 'view', theme = 'light', themePreference,
  localConfig = {}, config = {}, hasToc = false
} = {}) {
  const direction = dir === 'rtl' ? 'rtl' : 'ltr';
  const preference = (name, fallback = true) => truthyPreference(
    localConfig[`skin.vector-2022.${name}`] ?? config[`skin.vector-2022.${name}`], fallback
  );
  const mainMenuPinned = preference('main_menu_pinned');
  const pageToolsPinned = preference('page_tools_pinned');
  const tocPinned = preference('toc_pinned');
  const appearancePinned = preference('appearance_pinned');
  const limitedWidth = preference('limited_width');
  const configuredFontSize = localConfig['skin.vector-2022.font_size'] ?? config['skin.vector-2022.font_size'];
  const fontSize = ['0', '1', '2'].includes(String(configuredFontSize))
    ? String(configuredFontSize) : '0';
  const colorMode = themePreference == null || themePreference === 'auto'
    ? 'os'
    : (theme === 'dark' ? 'night' : 'day');
  const ns = Number.isFinite(Number(namespace)) ? Number(namespace) : 0;
  return {
    htmlAttributes: { lang: lang || 'ko', dir: direction },
    htmlClasses: [
      `skin-theme-clientpref-${colorMode}`,
      `vector-feature-limited-width-clientpref-${limitedWidth ? 1 : 0}`,
      `vector-feature-custom-font-size-clientpref-${fontSize}`,
      `vector-feature-toc-pinned-clientpref-${tocPinned ? 1 : 0}`,
      `vector-feature-appearance-pinned-clientpref-${appearancePinned ? 1 : 0}`
    ],
    bodyClasses: [
      'mediawiki', 'skin-vector', 'skin-vector-2022', 'skin--responsive', 'skin-vector-search-vue', 'mw-hide-empty-elt',
      direction, `sitedir-${direction}`, `ns-${ns}`, ns % 2 === 0 ? 'ns-subject' : 'ns-talk', `action-${action || 'view'}`,
      mainMenuPinned ? 'vector-feature-main-menu-pinned-enabled' : 'vector-feature-main-menu-pinned-disabled',
      pageToolsPinned ? 'vector-feature-page-tools-pinned-enabled' : 'vector-feature-page-tools-pinned-disabled',
      hasToc ? 'vector-toc-available' : 'vector-toc-not-available'
    ],
    managedBodyClasses: BODY_CLASS_UNIVERSE,
    managedHtmlPrefixes: HTML_CLASS_PREFIXES
  };
}

export function applyVector2022DocumentEnvironment(environment, documentObject = globalThis.document) {
  if (!documentObject?.documentElement || !documentObject.body) return () => {};
  const html = documentObject.documentElement;
  const body = documentObject.body;
  const previousAttributes = Object.fromEntries(Object.keys(environment.htmlAttributes).map((key) => [key, html.getAttribute(key)]));
  const previousHtmlClasses = new Set(html.classList);
  const previousBodyClasses = new Set(body.classList);
  Object.entries(environment.htmlAttributes).forEach(([key, value]) => html.setAttribute(key, value));
  [...html.classList].forEach((className) => {
    if (environment.managedHtmlPrefixes.some((prefix) => className.startsWith(prefix))) html.classList.remove(className);
  });
  environment.htmlClasses.forEach((className) => html.classList.add(className));
  environment.managedBodyClasses.forEach((className) => body.classList.remove(className));
  environment.bodyClasses.forEach((className) => body.classList.add(className));
  return () => {
    [...html.classList].forEach((className) => {
      if (!previousHtmlClasses.has(className)) html.classList.remove(className);
    });
    previousHtmlClasses.forEach((className) => html.classList.add(className));
    [...body.classList].forEach((className) => {
      if (!previousBodyClasses.has(className)) body.classList.remove(className);
    });
    previousBodyClasses.forEach((className) => body.classList.add(className));
    Object.entries(previousAttributes).forEach(([key, value]) => value == null ? html.removeAttribute(key) : html.setAttribute(key, value));
  };
}
