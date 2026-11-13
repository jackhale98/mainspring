// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The theme preference (ADR-0009): light, dark or the system's, remembered in `localStorage`.
 * The page always carries `data-theme="light|dark"` on the root element, which the two theme
 * files (src/styles/theme-light.css, theme-dark.css) key on. `themeBootScript` sets it before
 * the first paint so that a dark user never sees a light flash; `ThemeState`
 * (theme.svelte.ts) then keeps it current.
 */
export type ThemePref = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

export const THEME_KEY = 'mainspring.theme';
export const THEME_PREFS: readonly ThemePref[] = ['system', 'light', 'dark'];

export function parsePref(value: string | null): ThemePref {
	return value === 'light' || value === 'dark' ? value : 'system';
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
	return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
}

/** The next preference in the toggle's cycle: system, light, dark. */
export function nextPref(pref: ThemePref): ThemePref {
	const at = THEME_PREFS.indexOf(pref);
	return THEME_PREFS[(at + 1) % THEME_PREFS.length] ?? 'system';
}

/** The inline script for the document head: the same rule as `resolveTheme`, with no imports. */
export function themeBootScript(): string {
	return `(function(){var d=document.documentElement,p='system';try{var v=localStorage.getItem('${THEME_KEY}');if(v==='light'||v==='dark')p=v}catch(e){}var dark=p==='dark'||(p==='system'&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches);d.setAttribute('data-theme',dark?'dark':'light');d.setAttribute('data-theme-pref',p)})()`;
}
