// SPDX-License-Identifier: GPL-2.0-or-later
// The checks of a target read in an older version (ADR-0018 decision 2; edits-rebase.ts): ranges by
// the untouched-span rule, subject ids by their declaration, view-built positions by the parent's
// child list, the shown indexes the dispatcher keeps, and `prepare` running them on a gesture's
// first call only.
import { describe, expect, it } from 'vitest';
import type { EditIntent, IntentOf, SourceRange } from '../tjp/edit/types';
import type { SymbolIndex } from '../tjp/index';
import { changesIds, prepare } from './edits-plan';
import { KEEP, Kept, rebase, subjectsOf } from './edits-rebase';
import type { Job } from './edits-types';
import { world, type World } from './rebase-testing';

const LEAVES = [
	'project p "P" 2026-01-05 +2m',
	'resource ann "Ann" {',
	'  leaves annual 2026-01-19 - 2026-01-23, sick 2026-02-02',
	'}',
	'',
].join('\n');
const ITEM = 'annual 2026-01-19 - 2026-01-23';

const TASKS = [
	'project p "P" 2026-01-05 +2m',
	'task a "A" {',
	'  effort 1d',
	'}',
	'task b "B" {',
	'  effort 1d',
	'}',
	'task g "G" {',
	'  task x "X"',
	'  task y "Y"',
	'  task z "Z"',
	'}',
	'',
].join('\n');

const at = (w: World, needle: string, nth = 0): SourceRange => {
	let from = -1;
	for (let i = 0; i <= nth; i++) from = w.text().indexOf(needle, from + 1);
	if (from < 0) throw new Error(`no ${needle}`);
	return { file: 'plan.tjp', from, to: from + needle.length };
};
const textOf = (w: World, r: SourceRange | null): string | null =>
	r && w.text().slice(r.from, r.to);
const effort = (task: string): IntentOf<'setAttr'> => ({
	type: 'setAttr',
	task,
	attr: 'effort',
	value: '2d',
});

describe('ranges: the untouched-span rule', () => {
	const mapped = (edit: (w: World, r: SourceRange) => void): string | null => {
		const w = world(LEAVES);
		const v0 = w.version();
		const r = at(w, ITEM);
		edit(w, r);
		return textOf(w, w.base(v0).mapRange(r, v0));
	};

	it('maps an item past insertions before and after it, and at either end', () => {
		expect(mapped((w) => w.type(0, 0, '# a\n'))).toBe(ITEM);
		expect(mapped((w) => w.type(w.text().length, w.text().length, '# z\n'))).toBe(ITEM);
		expect(mapped((w, r) => w.type(r.from, r.from, 'sick 2026-01-12, '))).toBe(ITEM);
		expect(mapped((w, r) => w.type(r.to, r.to, ', unpaid 2026-03-02'))).toBe(ITEM);
	});

	it('maps it past a deletion that ends at its start', () => {
		expect(mapped((w, r) => w.type(r.from - 'leaves '.length, r.from, 'leaves  '))).toBe(ITEM);
		expect(mapped((w, r) => w.type(r.from - 1, r.from, ''))).toBe(ITEM);
	});

	it('refuses a replacement inside the item, one covering it and an insertion inside it', () => {
		expect(mapped((w, r) => w.type(r.from + 7, r.from + 11, '2027'))).toBeNull();
		expect(mapped((w, r) => w.type(r.from - 1, r.to + 1, ' sick 2026-01-20 '))).toBeNull();
		expect(mapped((w, r) => w.type(r.from + 6, r.from + 6, ' '))).toBeNull();
		// The same text written over it counts as touched too.
		expect(mapped((w, r) => w.type(r.from, r.to, ITEM))).toBeNull();
	});

	it('refuses an item an edit rewrote, also once that edit is undone', () => {
		expect(
			mapped((w, r) =>
				w.apply({
					type: 'updateLeave',
					leave: { item: r, basedOn: w.version() },
					to: { type: 'annual', start: '2026-01-20', end: '2026-01-23' },
				}),
			),
		).toBeNull();
		expect(
			mapped((w, r) => {
				w.apply({
					type: 'updateLeave',
					leave: { item: r, basedOn: w.version() },
					to: { type: 'annual', start: '2026-01-20', end: '2026-01-23' },
				});
				w.history.undo();
				expect(w.text()).toBe(LEAVES);
			}),
		).toBeNull();
	});

	it('refuses a version below the log floor, and -1 (no index yet)', () => {
		const w = world(LEAVES, { logLimit: 4 });
		const v0 = w.version();
		const r = at(w, ITEM);
		for (let i = 0; i < 6; i++) w.type(0, 0, '#\n');
		expect(() => w.ws.changesSince(v0)).toThrow(RangeError);
		expect(w.base(v0).mapRange(r, v0)).toBeNull();
		expect(w.base(w.version()).mapRange(r, -1)).toBeNull();
	});

	it('rewrites a LeaveRef to the text now, or refuses it', () => {
		const w = world(LEAVES);
		const v0 = w.version();
		const r = at(w, ITEM);
		const intent: EditIntent = { type: 'removeLeave', leave: { item: r, basedOn: v0 } };
		w.type(0, 0, '# note\n');
		const now = rebase(intent, w.base(v0));
		expect(now).toEqual({
			type: 'removeLeave',
			leave: { item: at(w, ITEM), basedOn: w.version() },
		});
		w.type(at(w, ITEM).from, at(w, ITEM).from + 1, 'A');
		expect(rebase(intent, w.base(v0))).toBeNull();
	});
});

