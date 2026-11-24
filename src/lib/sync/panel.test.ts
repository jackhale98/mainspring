// SPDX-License-Identifier: GPL-2.0-or-later
// What the Sync panel says and offers for a state (panel.ts).
import { describe, expect, it } from 'vitest';
import { storageError } from '../storage/types';
import { strings } from '../strings';
import { actionsOf, formatKept, keptOf, locationLine, sentenceOf } from './panel';
import type { Shown } from './shown';

const ERR = storageError('server', 'x');

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
