// SPDX-License-Identifier: GPL-2.0-or-later
// moveTask (phase-1.md 7.1, 7.2; ADR-0003 #7): reorder and reparent, re-indentation, moves across
// files (unit and line breaks), reference rewriting (relative and absolute, supplements) and
// refusals.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../../../../tests/grammar/corpus';
import { applyIntent } from './apply';
import { moveTask } from './task-tree';
import { setup, textsAfter } from './testing';
import type { EditResult } from './types';

const H = 'project p "P" 2026-01-05 +2m\nresource r "R"\n';
const REL = fs.readFileSync(path.join(ROOT, 'tests/fixtures/tjp/relative-ids/plan.tjp'), 'utf8');

function mv(
	files: Record<string, string> | string,
	task: string,
	parent: string | null,
	index: number,
): EditResult {
	const s = setup(files);
	return moveTask(s.snap, s.index, task, parent, index);
}

function after(
	files: Record<string, string> | string,
	task: string,
	parent: string | null,
	index: number,
): Record<string, string> {
	const s = setup(files);
	return textsAfter(
		s.snap,
		applyIntent(s.snap, s.index, { type: 'moveTask', task, parent, index }),
	);
}

describe('moveTask reorder and reparent', () => {
	const plan = H + '# about a\ntask a "A" {\n  effort 1d\n}\ntask b "B" {\n  task x "X"\n}\n';

	it('reorders with the leading comments, and is a no-op in place', () => {
		expect(after(plan, 'a', null, 1)['plan.tjp']).toBe(
			H + 'task b "B" {\n  task x "X"\n}\n# about a\ntask a "A" {\n  effort 1d\n}\n',
		);
		expect(mv(plan, 'a', null, 0)).toEqual({ status: 'noop', reason: 'already-set' });
	});

	it('re-indents to the new depth by the unit, before or after siblings', () => {
		expect(after(plan, 'a', 'b', 0)['plan.tjp']).toBe(
			H + 'task b "B" {\n  # about a\n  task a "A" {\n    effort 1d\n  }\n  task x "X"\n}\n',
		);
		expect(after(plan, 'b.x', null, 0)['plan.tjp']).toBe(
			H + 'task x "X"\n# about a\ntask a "A" {\n  effort 1d\n}\ntask b "B" {\n}\n',
		);
	});

	it('creates a body for a parent without one, and moves into a one-line body inline', () => {
		expect(after(H + 'task a "A"\ntask c "C" {\n  effort 1d\n}\n', 'c', 'a', 0)['plan.tjp']).toBe(
			H + 'task a "A" {\n  task c "C" {\n    effort 1d\n  }\n}\n',
		);
		expect(after(H + 'task a "A" { task b "B" }\ntask c "C"\n', 'c', 'a', 1)['plan.tjp']).toBe(
			H + 'task a "A" { task b "B" task c "C" }\n',
		);
	});

	it('opens a one-line body for a multi-line block, and keeps a comment after the block', () => {
		const one = H + 'task a "A" { task b "B" }\ntask c "C" {\n  duration 1d\n}\n';
		expect(after(one, 'c', 'a', 1)['plan.tjp']).toBe(
			H + 'task a "A" { task b "B"\n  task c "C" {\n    duration 1d\n  }\n}\n',
		);
		expect(after(one, 'c', 'a', 0)['plan.tjp']).toBe(
			H + 'task a "A" {\n  task c "C" {\n    duration 1d\n  }\n  task b "B" }\n',
		);
		const trailing = H + 'task a "A" {\n  duration 1d\n} # done\ntask b "B"\n';
		expect(after(trailing, 'a', null, 1)['plan.tjp']).toBe(
			H + 'task b "B"\ntask a "A" {\n  duration 1d\n} # done\n',
		);
	});

	it('copies the previous sibling separation', () => {
		const spaced = H + '\ntask a "A"\n\ntask b "B"\ntask c "C" {\n  task d "D"\n}\n';
		expect(after(spaced, 'c.d', null, 2)['plan.tjp']).toBe(
			H + '\ntask a "A"\n\ntask b "B"\n\ntask d "D"\ntask c "C" {\n}\n',
		);
		expect(after(spaced, 'c.d', null, 1)['plan.tjp']).toBe(
			H + '\ntask a "A"\n\ntask d "D"\n\ntask b "B"\ntask c "C" {\n}\n',
		);
	});

	it('leaves quoted strings untouched and shifts cut-here strings uniformly', () => {
		const text =
			H +
			'task a "A" {\n  task b "B" {\n    note "one\n  two"\n    note -8<-\n    x\n      y\n    ->8-\n  }\n}\n';
		expect(after(text, 'a.b', null, 1)['plan.tjp']).toBe(
			H +
				'task a "A" {\n}\ntask b "B" {\n  note "one\n  two"\n  note -8<-\n  x\n    y\n  ->8-\n}\n',
		);
		// An inner line less indented than the block: the cut-here string stays as written.
		const odd = H + 'task a "A" {\n  task b "B" {\n    note -8<-\nx\n    ->8-\n  }\n}\n';
		expect(after(odd, 'a.b', null, 1)['plan.tjp']).toBe(
			H + 'task a "A" {\n}\ntask b "B" {\n  note -8<-\nx\n    ->8-\n}\n',
		);
	});

	it('moves across files with the destination unit and line breaks', () => {
		const files = {
			'plan.tjp': (
				H +
				'task a "A" {\n  task b "B" {\n    effort 1d\n    note "x\n  y"\n  }\n}\ninclude "t.tji"\n'
			).replace(/\n/g, '\r\n'),
			't.tji': 'task c "C" {\n\ttask d "D" {\n\t\teffort 1d\n\t}\n}\n',
		};
		const t = after(files, 'a.b', 'c', 0);
		expect(t['plan.tjp']).toBe((H + 'task a "A" {\n}\ninclude "t.tji"\n').replace(/\n/g, '\r\n'));
		expect(t['t.tji']).toBe(
			'task c "C" {\n\ttask b "B" {\n\t\teffort 1d\n\t\tnote "x\n  y"\n\t}\n\ttask d "D" {\n\t\teffort 1d\n\t}\n}\n',
		);
		const back = after(files, 'c.d', 'a', 1);
		expect(back['plan.tjp']).toContain('  }\r\n  task d "D" {\r\n    effort 1d\r\n  }\r\n}\r\n');
		expect(back['t.tji']).toBe('task c "C" {\n}\n');
	});

	it('moves into a prefixed include when the previous sibling is declared there', () => {
		const files = {
			'plan.tjp':
				H + 'task p "P" {\n  task x "X" { effort 1d }\n}\ninclude "s.tji" { taskprefix p }\n',
			's.tji': 'task s "S" {\n  effort 1d\n}\n',
		};
		const t = after(files, 'p.x', 'p', 1);
		expect(t['plan.tjp']).toBe(H + 'task p "P" {\n}\ninclude "s.tji" { taskprefix p }\n');
		expect(t['s.tji']).toBe('task s "S" {\n  effort 1d\n}\ntask x "X" { effort 1d }\n');
	});
});

