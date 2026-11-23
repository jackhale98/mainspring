// SPDX-License-Identifier: GPL-2.0-or-later
// Merge and conflict contract (phase-4.md 6.4): the result guard, and compile checks of the
// interface (`npm run typecheck` enforces them). The merge laws and properties come with T6.
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Tree } from '@lezer/common';
import type { SourceRange } from '../tree';
import type { IncludeGraph } from '../../workspace/includes';
import {
	isUnresolved,
	type ConflictSubject,
	type FileMerge,
	type Files,
	type MergeConflict,
	type MergeContext,
	type MergeFileFn,
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

	it('holds each side, where it lands and is in ours, and whether both may be kept', () => {
		expectTypeOf<MergeConflict['ours']>().toEqualTypeOf<string | null>();
		expectTypeOf<MergeConflict['at']>().toEqualTypeOf<SourceRange>();
		expectTypeOf<MergeConflict['atOurs']>().toEqualTypeOf<SourceRange | null>();
		expectTypeOf<MergeConflict['both']>().toEqualTypeOf<boolean>();
		const c: MergeConflict = {
			id: 'plan.tjp#attribute:effort@120-129',
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
			atOurs: { file: 'plan.tjp', from: 118, to: 127 },
			both: false,
		};
		expect(c.subject.kind).toBe('attribute');
	});

	it('keeps a file the remote deleted: the conflict holds ours over the whole file', () => {
		const text = 'resource dev "Dev"\n';
		const c: MergeConflict = {
			id: 'parts/people.tji#file:deleted-theirs',
			file: 'parts/people.tji',
			subject: { kind: 'file', change: 'deleted-theirs' },
			base: 'resource dev "Developer"\n',
			ours: text,
			theirs: null,
			at: { file: 'parts/people.tji', from: 0, to: text.length },
			atOurs: { file: 'parts/people.tji', from: 0, to: text.length },
			both: false,
		};
		const m: WorkspaceMerge = { files: new Map([[c.file, text]]), conflicts: [c] };
		expect(m.files.has(c.file)).toBe(true);
	});

	it('offers ours, theirs, both or a text of the user', () => {
		expectTypeOf<Take>().toEqualTypeOf<'ours' | 'theirs' | 'both' | { readonly text: string }>();
		expectTypeOf<Resolution>().toEqualTypeOf<{ readonly conflict: string; readonly take: Take }>();
	});

	it('fixes the signatures T6 implements', () => {
		expectTypeOf<MergeContext>().toEqualTypeOf<{
			readonly includes: IncludeGraph;
			readonly trees?: ReadonlyMap<string, Tree>;
		}>();
		expectTypeOf<MergeWorkspaceFn>().parameters.toEqualTypeOf<
			[Files, Files, Files, MergeContext]
		>();
		expectTypeOf<MergeWorkspaceFn>().returns.toEqualTypeOf<WorkspaceMerge>();
		expectTypeOf<MergeFileFn>().parameters.toEqualTypeOf<
			[string, string | null, string | null, string | null, MergeContext]
		>();
		expectTypeOf<MergeFileFn>().returns.toEqualTypeOf<FileMerge>();
		expectTypeOf<FileMerge['text']>().toEqualTypeOf<string | null>();
		expectTypeOf<ResolveFn>().parameters.toEqualTypeOf<[WorkspaceMerge, readonly Resolution[]]>();
		expectTypeOf<ResolveFn>().returns.toEqualTypeOf<Files | Unresolved>();
		expectTypeOf<WorkspaceMerge['files']>().toEqualTypeOf<ReadonlyMap<string, string>>();
	});
});
