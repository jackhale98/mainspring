// SPDX-License-Identifier: GPL-2.0-or-later
// How each state is drawn and when it is announced (status-view.ts, panel.ts): every kind of
// `Shown` has a label, an icon and a sentence, and the announcement rules of phase-4.md 12.3 hold.
import { describe, expect, it } from 'vitest';
import { ICONS } from '../icons';
import { storageError } from '../storage/types';
import { strings } from '../strings';
import { actionsOf, formatKept, keptOf, locationLine, sentenceOf } from './panel';
import type { Shown } from './shown';
import { viewOf } from './status-view';

const ERR = storageError('server', 'x');
const EVERY: readonly Shown[] = [
	{ kind: 'sample' },
	{ kind: 'read-only' },
	{ kind: 'browser-only', savedAt: null },
	{ kind: 'browser-only', savedAt: 5 },
	{ kind: 'saved', at: 5, revision: 'r' },
	{ kind: 'changes', files: 1 },
	{ kind: 'changes', files: 3 },
	{ kind: 'working', what: 'saving' },
	{ kind: 'working', what: 'committing' },
	{ kind: 'working', what: 'pulling' },
	{ kind: 'working', what: 'checking' },
	{ kind: 'queued', writes: 2, why: 'offline', retryAt: null },
	{ kind: 'queued', writes: 1, why: 'needs-access', retryAt: null },
	{ kind: 'queued', writes: 3, why: 'retrying', retryAt: 9 },
	{ kind: 'conflict', conflicts: 2 },
	{ kind: 'blocked', errors: 1 },
	{ kind: 'needs-access', access: 'prompt' },
	{ kind: 'needs-access', access: 'signed-out' },
	{ kind: 'needs-access', access: 'denied' },
	{ kind: 'failed', where: 'provider', error: ERR },
	{ kind: 'failed', where: 'store', error: storageError('quota', 'x') },
	{ kind: 'failed', where: 'store', error: storageError('not-owner', 'x') },
	{ kind: 'failed', where: 'store', error: ERR },
];

describe('viewOf', () => {
	it('every state has a label, a real icon and a sentence', () => {
		for (const s of EVERY) {
			const v = viewOf(s);
			expect(v.label.length, JSON.stringify(s)).toBeGreaterThan(0);
			expect(v.label, JSON.stringify(s)).not.toMatch(/undefined|NaN/);
			expect(v.icon === 'busy' || v.icon in ICONS, JSON.stringify(s)).toBe(true);
			expect(sentenceOf(s), JSON.stringify(s)).not.toMatch(/undefined|NaN/);
			expect(sentenceOf(s).length).toBeGreaterThan(0);
		}
	});

	it('words the counts', () => {
		expect(viewOf({ kind: 'changes', files: 1 }).label).toBe('1 change');
		expect(viewOf({ kind: 'changes', files: 3 }).label).toBe('3 changes');
		expect(viewOf({ kind: 'conflict', conflicts: 1 }).label).toBe('1 conflict');
		expect(viewOf({ kind: 'queued', writes: 2, why: 'offline', retryAt: null }).label).toBe(
			'Offline · 2 waiting',
		);
	});

	it('says only what needs the person, and never autosave (12.3)', () => {
		const said = (s: Shown) => viewOf(s).say;
		expect(said({ kind: 'browser-only', savedAt: 1 })).toBe(false);
		expect(said({ kind: 'saved', at: 1, revision: 'r' })).toBe(false);
		expect(said({ kind: 'sample' })).toBe(false);
		expect(said({ kind: 'changes', files: 1 })).toBe(false);
		expect(said({ kind: 'working', what: 'saving' })).toBe(false);
		expect(said({ kind: 'read-only' })).toBe(false);
		for (const s of EVERY.filter((x) =>
			['queued', 'conflict', 'blocked', 'needs-access', 'failed'].includes(x.kind),
		)) {
			expect(said(s), JSON.stringify(s)).toBe(true);
		}
	});

	it('a count changing is not a new state; the reason it is queued or failed is', () => {
		const key = (s: Shown) => viewOf(s).key;
		expect(key({ kind: 'conflict', conflicts: 1 })).toBe(key({ kind: 'conflict', conflicts: 5 }));
		expect(key({ kind: 'queued', writes: 1, why: 'offline', retryAt: null })).toBe(
			key({ kind: 'queued', writes: 4, why: 'offline', retryAt: null }),
		);
		expect(key({ kind: 'queued', writes: 1, why: 'offline', retryAt: null })).not.toBe(
			key({ kind: 'queued', writes: 1, why: 'retrying', retryAt: null }),
		);
		expect(key({ kind: 'failed', where: 'store', error: ERR })).not.toBe(
			key({ kind: 'failed', where: 'provider', error: ERR }),
		);
	});

	it('names a browser-only plan by the location line', () => {
		expect(viewOf({ kind: 'browser-only', savedAt: null }).label).toBe('Only in this browser');
	});
});

