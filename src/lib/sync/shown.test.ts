// SPDX-License-Identifier: GPL-2.0-or-later
// The adapter behind the sync status control (shown.ts) and the order of phase-4.md 22: a store
// failure outranks everything, a read-only tab shows nothing below it, the controller's own status
// comes next, and with no controller the plan is a sample or stored in this browser.
import { describe, expect, it } from 'vitest';
import { storageError } from '../storage/types';
import { locationOf, statusOf, type StatusSource } from './shown';
import type { SyncStatus } from './types';

const QUOTA = storageError('quota', 'full');
const SAVED: SyncStatus = { kind: 'saved', at: 5, revision: 'r' };

function source(o: {
	keep?: StatusSource['keeping']['keep'];
	readOnly?: boolean;
	status?: SyncStatus;
}): StatusSource {
	return {
		keeping: { keep: o.keep ?? { kind: 'stored', at: 1 } },
		readOnly: o.readOnly ?? false,
		sync: o.status ? { status: o.status, location: { kind: 'browser' } } : null,
	};
}

describe('statusOf without a controller (T4 today)', () => {
	it('a sample is a sample', () => {
		expect(statusOf(source({ keep: { kind: 'sample' } }))).toEqual({ kind: 'sample' });
	});

	it('a stored plan is browser-only, with its last autosave', () => {
		expect(statusOf(source({ keep: { kind: 'stored', at: 42 } }))).toEqual({
			kind: 'browser-only',
			savedAt: 42,
		});
	});

	it('a plan not saved yet in this tab says so', () => {
		expect(statusOf(source({ keep: { kind: 'stored', at: null } }))).toEqual({
			kind: 'browser-only',
			savedAt: null,
		});
	});

	it('changes the store refused are a store failure, also in a read-only tab', () => {
		const keep = { kind: 'failed', error: QUOTA } as const;
		expect(statusOf(source({ keep }))).toEqual({ kind: 'failed', where: 'store', error: QUOTA });
		expect(statusOf(source({ keep, readOnly: true }))).toMatchObject({
			kind: 'failed',
			where: 'store',
		});
	});

	it('a read-only tab says so', () => {
		expect(statusOf(source({ readOnly: true }))).toEqual({ kind: 'read-only' });
	});
});

describe('statusOf with the controller (T7)', () => {
	it('shows the controller status', () => {
		expect(statusOf(source({ status: SAVED }))).toBe(SAVED);
		const changes: SyncStatus = { kind: 'changes', files: 2 };
		expect(statusOf(source({ status: changes }))).toBe(changes);
	});

	it('the order: store failure, then read-only, then the controller, then keeping', () => {
		const provider: SyncStatus = {
			kind: 'failed',
			where: 'provider',
			error: storageError('server', 'x'),
		};
		const controllerStore: SyncStatus = { kind: 'failed', where: 'store', error: QUOTA };
		const keepFailed = { kind: 'failed', error: QUOTA } as const;
		// T4's refused changes outrank a controller that says saved.
		expect(statusOf(source({ keep: keepFailed, status: SAVED })).kind).toBe('failed');
		// The controller's own store failure outranks a read-only tab.
		expect(statusOf(source({ status: controllerStore, readOnly: true }))).toBe(controllerStore);
		// A read-only tab outranks the rest of the controller's states, a provider failure included.
		expect(statusOf(source({ status: provider, readOnly: true }))).toEqual({ kind: 'read-only' });
		// Not read-only, a provider failure shows.
		expect(statusOf(source({ status: provider }))).toBe(provider);
	});
});

describe('locationOf', () => {
	it('is the controller location, else this browser', () => {
		expect(locationOf({ sync: null })).toEqual({ kind: 'browser' });
		const loc = { kind: 'folder', handle: 'h', name: 'Plans' } as const;
		expect(locationOf({ sync: { status: SAVED, location: loc } })).toBe(loc);
	});
});
