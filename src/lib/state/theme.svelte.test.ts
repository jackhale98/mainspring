// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { PrefStorage } from './storage';
import { ThemeState } from './theme.svelte';

function setup(opts: { dark: boolean; stored?: string }) {
	const data = new Map<string, string>(opts.stored ? [['mainspring.theme', opts.stored]] : []);
	const storage: PrefStorage = {
		getItem: (k) => data.get(k) ?? null,
		setItem: (k, v) => void data.set(k, v),
	};
	let matches = opts.dark;
	const listeners = new Set<() => void>();
	const attrs: Record<string, string> = {};
	const win = {
		matchMedia: () =>
			({
				get matches() {
					return matches;
				},
				addEventListener: (_: string, f: () => void) => listeners.add(f),
				removeEventListener: (_: string, f: () => void) => listeners.delete(f),
			}) as unknown as MediaQueryList,
	};
	const root = { setAttribute: (k: string, v: string) => void (attrs[k] = v) };
	const theme = new ThemeState({ storage, win, root });
	return {
		theme,
		attrs,
		data,
		listeners,
		system(next: boolean) {
			matches = next;
			for (const l of listeners) l();
		},
	};
}

describe('ThemeState', () => {
	it('follows the system until the user chooses', () => {
		const t = setup({ dark: true });
		expect(t.attrs['data-theme']).toBe('dark');
		t.system(false);
		expect(t.attrs['data-theme']).toBe('light');
		expect(t.theme.resolved).toBe('light');
	});

	it('remembers a choice and ignores the system after it', () => {
		const t = setup({ dark: false });
		t.theme.set('dark');
		expect(t.attrs).toEqual({ 'data-theme': 'dark', 'data-theme-pref': 'dark' });
		expect(t.data.get('mainspring.theme')).toBe('dark');
		t.system(true);
		t.system(false);
		expect(t.attrs['data-theme']).toBe('dark');
	});

	it('reads the stored preference and cycles through all three', () => {
		const t = setup({ dark: false, stored: 'dark' });
		expect(t.theme.pref).toBe('dark');
		t.theme.cycle();
		expect(t.theme.pref).toBe('system');
		t.theme.cycle();
		expect(t.theme.pref).toBe('light');
	});

	it('stops listening when disposed', () => {
		const t = setup({ dark: false });
		expect(t.listeners.size).toBe(1);
		t.theme.dispose();
		expect(t.listeners.size).toBe(0);
	});
});
