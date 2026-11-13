// SPDX-License-Identifier: GPL-2.0-or-later
// Selection and the two mappings (phase-2.md 6.10): `taskAtCursor` and `sourceOf` over the real
// workspace, runner and index, with an index that lags the text, and the state's origin rules.
// The random edits are in selection.property.test.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { task } from '../workspace/testing/fake-engine-client';
import { harness, type Harness } from './edits-testing';
import {
	linkPlace,
	placeOf,
	SelectionState,
	sourceOf,
	taskAtCursor,
	type Selection,
} from './selection.svelte';

const PLAN = [
	'project p "P" 2026-01-05 +1m',
	'task a "A" {',
	'  effort 1d',
	'  task a1 "A1" {',
	'    effort 1d',
	'  }',
	'}',
	'task b "B" {',
	'  depends a',
	'  effort 2d',
	'}',
	'supplement task b {',
	'  priority 500',
	'}',
	'resource r "R"',
	'task c "C" { depends !b effort 1d }',
	'',
].join('\n');

let h: Harness;
beforeEach(async () => {
	h = harness({ entry: 'plan.tjp', files: { 'plan.tjp': PLAN } });
	await h.finish({ tasks: [task('a', 2, 600), task('a.a1', 4, 700), task('b', 8, 900)] });
});
afterEach(() => h.dispose());

const at = (needle: string, nth = 0): number => {
	let from = -1;
	for (let i = 0; i <= nth; i++) from = h.text().indexOf(needle, from + 1);
	if (from < 0) throw new Error(`no ${needle}`);
	return from;
};
const run = () => h.runner.state;

describe('taskAtCursor', () => {
	it('finds the task whose declaration holds the cursor, the smallest around it', () => {
		const find = (pos: number) => taskAtCursor(run(), h.ws, 'plan.tjp', pos);
		expect(find(at('task a "A"') + 2)).toBe('a');
		expect(find(at('effort 1d'))).toBe('a');
		expect(find(at('effort 1d', 1))).toBe('a.a1');
		expect(find(at('task a1') + 6)).toBe('a.a1');
		expect(find(at('effort 2d'))).toBe('b');
		expect(find(at('task c') + 1)).toBe('c');
	});

	it('finds the task through a reference inside it, and a supplement through its target', () => {
		const find = (pos: number) => taskAtCursor(run(), h.ws, 'plan.tjp', pos);
		// The cursor on `a` of `depends a` is in b; on `!b` of c's depends it is in c.
		expect(find(at('depends a') + 8)).toBe('b');
		expect(find(at('depends !b') + 9)).toBe('c');
		expect(find(at('priority 500'))).toBe('b');
		expect(find(at('supplement task b') + 2)).toBe('b');
	});

	it('finds no task in the project header, after the last one or in a resource', () => {
		const find = (pos: number) => taskAtCursor(run(), h.ws, 'plan.tjp', pos);
		expect(find(3)).toBeNull();
		expect(find(at('resource r') + 3)).toBeNull();
		expect(find(h.text().length)).toBeNull();
	});

	it('maps the cursor back through edits the index has not seen', () => {
		// Typed above everything: every position is 5 characters further on than the index knows.
		h.type('# hi\n\n', 0);
		expect(run().indexVersion).toBeLessThan(run().version);
		const find = (pos: number) => taskAtCursor(run(), h.ws, 'plan.tjp', pos);
		expect(find(at('effort 2d'))).toBe('b');
		expect(find(at('task a1') + 6)).toBe('a.a1');
		// The closing brace of a: read without the mapping, this position is inside b.
		expect(find(at('}\ntask b'))).toBe('a');
		// Inside the new text: the index has no task there either.
		expect(find(2)).toBeNull();
	});

	it('keeps text typed inside a block in that block', () => {
		const inside = at('effort 2d');
		h.type('  # why\n', inside);
		const find = (pos: number) => taskAtCursor(run(), h.ws, 'plan.tjp', pos);
		expect(find(inside + 3)).toBe('b');
		expect(find(at('effort 2d'))).toBe('b');
		expect(find(at('task c') + 1)).toBe('c');
	});

	it('answers null when the changes since the index are no longer kept', () => {
		const gone = {
			changesSince: () => {
				throw new RangeError('no longer kept');
			},
		};
		expect(taskAtCursor(run(), gone, 'plan.tjp', at('effort 2d'))).toBeNull();
	});
});

