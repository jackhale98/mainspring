// SPDX-License-Identifier: GPL-2.0-or-later
// Sync controller and commit message contract (phase-4.md 6.3, 6.5): compile checks of the
// interface (`npm run typecheck` enforces them). The controller's model test and the message's
// tests come with T7.
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Minutes, ScheduleResult } from '../../engine/protocol';
import type { PendingWrite } from '../storage/store-types';
import type { Access, Location, StorageError } from '../storage/types';
import type { TjpDiagnostic } from '../tjp/diagnostics-types';
import type { SymbolIndex } from '../tjp/index';
import type { Resolution, WorkspaceMerge } from '../tjp/merge/types';
import type {
	CommitDraft,
	CommitMessageFn,
	ConflictState,
	SaveOptions,
	ScheduleSummary,
	SummarizeFn,
	SyncController,
	SyncOutcome,
	SyncStatus,
	TaskSummary,
} from './types';

describe('sync status and outcomes (6.3)', () => {
	it('has the nine states of 6.3', () => {
		expectTypeOf<SyncStatus['kind']>().toEqualTypeOf<
			| 'browser-only'
			| 'saved'
			| 'changes'
			| 'working'
			| 'queued'
			| 'conflict'
			| 'blocked'
			| 'needs-access'
			| 'failed'
		>();
		expectTypeOf<Extract<SyncStatus, { kind: 'working' }>['what']>().toEqualTypeOf<
			'saving' | 'committing' | 'pulling' | 'checking'
		>();
		expectTypeOf<Extract<SyncStatus, { kind: 'queued' }>['why']>().toEqualTypeOf<
			'offline' | 'needs-access' | 'retrying'
		>();
		expectTypeOf<Extract<SyncStatus, { kind: 'needs-access' }>['access']>().toEqualTypeOf<Access>();
		expectTypeOf<Extract<SyncStatus, { kind: 'failed' }>['error']>().toEqualTypeOf<StorageError>();
	});

	it('names what a call came to', () => {
		expectTypeOf<SyncOutcome['kind']>().toEqualTypeOf<
			| 'synced'
			| 'browser-only'
			| 'queued'
			| 'merged'
			| 'conflict'
			| 'blocked'
			| 'confirm'
			| 'exists'
			| 'needs-access'
			| 'cancelled'
			| 'failed'
		>();
		expectTypeOf<Extract<SyncOutcome, { kind: 'blocked' }>['errors']>().toEqualTypeOf<
			readonly TjpDiagnostic[]
		>();
		expectTypeOf<Extract<SyncOutcome, { kind: 'confirm' }>>().toEqualTypeOf<{
			readonly kind: 'confirm';
			readonly version: number;
			readonly errors: readonly TjpDiagnostic[];
			readonly lossy: readonly string[];
		}>();
		const outcomes: SyncOutcome[] = [
			{ kind: 'synced', revision: 'abc', pulled: true, pushed: 2 },
			{ kind: 'queued', writes: 1, why: 'offline' },
			{ kind: 'merged', commit: true },
			{ kind: 'exists', files: ['plan.tjp'] },
		];
		expect(outcomes.map((o) => o.kind)).toEqual(['synced', 'queued', 'merged', 'exists']);
	});

	it('takes a message and the "anyway" answer when saving', () => {
		expectTypeOf<SaveOptions>().toEqualTypeOf<{
			readonly message?: string;
			readonly anyway?: boolean;
		}>();
	});
});

describe('the controller (6.3)', () => {
	it('keeps the four calls of 6.3', () => {
		expectTypeOf<SyncController['save']>().toEqualTypeOf<
			(o?: SaveOptions) => Promise<SyncOutcome>
		>();
		expectTypeOf<SyncController['sync']>().toEqualTypeOf<() => Promise<SyncOutcome>>();
		expectTypeOf<SyncController['resolve']>().toEqualTypeOf<
			(r: readonly Resolution[]) => Promise<SyncOutcome>
		>();
		expectTypeOf<SyncController['discardQueued']>().toEqualTypeOf<
			(writeId: string) => Promise<void>
		>();
		expectTypeOf<SyncController['status']>().toEqualTypeOf<SyncStatus>();
	});

	it('shows the panel, the conflict view and the Commit sheet what they need', () => {
		expectTypeOf<SyncController['location']>().toEqualTypeOf<Location>();
		expectTypeOf<SyncController['queue']>().toEqualTypeOf<readonly PendingWrite[]>();
		expectTypeOf<SyncController['conflict']>().toEqualTypeOf<ConflictState | null>();
		expectTypeOf<ConflictState['merge']>().toEqualTypeOf<WorkspaceMerge>();
		expectTypeOf<SyncController['draft']>().toEqualTypeOf<
			(signal?: AbortSignal) => Promise<CommitDraft | null>
		>();
		expectTypeOf<CommitDraft['message']>().toEqualTypeOf<{
			readonly subject: string;
			readonly body: string;
		}>();
		expectTypeOf<SyncController['reconnect']>().toEqualTypeOf<() => Promise<SyncOutcome>>();
	});
});

describe('the summary and the commit message (6.5)', () => {
	it('reduces a schedule to what the message compares', () => {
		expectTypeOf<ScheduleSummary['finish']>().toEqualTypeOf<Minutes | null>();
		expectTypeOf<ScheduleSummary['tasks']>().toEqualTypeOf<ReadonlyMap<string, TaskSummary>>();
		expectTypeOf<ScheduleSummary['booked']>().toEqualTypeOf<ReadonlyMap<string, number>>();
		expectTypeOf<TaskSummary>().toEqualTypeOf<{
			readonly name: string;
			readonly parent: string | null;
			readonly start: Minutes | null;
			readonly end: Minutes | null;
		}>();
	});

	it('fixes the signatures T7 implements', () => {
		expectTypeOf<SummarizeFn>().parameters.toEqualTypeOf<[ScheduleResult, SymbolIndex]>();
		expectTypeOf<SummarizeFn>().returns.toEqualTypeOf<ScheduleSummary>();
		expectTypeOf<CommitMessageFn>().parameters.toEqualTypeOf<
			[ScheduleSummary | null, ScheduleSummary, readonly string[]]
		>();
		expectTypeOf<CommitMessageFn>().returns.toEqualTypeOf<{
			readonly subject: string;
			readonly body: string;
		}>();
	});
});
