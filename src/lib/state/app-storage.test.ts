// SPDX-License-Identifier: GPL-2.0-or-later
// App state additions (phase-4.md 6.7): the per-plan preference key, and compile checks of the
// interface (`npm run typecheck` enforces them). T4 makes AppState implement it.
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { PwaState } from '../../pwa/messages';
import { modeKey } from './mode.svelte';
import type { GitHubLocation, Location, WorkspaceId } from '../storage/types';
import type { SyncController, SyncOutcome } from '../sync/types';
import { planKey, type AppStorageState } from './app-storage';

describe('app storage state (6.7)', () => {
	it('keys a stored plan’s preferences by ws:<id> (ADR-0008 #3 amended)', () => {
		expect(planKey('0b8f6c1e-4a2d-4f7e-9c3b-1d2e3f4a5b6c')).toBe(
			'ws:0b8f6c1e-4a2d-4f7e-9c3b-1d2e3f4a5b6c',
		);
		expect(modeKey(planKey('abc'))).toBe('mainspring.mode.ws:abc');
		// A sample's key stays as it was, so it is read once as the default.
		expect(modeKey('upstream-tutorial')).toBe('mainspring.mode.upstream-tutorial');
	});

	it('has the opens and Save to… of 6.7', () => {
		expectTypeOf<AppStorageState['openStored']>().toEqualTypeOf<
			(id: WorkspaceId, o?: { readonly steal?: boolean }) => Promise<boolean>
		>();
		expectTypeOf<AppStorageState['openFolder']>().toEqualTypeOf<() => Promise<boolean>>();
		expectTypeOf<AppStorageState['openFiles']>().toEqualTypeOf<
			(files: readonly File[]) => Promise<boolean>
		>();
		expectTypeOf<AppStorageState['openGitHub']>().toEqualTypeOf<
			(loc: GitHubLocation) => Promise<boolean>
		>();
		expectTypeOf<AppStorageState['saveTo']>().toEqualTypeOf<
			(target: Location) => Promise<SyncOutcome>
		>();
	});

	it('exposes the controller, the PWA state and the one-owner state', () => {
		expectTypeOf<AppStorageState['sync']>().toEqualTypeOf<SyncController | null>();
		expectTypeOf<AppStorageState['pwa']>().toEqualTypeOf<PwaState>();
		expectTypeOf<AppStorageState['heldElsewhere']>().toEqualTypeOf<WorkspaceId | null>();
		expectTypeOf<AppStorageState['readOnly']>().toEqualTypeOf<boolean>();
	});
});
