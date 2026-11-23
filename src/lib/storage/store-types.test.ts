// SPDX-License-Identifier: GPL-2.0-or-later
// Local store contract (phase-4.md 6.2, 7.1, 10.1): compile checks of the interface (`npm run
// typecheck` enforces them), and the structured-clone rule on sample records. The store's own
// tests come with T4 (fake-indexeddb), the credentials' with T8.
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ScheduleSummary } from '../sync/types';
import type { SampleId } from '../workspace/samples';
import type {
	AccountInfo,
	AcquirePlanFn,
	CredentialStore,
	DecodePlanFile,
	DecodedFiles,
	EncodePlanFile,
	GitHubCredential,
	LocalStore,
	OpenedPlan,
	PendingWrite,
	PlanLock,
	StoredConflict,
	StoredPlan,
	SyncBase,
} from './store-types';
import type { Location, WorkspaceId, WorkspacePath } from './types';

describe('added files (21, "New file")', () => {
	it('saves and queues a path the base has never seen, and offers no way to delete or rename', () => {
		const base: SyncBase = {
			revision: 'r1',
			files: new Map([
				['plan.tjp', 'project p "P" 2027-01-01 +1m {}\ninclude "parts/people.tji"\n'],
			]),
			lossy: new Set(),
			summary: null,
		};
		const added: WorkspacePath = 'parts/people.tji';
		const notIncluded: WorkspacePath = 'parts/old.tji';
		expect(base.files.has(added)).toBe(false);
		// Nothing narrows the paths to the base's: an added path fits each set that is saved or queued.
		expectTypeOf<Parameters<LocalStore['saveFiles']>[1]>().toEqualTypeOf<
			ReadonlyMap<WorkspacePath, string>
		>();
		expectTypeOf<PendingWrite['files']>().toEqualTypeOf<ReadonlyMap<WorkspacePath, string>>();
		const write: PendingWrite = {
			id: 'w1',
			createdAt: 1,
			base: base.revision,
			files: new Map([...base.files, [added, 'resource dev "Dev"\n'], [notIncluded, '']]),
			message: 'Plan: add parts/people.tji',
			checkedVersion: 2,
		};
		expect([...write.files.keys()]).toEqual(['plan.tjp', added, notIncluded]);
		expect(structuredClone(write)).toEqual(write);
		// The store's members: only `remove` removes anything, and it takes a whole plan.
		expectTypeOf<keyof LocalStore>().toEqualTypeOf<
			| 'plans'
			| 'open'
			| 'create'
			| 'saveFiles'
			| 'setBase'
			| 'enqueue'
			| 'dequeue'
			| 'setConflict'
			| 'remove'
			| 'estimate'
			| 'cleared'
		>();
		expectTypeOf<LocalStore['remove']>().parameters.toEqualTypeOf<[WorkspaceId]>();
	});
});

describe('codec and records (6.2)', () => {
	it('fixes the codec signatures T4 implements', () => {
		expectTypeOf<DecodePlanFile>().toEqualTypeOf<
			(bytes: Uint8Array) => { text: string; lossy: boolean }
		>();
		expectTypeOf<EncodePlanFile>().toEqualTypeOf<(text: string) => Uint8Array>();
	});

	it('records where a plan came from and where it lives', () => {
		expectTypeOf<StoredPlan['from']>().toEqualTypeOf<
			{ readonly sample: SampleId } | { readonly newPlan: true } | { readonly opened: true }
		>();
		expectTypeOf<StoredPlan['location']>().toEqualTypeOf<Location>();
		expectTypeOf<StoredPlan['id']>().toEqualTypeOf<WorkspaceId>();
	});

	it('keeps the base as text with its lossy files and summary', () => {
		expectTypeOf<SyncBase>().toExtend<DecodedFiles>();
		expectTypeOf<SyncBase['files']>().toEqualTypeOf<ReadonlyMap<string, string>>();
		expectTypeOf<SyncBase['lossy']>().toEqualTypeOf<ReadonlySet<string>>();
		expectTypeOf<SyncBase['summary']>().toEqualTypeOf<ScheduleSummary | null>();
		expectTypeOf<StoredConflict['theirs']>().toExtend<DecodedFiles>();
		expectTypeOf<StoredConflict['theirs']['author']>().toEqualTypeOf<string | null>();
	});

	it('queues whole checked snapshots with their message', () => {
		expectTypeOf<PendingWrite['files']>().toEqualTypeOf<ReadonlyMap<string, string>>();
		expectTypeOf<PendingWrite['message']>().toEqualTypeOf<string | null>();
		expectTypeOf<PendingWrite['checkedVersion']>().toEqualTypeOf<number>();
	});

	it('stores only what structured clone keeps as is', () => {
		const base: SyncBase = {
			revision: 'a1b2c3',
			files: new Map([['plan.tjp', '﻿project p "P" 2027-01-01 +1m {}\r\n']]),
			lossy: new Set(['lib/old.tji']),
			summary: {
				finish: 4800,
				start: '2027-01-01T00:00:00Z',
				zone: 'Europe/Berlin',
				tasks: new Map([['t', { name: 'T', parent: null, start: 0, end: 4800 }]]),
				booked: new Map([['dev', 2400]]),
			},
		};
		const write: PendingWrite = {
			id: 'w1',
			createdAt: 1,
			base: 'a1b2c3',
			files: new Map(base.files),
			message: 'Plan: 1 task moved',
			checkedVersion: 3,
		};
		expect(structuredClone(base)).toEqual(base);
		expect(structuredClone(write)).toEqual(write);
	});
});

