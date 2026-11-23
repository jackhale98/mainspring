// SPDX-License-Identifier: GPL-2.0-or-later
// Merge and conflict contract (phase-4.md 6.4): the result guard, and compile checks of the
// interface (`npm run typecheck` enforces them). The merge laws and properties come with T6.
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { SourceRange } from '../tree';
import {
	isUnresolved,
	type ConflictSubject,
	type Files,
	type MergeConflict,
	type MergeWorkspaceFn,
	type Owner,
	type Resolution,
	type ResolveFn,
	type Take,
	type Unresolved,
	type WorkspaceMerge,
} from './types';

describe('merge types (6.4)', () => {
	it('tells merged files from unresolved conflicts', () => {
		const files: Files = new Map([['plan.tjp', 'project p "P" 2027-01-01 +1m {}\n']]);
		const open: Unresolved = { unresolved: ['plan.tjp#task:api/effort'] };
		expect(isUnresolved(files)).toBe(false);
		expect(isUnresolved(open)).toBe(true);
		expect(isUnresolved({ unresolved: [] })).toBe(true);
		expect(isUnresolved(new Map())).toBe(false);
	});

	it('has the subjects of 6.4', () => {
		expectTypeOf<ConflictSubject['kind']>().toEqualTypeOf<
			'attribute' | 'block' | 'file' | 'text'
		>();
		expectTypeOf<Extract<ConflictSubject, { kind: 'block' }>['change']>().toEqualTypeOf<
			'deleted-ours' | 'deleted-theirs' | 'added-twice' | 'both-edited'
		>();
		expectTypeOf<Extract<ConflictSubject, { kind: 'file' }>['change']>().toEqualTypeOf<
			'deleted-ours' | 'deleted-theirs' | 'added-twice'
		>();
		expectTypeOf<Extract<ConflictSubject, { kind: 'attribute' }>['owner']>().toEqualTypeOf<Owner>();
		expectTypeOf<Owner['kind']>().toEqualTypeOf<'project' | 'task' | 'resource' | 'other'>();
	});

	it('holds each side of a conflict, where it lands, and whether both may be kept', () => {
		expectTypeOf<MergeConflict['ours']>().toEqualTypeOf<string | null>();
		expectTypeOf<MergeConflict['at']>().toEqualTypeOf<SourceRange>();
		expectTypeOf<MergeConflict['both']>().toEqualTypeOf<boolean>();
		const c: MergeConflict = {
			id: 'plan.tjp#task:api/effort',
			file: 'plan.tjp',
			subject: {
				kind: 'attribute',
				owner: { kind: 'task', id: 'api', name: 'Build API' },
				attr: 'effort',
			},
			base: 'effort 3d',
			ours: 'effort 5d',
			theirs: 'effort 8d',
			at: { file: 'plan.tjp', from: 120, to: 129 },
			both: false,
		};
		expect(c.subject.kind).toBe('attribute');
	});

	it('offers ours, theirs, both or a text of the user', () => {
		expectTypeOf<Take>().toEqualTypeOf<'ours' | 'theirs' | 'both' | { readonly text: string }>();
		expectTypeOf<Resolution>().toEqualTypeOf<{ readonly conflict: string; readonly take: Take }>();
	});

	it('fixes the signatures T6 implements', () => {
		expectTypeOf<MergeWorkspaceFn>().parameters.toEqualTypeOf<[Files, Files, Files]>();
		expectTypeOf<MergeWorkspaceFn>().returns.toEqualTypeOf<WorkspaceMerge>();
		expectTypeOf<ResolveFn>().parameters.toEqualTypeOf<[WorkspaceMerge, readonly Resolution[]]>();
		expectTypeOf<ResolveFn>().returns.toEqualTypeOf<Files | Unresolved>();
		expectTypeOf<WorkspaceMerge['files']>().toEqualTypeOf<ReadonlyMap<string, string>>();
	});
});