describe('the panel model', () => {
	it('words the locations (11.2)', () => {
		expect(locationLine({ kind: 'browser' })).toBe('Only in this browser');
		expect(locationLine({ kind: 'folder', handle: 'h', name: 'Plans' })).toContain('Plans');
		expect(
			locationLine({
				kind: 'github',
				account: 'a',
				owner: 'acme',
				repo: 'plans',
				branch: 'main',
				dir: 'q4',
			}),
		).toBe('GitHub: acme/plans, main, q4/');
		expect(
			locationLine({
				kind: 'github',
				account: 'a',
				owner: 'acme',
				repo: 'plans',
				branch: 'main',
				dir: '',
			}),
		).toBe('GitHub: acme/plans, main');
	});

	it('knows when the plan was last kept, for the states that have a time', () => {
		expect(keptOf({ kind: 'browser-only', savedAt: null })).toEqual({ at: null });
		expect(keptOf({ kind: 'browser-only', savedAt: 7 })).toEqual({ at: 7 });
		expect(keptOf({ kind: 'saved', at: 8, revision: 'r' })).toEqual({ at: 8 });
		expect(keptOf({ kind: 'conflict', conflicts: 1 })).toBeNull();
		expect(keptOf({ kind: 'sample' })).toBeNull();
	});

	it('shows the time alone for today and the date for another day', () => {
		const now = Date.UTC(2026, 5, 15, 12, 0);
		const today = formatKept(Date.UTC(2026, 5, 15, 9, 30), now, 'en-GB');
		const before = formatKept(Date.UTC(2026, 5, 3, 9, 30), now, 'en-GB');
		expect(today).toMatch(/^\d{2}:\d{2}$/);
		expect(before.length).toBeGreaterThan(today.length);
	});

	it('offers what exists today: copy the text for refused changes, open here for a read-only tab', () => {
		const refused: Shown = {
			kind: 'failed',
			where: 'store',
			error: storageError('not-owner', 'x'),
		};
		expect(actionsOf(refused, true)).toEqual(['copy-text', 'open-here']);
		expect(actionsOf({ kind: 'failed', where: 'store', error: ERR }, false)).toEqual(['copy-text']);
		expect(actionsOf({ kind: 'read-only' }, true)).toEqual(['open-here']);
		expect(actionsOf({ kind: 'browser-only', savedAt: 1 }, false)).toEqual([]);
		expect(actionsOf({ kind: 'failed', where: 'provider', error: ERR }, false)).toEqual([]);
	});

	it('says the failure that happened', () => {
		const store = (kind: Parameters<typeof storageError>[0]): Shown => ({
			kind: 'failed',
			where: 'store',
			error: storageError(kind, 'x'),
		});
		expect(sentenceOf(store('quota'))).not.toBe(sentenceOf(store('not-owner')));
		expect(sentenceOf(store('unsupported'))).toBe(sentenceOf(store('server')));
	});

	it('the control names its state, label included', () => {
		expect(strings.sync.name('Saved')).toContain('Saved');
	});
});