describe('the local store (6.2)', () => {
	it('fixes the store methods', () => {
		expectTypeOf<LocalStore['plans']>().toEqualTypeOf<() => Promise<readonly StoredPlan[]>>();
		expectTypeOf<LocalStore['open']>().toEqualTypeOf<
			(id: WorkspaceId) => Promise<OpenedPlan | null>
		>();
		expectTypeOf<LocalStore['create']>().parameters.toEqualTypeOf<
			[Omit<StoredPlan, 'id' | 'updatedAt'>, ReadonlyMap<string, string>, SyncBase | null]
		>();
		expectTypeOf<LocalStore['create']>().returns.toEqualTypeOf<Promise<WorkspaceId>>();
		expectTypeOf<LocalStore['saveFiles']>().toEqualTypeOf<
			(id: WorkspaceId, files: ReadonlyMap<string, string>, version: number) => Promise<void>
		>();
		expectTypeOf<LocalStore['enqueue']>().toEqualTypeOf<
			(id: WorkspaceId, w: PendingWrite) => Promise<void>
		>();
		expectTypeOf<LocalStore['setConflict']>().toEqualTypeOf<
			(id: WorkspaceId, c: StoredConflict | null) => Promise<void>
		>();
		expectTypeOf<LocalStore['estimate']>().returns.toEqualTypeOf<
			Promise<{ usage: number; quota: number; persisted: boolean }>
		>();
		expectTypeOf<LocalStore['cleared']>().toEqualTypeOf<() => Promise<boolean>>();
		expectTypeOf<OpenedPlan['queue']>().toEqualTypeOf<readonly PendingWrite[]>();
	});

	it('locks a plan to one tab, which may hand it to another', () => {
		expectTypeOf<AcquirePlanFn>().parameters.toEqualTypeOf<
			[WorkspaceId, ({ readonly steal?: boolean } | undefined)?]
		>();
		expectTypeOf<AcquirePlanFn>().returns.toEqualTypeOf<Promise<PlanLock | 'held-elsewhere'>>();
		expectTypeOf<PlanLock['lost']>().toEqualTypeOf<Promise<void>>();
	});
});

describe('credentials (10.1)', () => {
	it('keeps one record per account, and shows views no token', () => {
		expectTypeOf<GitHubCredential['kind']>().toEqualTypeOf<'app' | 'token'>();
		expectTypeOf<CredentialStore['put']>().toEqualTypeOf<
			(c: GitHubCredential, keep: 'device' | 'session') => Promise<void>
		>();
		expectTypeOf<CredentialStore['accounts']>().returns.toEqualTypeOf<
			Promise<readonly AccountInfo[]>
		>();
		expectTypeOf<keyof AccountInfo>().toEqualTypeOf<
			'account' | 'login' | 'kind' | 'expiresAt' | 'keep'
		>();
		expectTypeOf<AccountInfo>().not.toHaveProperty('token');
		expectTypeOf<AccountInfo>().not.toHaveProperty('refreshToken');
	});
});