describe('subject ids', () => {
	it('refuses the rename chain: a to c, then b to a', () => {
		const w = world(TASKS);
		const v0 = w.version();
		w.apply({ type: 'renameTask', task: 'a', name: 'C', id: 'c' });
		w.apply({ type: 'renameTask', task: 'b', name: 'A', id: 'a' });
		expect(w.fresh().tasks.get('a')?.name).toBe('A');
		expect(rebase(effort('a'), w.base(v0))).toBeNull();
		expect(w.base(v0).isSame('task', 'a')).toBe(false);
		// The other id of the chain no longer exists: the edit API refuses it as before.
		expect(rebase(effort('b'), w.base(v0))).toEqual(effort('b'));
		expect(w.base(v0).isSame('task', 'b')).toBe(false);
	});

	it('refuses it when undo and redo make the chain too', () => {
		const w = world(TASKS);
		w.apply({ type: 'renameTask', task: 'a', name: 'C', id: 'c' });
		w.apply({ type: 'renameTask', task: 'b', name: 'A', id: 'a' });
		w.history.undo();
		w.history.undo();
		const v = w.publish();
		w.history.redo();
		w.history.redo();
		expect(rebase(effort('a'), w.base(v))).toBeNull();
	});

	it('passes a same-parent reorder followed by setAttr', () => {
		const w = world(TASKS);
		const v0 = w.version();
		w.apply({ type: 'moveTask', task: 'g.z', parent: 'g', index: 0 });
		expect(w.kept.ids(v0)).toBe(false);
		expect(rebase(effort('g.x'), w.base(v0))).toEqual(effort('g.x'));
		// Typing elsewhere can change ids, so the declarations are compared: still the same.
		w.type(0, 0, '# note\n');
		expect(w.kept.ids(v0)).toBe(true);
		expect(rebase(effort('g.x'), w.base(v0))).toEqual(effort('g.x'));
		expect(w.base(v0).isSame('task', 'g.x')).toBe(true);
	});

	it('passes an id taken from an add outcome (not in the shown index)', () => {
		const w = world(TASKS);
		const v0 = w.version();
		w.apply({ type: 'addTask', parent: null, index: 0, id: 'n', name: 'N' });
		expect(rebase(effort('n'), w.base(v0))).toEqual(effort('n'));
	});

	it('refuses when the shown index is no longer kept', () => {
		const w = world(TASKS);
		const v0 = w.version();
		for (let i = 0; i < KEEP; i++) {
			w.type(0, 0, '#\n');
			w.publish();
		}
		expect(w.kept.shown(v0)).toBeUndefined();
		expect(rebase(effort('a'), w.base(v0))).toBeNull();
		// Nothing that changes ids since: no shown index is needed.
		const w2 = world(TASKS);
		const v1 = w2.version();
		for (let i = 0; i < KEEP; i++) {
			w2.apply({ ...effort('b'), value: `${i + 2}d` });
			w2.publish();
		}
		expect(rebase(effort('a'), w2.base(v1))).toEqual(effort('a'));
	});

	it('needs no check on the fresh version, nor before anything was published', () => {
		const w = world(TASKS, { publish: false });
		const v0 = w.version();
		w.apply({ type: 'renameTask', task: 'a', name: 'C', id: 'c' });
		w.apply({ type: 'renameTask', task: 'b', name: 'A', id: 'a' });
		expect(rebase(effort('a'), w.base(v0))).toEqual(effort('a'));
		expect(rebase(effort('a'), w.base(w.version()))).toEqual(effort('a'));
	});

	it('names every id an intent acts on, but not a parent', () => {
		expect(subjectsOf({ type: 'replaceAllocation', task: 't', from: 'r1', to: 'r2' })).toEqual([
			['t'],
			['r1', 'r2'],
		]);
		expect(subjectsOf({ type: 'addDepends', task: 's', target: 'p' })).toEqual([['s', 'p'], []]);
		expect(subjectsOf({ type: 'allocate', task: 't', resources: ['a', 'b'] })).toEqual([
			['t'],
			['a', 'b'],
		]);
		expect(
			subjectsOf({
				type: 'setWorkingHours',
				scope: { kind: 'resource', resource: 'r' },
				days: ['mon'],
				hours: 'off',
			}),
		).toEqual([[], ['r']]);
		expect(subjectsOf({ type: 'addTask', parent: 'g', index: 0, name: 'N' })).toEqual([[], []]);
		expect(subjectsOf({ type: 'moveResource', resource: 'r', parent: 'g', index: 0 })).toEqual([
			[],
			['r'],
		]);
	});
});

