// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { THEME_KEY, nextPref, parsePref, resolveTheme, themeBootScript } from './theme';

describe('theme preference', () => {
	it('parses anything but light and dark as the system', () => {
		expect(parsePref('light')).toBe('light');
		expect(parsePref('dark')).toBe('dark');
		expect(parsePref('system')).toBe('system');
		expect(parsePref('blue')).toBe('system');
		expect(parsePref(null)).toBe('system');
	});

	it('resolves the system preference from the media query', () => {
		expect(resolveTheme('system', true)).toBe('dark');
		expect(resolveTheme('system', false)).toBe('light');
		expect(resolveTheme('light', true)).toBe('light');
		expect(resolveTheme('dark', false)).toBe('dark');
	});

	it('cycles system, light, dark', () => {
		expect(nextPref('system')).toBe('light');
		expect(nextPref('light')).toBe('dark');
		expect(nextPref('dark')).toBe('system');
	});

	it('boots the page with the same rule as resolveTheme', () => {
		const run = (stored: string | null, dark: boolean): Record<string, string> => {
			const attrs: Record<string, string> = {};
			const fn = new Function(
				'document',
				'localStorage',
				'window',
				'matchMedia',
				themeBootScript(),
			);
			fn(
				{ documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } },
				{ getItem: (k: string) => (k === THEME_KEY ? stored : null) },
				{ matchMedia: true },
				() => ({ matches: dark }),
			);
			return attrs;
		};
		expect(run(null, true)).toEqual({ 'data-theme': 'dark', 'data-theme-pref': 'system' });
		expect(run(null, false)).toEqual({ 'data-theme': 'light', 'data-theme-pref': 'system' });
		expect(run('light', true)).toEqual({ 'data-theme': 'light', 'data-theme-pref': 'light' });
		expect(run('dark', false)).toEqual({ 'data-theme': 'dark', 'data-theme-pref': 'dark' });
		expect(run('junk', true)['data-theme-pref']).toBe('system');
	});
});