describe('sourceOf', () => {
	it('is the declaration block, supplements not included', () => {
		const r = sourceOf(run(), h.ws, 'b');
		expect(r).not.toBeNull();
		expect(h.text().slice(r?.from, r?.to)).toBe('task b "B" {\n  depends a\n  effort 2d\n}');
		const nested = sourceOf(run(), h.ws, 'a.a1');
		expect(h.text().slice(nested?.from, nested?.to)).toBe('task a1 "A1" {\n    effort 1d\n  }');
	});

	it('follows edits the index has not seen, forward through the changes', () => {
		h.type('# above\n', 0);
		h.type('  # inside\n', at('  effort 2d'));
		expect(run().indexVersion).toBeLessThan(run().version);
		const r = sourceOf(run(), h.ws, 'b');
		// The line typed inside is in the block; the one typed above it is not.
		expect(h.text().slice(r?.from, r?.to)).toBe(
			'task b "B" {\n  depends a\n  # inside\n  effort 2d\n}',
		);
	});

	it('places the cursor on the declared id, else on the header', () => {
		const p = placeOf(run(), h.ws, 'b');
		expect(h.text().slice(p?.at.from, p?.at.to)).toBe('b');
	});

	it('falls back to the engine source line of a task the index cannot name', async () => {
		// The result names a task that no declaration of the text gives (a macro would).
		h.runner.changed('now');
		await h.finish({ tasks: [task('b', 8, 900), task('ghost', 16, 900)] });
		expect(run().index.tasks.has('ghost')).toBe(false);
		const r = sourceOf(run(), h.ws, 'ghost');
		expect(h.text().slice(r?.from, r?.to)).toBe('task c "C" { depends !b effort 1d }');
		expect(sourceOf(run(), h.ws, 'nobody')).toBeNull();
		// Typed after that line, its place is still known; typed before it, it is not.
		h.type('# end\n', h.text().length);
		expect(h.text().slice(sourceOf(run(), h.ws, 'ghost')?.from)).toMatch(/^task c/);
		h.type('# above\n', 0);
		expect(sourceOf(run(), h.ws, 'ghost')).toBeNull();
	});
});

describe('linkPlace', () => {
	it('is the depends statement behind the link', () => {
		const p = linkPlace(run(), h.ws, { pred: 'a', succ: 'b' });
		expect(h.text().slice(p?.block.from, p?.block.to)).toBe('depends a');
		expect(linkPlace(run(), h.ws, { pred: 'b', succ: 'a' })).toBeNull();
	});

	it('moves with the text', () => {
		h.type('# above\n', 0);
		const p = linkPlace(run(), h.ws, { pred: 'b', succ: 'c' });
		expect(h.text().slice(p?.block.from, p?.block.to)).toBe('depends !b');
	});
});

describe('SelectionState', () => {
	function state(): { s: SelectionState; seen: Selection[] } {
		const seen: Selection[] = [];
		return { s: new SelectionState((x) => seen.push(x)), seen };
	}

	it('selects a task from a visual every time, from the text only when it changes', () => {
		const { s, seen } = state();
		s.selectTask('a', 'visual');
		s.selectTask('a', 'visual');
		expect(seen).toHaveLength(2);
		// The cursor stays in the same task: nothing changes, the visual selection keeps its origin.
		expect(s.selectTask('a', 'text')).toBe(false);
		expect(s.current).toEqual({ kind: 'task', id: 'a', origin: 'visual' });
		expect(s.follow).toBeNull();
		// Another task from the text: the Gantt is asked to scroll to it.
		expect(s.selectTask('b', 'text')).toBe(true);
		expect(s.current).toEqual({ kind: 'task', id: 'b', origin: 'text' });
		expect(s.follow).toMatchObject({ key: 'task:b' });
		expect(s.taskKey).toBe('task:b');
		const first = s.follow?.nonce;
		s.selectTask('a', 'text');
		expect(s.follow?.nonce).not.toBe(first);
	});

	it('keeps a task and a link apart', () => {
		const { s } = state();
		s.selectTask('a', 'visual');
		s.selectLink('a', 'b');
		expect(s.task).toBeNull();
		expect(s.taskKey).toBeNull();
		expect(s.link).toEqual({ pred: 'a', succ: 'b' });
		expect(s.rowKey).toBe('task:b');
		s.selectTask('c', 'visual');
		expect(s.link).toBeNull();
		s.selectLink('a', 'b');
		s.clearLink();
		expect(s.current).toBeNull();
		// Clearing a link leaves a selected task alone.
		s.selectTask('c', 'visual');
		s.clearLink();
		expect(s.taskKey).toBe('task:c');
	});

	it('follows a rename, a descendant of the moved task and a link end included', () => {
		const { s, seen } = state();
		s.selectTask('a', 'visual');
		expect(s.followRenames(new Map([['a', 'g.a']]))).toBe(true);
		expect(s.current).toEqual({ kind: 'task', id: 'g.a', origin: 'visual' });
		s.selectTask('a.a1', 'text');
		s.followRenames(new Map([['a', 'g.a']]));
		expect(s.current).toEqual({ kind: 'task', id: 'g.a.a1', origin: 'text' });
		s.selectLink('a.a1', 'b');
		s.followRenames(new Map([['a', 'g.a']]));
		expect(s.link).toEqual({ pred: 'g.a.a1', succ: 'b' });
		const n = seen.length;
		// A rename that does not touch the selection changes nothing (a name that only starts alike).
		expect(s.followRenames(new Map([['ab', 'x']]))).toBe(false);
		expect(s.followRenames(new Map())).toBe(false);
		expect(seen).toHaveLength(n);
	});

	it('clears, and says so once', () => {
		const { s, seen } = state();
		s.clear();
		expect(seen).toHaveLength(0);
		s.selectTask('a', 'text');
		s.clear();
		expect(s.current).toBeNull();
		expect(s.follow).toBeNull();
		expect(seen.at(-1)).toBeNull();
	});
});