describe('positions: the parent and its children', () => {
	const move = (index: number): EditIntent => ({ type: 'moveTask', task: 'a', parent: 'g', index });

	it('passes an unchanged child list', () => {
		const w = world(TASKS);
		const v0 = w.version();
		w.apply(effort('g.y'));
		w.type(0, 0, '# note\n');
		expect(rebase(move(1), w.base(v0))).toEqual(move(1));
		const add: EditIntent = { type: 'addTask', parent: 'g', index: 3, name: 'N' };
		expect(rebase(add, w.base(v0))).toEqual(add);
		// The moved item is left out: moving it within the parent does not count.
		const w2 = world(TASKS);
		const v1 = w2.version();
		w2.apply({ type: 'moveTask', task: 'g.y', parent: 'g', index: 0 });
		const again: EditIntent = { type: 'moveTask', task: 'g.y', parent: 'g', index: 2 };
		expect(rebase(again, w2.base(v1))).toEqual(again);
	});

	it('refuses a reordered or renamed sibling, or an added one', () => {
		const reordered = world(TASKS);
		const v0 = reordered.version();
		reordered.apply({ type: 'moveTask', task: 'g.z', parent: 'g', index: 0 });
		expect(rebase(move(1), reordered.base(v0))).toBeNull();

		const renamed = world(TASKS);
		const v1 = renamed.version();
		renamed.apply({ type: 'renameTask', task: 'g.y', name: 'W', id: 'w' });
		expect(rebase(move(1), renamed.base(v1))).toBeNull();

		const added = world(TASKS);
		const v2 = added.version();
		added.apply({ type: 'addTask', parent: 'g', index: 0, name: 'N' });
		expect(rebase(move(1), added.base(v2))).toBeNull();
	});

	it('checks the top level and resources the same way', () => {
		const w = world(TASKS);
		const v0 = w.version();
		w.apply({ type: 'moveTask', task: 'b', parent: null, index: 0 });
		const top: EditIntent = { type: 'moveTask', task: 'g', parent: null, index: 0 };
		expect(rebase(top, w.base(v0))).toBeNull();
		const r = world(
			'project p "P" 2026-01-05 +1m\nresource a "A"\nresource b "B"\nresource c "C"\n',
		);
		const v1 = r.version();
		r.apply({ type: 'moveResource', resource: 'c', parent: null, index: 0 });
		const res: EditIntent = { type: 'moveResource', resource: 'a', parent: null, index: 1 };
		expect(rebase(res, r.base(v1))).toBeNull();
		expect(rebase({ ...res, resource: 'c' }, r.base(v1))).toEqual({ ...res, resource: 'c' });
	});

	it('refuses a parent whose id now names another declaration', () => {
		// Typed: the container g becomes h, then b becomes g.
		const w = world(TASKS);
		const v0 = w.version();
		const g = at(w, 'task g').from + 'task '.length;
		w.type(g, g + 1, 'h');
		const b = at(w, 'task b').from + 'task '.length;
		w.type(b, b + 1, 'g');
		expect(w.fresh().tasks.get('g')?.name).toBe('B');
		const add: EditIntent = { type: 'addTask', parent: 'g', index: 0, name: 'N' };
		expect(rebase(add, w.base(v0))).toBeNull();
	});
});

