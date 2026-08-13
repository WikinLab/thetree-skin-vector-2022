/* the tree local settings modal -> Vector personal-tool action boundary. */

export const SETTINGS_TOGGLE_ATTRIBUTE = 'data-tt-settings-toggle';

export function settingsToggleAttributes() {
  return Object.freeze([
    Object.freeze({ key: 'href', value: '#' }),
    Object.freeze({ key: SETTINGS_TOGGLE_ATTRIBUTE, value: '1' }),
    Object.freeze({ key: 'title', value: '문서, 토론 및 스킨 설정 열기' })
  ]);
}

export function isSettingsToggleTarget(target) {
  if (!target || typeof target.closest !== 'function') return null;
  return target.closest(`a[${SETTINGS_TOGGLE_ATTRIBUTE}="1"]`);
}