describe('moveTask references', () => {
	it('re-derives relative ids and rewrites absolute ones, keeping spellings that still resolve', () => {
		const t = after(REL, 'top.s1', 'top.grp', 0)['plan.tjp'] ?? '';
		// From s2 (outside): `!s1` no longer resolves, absolute; from g1 (now a sibling): `!s1`.
		expect(t).toContain('depends top.grp.s1\n');
		expect(t).toContain('depends !!s2, !s1 { gapduration 1d }');
		const root = after(REL, 'top.grp.g1', null, 1)['plan.tjp'] ?? '';
		// Inside the moved block: `!!s2` from the root is `top.s2`; from g2, `!g1` becomes `g1`.
		expect(root).toContain(
			'task g1 "G1" {\n  effort 1d\n  depends top.s2, top.s1 { gapduration 1d }',
		);
		expect(root).toContain('depends g1 { onstart }, !!!other');
	});

	it('updates supplement paths below their base, and refuses when none fits', () => {
		const top = H + 'task c "C"\ntask a "A" { task b "B" }\nsupplement task a.b { effort 1d }\n';
		expect(after(top, 'a.b', 'c', 0)['plan.tjp']).toBe(
			H + 'task c "C" {\n  task b "B"\n}\ntask a "A" { }\nsupplement task c.b { effort 1d }\n',
		);
		const nested =
			H +
			'task c "C"\ntask a "A" { task b "B" }\nsupplement task a { supplement task b { effort 1d } }\n';
		expect(mv(nested, 'a.b', 'c', 0)).toMatchObject({ reason: 'unfixable-reference' });
		// The rewritten supplement would come before the new declaration.
		const early = H + 'task a "A" { task b "B" }\nsupplement task a.b { effort 1d }\ntask c "C"\n';
		expect(mv(early, 'a.b', 'c', 0)).toMatchObject({ reason: 'unfixable-reference' });
	});

	it('rewrites references in other files', () => {
		const files = {
			'plan.tjp': H + 'task a "A" { task b "B" { effort 1d } }\ntask c "C"\ninclude "u.tji"\n',
			'u.tji': 'task u "U" {\n  depends a.b\n}\n',
		};
		expect(after(files, 'a.b', 'c', 0)['u.tji']).toBe('task u "U" {\n  depends c.b\n}\n');
	});
});