describe('what can change ids', () => {
	it('classifies typing, intents and history entries', () => {
		const of = (i: EditIntent | { type: 'text'; file: string }): { readonly type: string } => i;
		expect(changesIds('typing')).toBe(true);
		expect(changesIds('intent')).toBe(true);
		expect(changesIds('format', { type: 'format' })).toBe(false);
		expect(changesIds('intent', effort('a'))).toBe(false);
		expect(changesIds('intent', of({ type: 'moveTask', task: 'g.x', parent: 'g', index: 0 }))).toBe(
			false,
		);
		expect(
			changesIds('intent', of({ type: 'moveTask', task: 'g.x', parent: null, index: 0 })),
		).toBe(true);
		expect(changesIds('history', of({ type: 'renameTask', task: 'a', name: 'B', id: 'b' }))).toBe(
			true,
		);
		expect(changesIds('history', of({ type: 'text', file: 'plan.tjp' }))).toBe(true);
		for (const type of ['addTask', 'deleteTask', 'addResource', 'deleteResource', 'gapToTask']) {
			expect(changesIds('intent', { type })).toBe(true);
		}
	});

	it('keeps the last KEEP published indexes', () => {
		const kept = new Kept(0);
		const idx = (version: number) => ({ version }) as SymbolIndex;
		const all = [0, 1, 2, 3, 4, 5].map(idx);
		for (const i of all) kept.publish(i);
		kept.publish(all[5] as SymbolIndex);
		expect([0, 1, 2, 3, 4, 5].map((v) => kept.shown(v)?.version)).toEqual([
			undefined,
			undefined,
			2,
			3,
			4,
			5,
		]);
		expect(new Kept(0).shown(0)).toBeNull();
	});
});

describe('prepare checks a gesture’s first call only', () => {
	it('lets a later call through on the gesture’s base, and refuses a first call', () => {
		const w = world(TASKS);
		const v0 = w.version();
		w.apply({ type: 'renameTask', task: 'a', name: 'C', id: 'c' });
		w.apply({ type: 'renameTask', task: 'b', name: 'A', id: 'a' });
		const fresh = w.fresh();
		const deps = {
			workspace: w.ws,
			runner: { ensureIndex: () => fresh, subscribe: () => () => undefined },
		};
		const job = (gesture?: Job['gesture']): Job => ({
			seq: 1,
			basedOn: v0,
			preview: undefined,
			kind: 'intent',
			intent: effort('a'),
			o: { label: { text: 'E', approx: false } },
			...(gesture ? { gesture } : {}),
		});
		expect(prepare(deps, w.kept, job())).toMatchObject({
			status: 'done',
			outcome: { status: 'refused', reason: 'target-changed' },
		});
		const base = { snap: w.ws.snapshot(), index: fresh };
		expect(prepare(deps, w.kept, job({ base, applied: null, broken: false })).status).toBe('ready');
	});

	it('locates a refused leave at its old range, in the version it was read in', () => {
		const w = world(LEAVES);
		const v0 = w.version();
		const r = at(w, ITEM);
		w.type(r.from + 1, r.from + 2, 'N');
		const fresh = w.fresh();
		const deps = {
			workspace: w.ws,
			runner: { ensureIndex: () => fresh, subscribe: () => () => undefined },
		};
		const p = prepare(deps, w.kept, {
			seq: 1,
			basedOn: v0,
			preview: undefined,
			kind: 'intent',
			intent: { type: 'removeLeave', leave: { item: r, basedOn: v0 } },
			o: { label: { text: 'R', approx: false } },
		});
		expect(p).toMatchObject({
			status: 'done',
			outcome: { status: 'refused', reason: 'target-changed', at: [] },
			at: { ...r, version: v0 },
		});
	});
});
