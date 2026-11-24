// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The order in which a plan's sync states win (phase-4.md 22, 6.3 contract notes), as data, for the
 * controller (T7) to derive its single `status` from the states that hold at once, and for the
 * tests that pin the order. Nothing in the first load imports it.
 *
 * A store failure outranks everything (the text is only in memory); then working, conflict,
 * blocked, a provider failure, queued (also when it waits for access), needs-access, changes, and
 * last saved or browser-only. `failed` is two ranks, told apart by `where`.
 */
import type { SyncStatus } from './types';

/** Lower wins. */
export function rankOf(s: SyncStatus): number {
	switch (s.kind) {
		case 'failed':
			return s.where === 'store' ? 0 : 4;
		case 'working':
			return 1;
		case 'conflict':
			return 2;
		case 'blocked':
			return 3;
		case 'queued':
			return 5;
		case 'needs-access':
			return 6;
		case 'changes':
			return 7;
		case 'saved':
		case 'browser-only':
			return 8;
	}
}

/** The state that shows when all of `holding` hold: the first of the order (the earliest on a tie). */
export function strongest(holding: readonly SyncStatus[]): SyncStatus | null {
	let best: SyncStatus | null = null;
	for (const s of holding) if (best === null || rankOf(s) < rankOf(best)) best = s;
	return best;
}
