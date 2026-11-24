// SPDX-License-Identifier: GPL-2.0-or-later
// The order of phase-4.md 22: a store failure outranks everything; then working, conflict, blocked,
// provider failure, queued (also when it waits for access), needs-access, changes, saved or
// browser-only.
import { describe, expect, it } from 'vitest';
import { storageError } from '../storage/types';
import { rankOf, strongest } from './status-order';
import type { SyncStatus } from './types';

const ERR = storageError('server', 'x');
/** In the order of section 22, strongest first. */
const ORDER: readonly SyncStatus[] = [
	{ kind: 'failed', where: 'store', error: ERR },
	{ kind: 'working', what: 'saving' },
	{ kind: 'conflict', conflicts: 1 },
	{ kind: 'blocked', errors: 1 },
	{ kind: 'failed', where: 'provider', error: ERR },
	{ kind: 'queued', writes: 1, why: 'needs-access', retryAt: null },
	{ kind: 'needs-access', access: 'signed-out' },
	{ kind: 'changes', files: 1 },
	{ kind: 'saved', at: 1, revision: 'r' },
];

describe('the status order', () => {
	it('ranks each state below the one before it', () => {
		for (let i = 1; i < ORDER.length; i++) {
			expect(rankOf(ORDER[i - 1]!), `${i}`).toBeLessThan(rankOf(ORDER[i]!));
		}
	});

	it('queued is one rank whatever it waits for, and browser-only ties with saved', () => {
		const q = (why: 'offline' | 'needs-access' | 'retrying'): SyncStatus => ({
			kind: 'queued',
			writes: 1,
			why,
			retryAt: null,
		});
		expect(rankOf(q('offline'))).toBe(rankOf(q('needs-access')));
		expect(rankOf(q('retrying'))).toBe(rankOf(q('offline')));
		expect(rankOf({ kind: 'browser-only', savedAt: null })).toBe(rankOf(ORDER[8]!));
	});

	it('strongest picks the first of the order, whatever the input order', () => {
		for (let i = 0; i < ORDER.length; i++) {
			const rest = ORDER.slice(i);
			expect(strongest(rest)).toBe(ORDER[i]);
			expect(strongest([...rest].reverse())).toBe(ORDER[i]);
		}
		expect(strongest([])).toBeNull();
	});
});
