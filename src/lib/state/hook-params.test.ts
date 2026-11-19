// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { hookAsked, installHookLazily } from './hook-params';

const q = (s: string): URLSearchParams => new URLSearchParams(s);

describe('hookAsked', () => {
	it('finds a name alone or in a list, and nothing without the parameter', () => {
		expect(hookAsked(q('hooks=edits'), 'edits')).toBe(true);
		expect(hookAsked(q('hooks=edits, gantt'), 'gantt')).toBe(true);
		expect(hookAsked(q('hooks=gantt'), 'edits')).toBe(false);
		expect(hookAsked(q('sample=x'), 'edits')).toBe(false);
	});
});

describe('installHookLazily', () => {
	it('does not load a hook that is not asked for', () => {
		const load = vi.fn(() => Promise.resolve(() => undefined));
		installHookLazily(q('sample=x'), 'edits', load)();
		expect(load).not.toHaveBeenCalled();
	});

	it('installs the hook once loaded and removes it on uninstall', async () => {
		const off = vi.fn();
		const off2 = installHookLazily(q('hooks=edits'), 'edits', () => Promise.resolve(off));
		await Promise.resolve();
		expect(off).not.toHaveBeenCalled();
		off2();
		expect(off).toHaveBeenCalledOnce();
	});

	it('removes a hook that arrives after the page has gone', async () => {
		const off = vi.fn();
		const uninstall = installHookLazily(q('hooks=gantt'), 'gantt', () => Promise.resolve(off));
		uninstall();
		await Promise.resolve();
		await Promise.resolve();
		expect(off).toHaveBeenCalledOnce();
	});
});