describe('moveTask refusals', () => {
	const plan =
		H + 'task a "A" {\n  task b "B" {\n    task x "X"\n  }\n}\ntask c "C" {\n  task x "X2"\n}\n';

	it('refuses moves into the own subtree, id collisions and unknown targets', () => {
		expect(mv(plan, 'a', 'a.b', 0)).toMatchObject({ reason: 'cycle' });
		expect(mv(plan, 'a', 'a', 0)).toMatchObject({ reason: 'cycle' });
		expect(mv(plan, 'a.b.x', 'c', 0)).toMatchObject({ reason: 'id-collision' });
		expect(mv(plan, 'a.b', 'nope', 0)).toMatchObject({ reason: 'unknown-target' });
		expect(mv(plan, 'a.b', 'c', 3)).toMatchObject({ reason: 'invalid-value' });
	});

	it('refuses a move that makes a task depend on its ancestor or descendant', () => {
		const deps = H + 'task a "A" { effort 1d }\ntask b "B" { effort 1d depends a }\n';
		expect(mv(deps, 'a', 'b', 0)).toMatchObject({ reason: 'cycle' });
		expect(mv(deps, 'b', 'a', 0)).toMatchObject({ reason: 'cycle' });
	});

	it('refuses engine errors the text decides (container sizing, lost allocation, loops)', () => {
		const leaf = H + 'task a "A" {\n  allocate r\n  effort 2d\n}\ntask x "X" { duration 1d }\n';
		expect(mv(leaf, 'x', 'a', 0)).toMatchObject({ reason: 'conflicting-attribute' });
		const alloc =
			H +
			'task p "P" {\n  allocate r\n  task x "X" { effort 1d }\n  task z "Z" { effort 1d }\n}\n' +
			'task q "Q" {\n  task y "Y" { duration 1d }\n}\n';
		expect(mv(alloc, 'p.x', 'q', 0)).toMatchObject({ reason: 'conflicting-attribute' });
		expect(
			mv(alloc.replace('task q "Q" {', 'task q "Q" {\n  allocate r'), 'p.x', 'q', 0),
		).toMatchObject({ status: 'edit' });
		const loop =
			H +
			'task a "A" { duration 1d depends b }\n' +
			'task q "Q" {\n  depends a\n  task y "Y" { duration 1d }\n}\ntask b "B" { duration 1d }\n';
		expect(mv(loop, 'b', 'q', 1)).toMatchObject({ reason: 'cycle' });
	});

	it('names the late declaration a moved block would come before', () => {
		const flag = H + 'task a "A" { duration 1d }\nflags hot\ntask b "B" { flags hot }\n';
		expect(mv(flag, 'b', null, 0)).toMatchObject({ reason: 'undeclared-flag' });
		const res =
			'project p "P" 2026-01-05 +2m\ntask a "A" { duration 1d }\nresource r "R"\ntask b "B" { effort 1d allocate r }\n';
		expect(mv(res, 'b', null, 0)).toMatchObject({ reason: 'unknown-target' });
	});

	it('refuses mentions it cannot fix, and allows reorders that keep the ids', () => {
		const men =
			H + 'macro m [ depends a ]\ntask a "A" { duration 1d }\ntask b "B" { priority 600 }\n';
		expect(mv(men, 'a', 'b', 0)).toMatchObject({ reason: 'unfixable-reference' });
		expect(mv(men, 'a', null, 1)).toMatchObject({ status: 'edit' });
		const report = H + 'task a "A"\ntask b "B"\ntaskreport t "t" { taskroot a }\n';
		expect(mv(report, 'a', 'b', 0)).toMatchObject({ reason: 'unfixable-reference' });
	});

	it('refuses relative text it cannot read when the ids change', () => {
		const mac =
			H +
			'macro dep [ depends !b ]\ntask a "A" {\n  task x "X" { ${dep} }\n  task b "B"\n}\ntask c "C"\n';
		expect(mv(mac, 'a.x', 'c', 0)).toMatchObject({ reason: 'unfixable-reference' });
	});

	it('refuses a block that would call a macro before its definition', () => {
		const mac = H + 'task a "A"\nmacro m [ effort 1d ]\ntask b "B" {\n  ${m}\n}\n';
		expect(mv(mac, 'b', null, 0)).toMatchObject({ reason: 'text-only', textOnly: 'macro-call' });
		expect(mv(mac, 'b', 'a', 0)).toMatchObject({ reason: 'text-only' });
	});

	it('refuses text read in several include visits', () => {
		const shared = {
			'plan.tjp':
				H +
				'task g1 "G1"\ntask g2 "G2"\n' +
				'include "t.tji" { taskprefix g1 }\ninclude "t.tji" { taskprefix g2 }\n',
			't.tji': 'task t "T"\ntask u "U"\n',
		};
		expect(mv(shared, 'g1.t', 'g1', 1)).toMatchObject({ reason: 'shared-declaration' });
		expect(mv(shared, 'g1', 'g2', 0)).toMatchObject({ reason: 'unfixable-reference' });
	});
});
