// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The sync status control (SyncStatus.svelte): its name states the state, and a change into a state
// that needs the person is announced once, in a polite live region, while autosave and the first
// state on screen are not (phase-4.md 12.3).
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppState } from '../../lib/state/app.svelte';
import { storageError } from '../../lib/storage/types';
import type { SyncStatus as Status } from '../../lib/sync/types';
import SyncStatus from './SyncStatus.svelte';

const mounted: Array<ReturnType<typeof mount>> = [];
afterEach(() => {
	for (const m of mounted.splice(0)) void unmount(m);
	document.body.innerHTML = '';
});

function setup(status: Status | null = null) {
	const app = $state({
		keeping: { keep: { kind: 'stored', at: 1 } as unknown, plans: [] },
		readOnly: false,
		storedId: 'w1',
		sync: status ? { status, location: { kind: 'browser' } } : null,
	});
	const target = document.createElement('div');
	document.body.append(target);
	mounted.push(mount(SyncStatus, { target, props: { app: app as unknown as AppState } }));
	flushSync();
	const button = () => target.querySelector<HTMLButtonElement>('[data-testid="sync-status"]')!;
	const live = () => target.querySelector<HTMLElement>('[role="status"]')!;
	const set = (s: Status | null) => {
		app.sync = s ? { status: s, location: { kind: 'browser' } } : null;
		flushSync();
	};
	return { app, button, live, set };
}

const OFFLINE: Status = { kind: 'queued', writes: 2, why: 'offline', retryAt: null };

describe('the sync status control', () => {
	it('is a button named by its state, with the label beside the icon', () => {
		const { button } = setup();
		expect(button().getAttribute('aria-label')).toBe('Sync status: Only in this browser');
		expect(button().textContent).toContain('Only in this browser');
		expect(button().getAttribute('data-kind')).toBe('browser-only');
	});

	it('draws every state of the union', () => {
		const { button, set } = setup();
		const all: Status[] = [
			{ kind: 'saved', at: 1, revision: 'r' },
			{ kind: 'changes', files: 3 },
			{ kind: 'working', what: 'pulling' },
			OFFLINE,
			{ kind: 'conflict', conflicts: 2 },
			{ kind: 'blocked', errors: 1 },
			{ kind: 'needs-access', access: 'prompt' },
			{ kind: 'failed', where: 'provider', error: storageError('server', 'x') },
			{ kind: 'failed', where: 'store', error: storageError('quota', 'x') },
		];
		for (const s of all) {
			set(s);
			expect(button().getAttribute('data-kind'), s.kind).toBe(s.kind);
			expect(button().querySelector('svg'), s.kind).not.toBeNull();
			expect(button().getAttribute('aria-label'), s.kind).toMatch(/^Sync status: \S/);
		}
	});

	it('announces nothing for the state it starts in, nor for autosave and plain changes', () => {
		const { live, set } = setup(OFFLINE);
		expect(live().textContent).toBe('');
		set({ kind: 'changes', files: 1 });
		expect(live().textContent).toBe('');
		set({ kind: 'saved', at: 2, revision: 'r' });
		expect(live().textContent).toBe('');
	});

	it('announces a change into a state that needs the person, once', () => {
		const { live, set } = setup({ kind: 'saved', at: 1, revision: 'r' });
		set(OFFLINE);
		expect(live().textContent).toBe('Sync status: Offline · 2 waiting');
		expect(live().getAttribute('aria-live')).toBe('polite');
		// The same state with another count is not a change: the region keeps what it said.
		set({ ...OFFLINE, writes: 3 });
		expect(live().textContent).toBe('Sync status: Offline · 2 waiting');
		// Another reason is.
		set({ ...OFFLINE, why: 'retrying' });
		expect(live().textContent).toBe('Sync status: Retrying · 2 waiting');
	});

	it('clears the region when the state no longer needs the person, so the next one is a change', () => {
		const { live, set } = setup({ kind: 'saved', at: 1, revision: 'r' });
		set({ kind: 'conflict', conflicts: 1 });
		expect(live().textContent).toContain('1 conflict');
		set({ kind: 'saved', at: 2, revision: 'r' });
		expect(live().textContent).toBe('');
		set({ kind: 'conflict', conflicts: 1 });
		expect(live().textContent).toContain('1 conflict');
	});
});
