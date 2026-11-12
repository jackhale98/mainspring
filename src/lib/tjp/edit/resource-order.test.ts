// SPDX-License-Identifier: GPL-2.0-or-later
// Reading-order checks of `moveResource` (resource-order.ts). Each refused case is an error in
// TaskJuggler 3.8.4 (checked natively and in the wasm engine; the T11d review cases are named).
import { describe, expect, it } from 'vitest';
import { applyIntent } from './apply';
import { setup, textsAfter } from './testing';
import type { EditIntent, EditResult } from './types';

const H = 'project p "P" 2026-01-05 - 2026-03-27 {\n  now 2026-02-02\n}\n';
const S1 = 'shift s1 "S1" { workinghours mon - fri 9:00 - 13:00 }\n';

const status = (r: EditResult): string =>
	r.status === 'edit' ? 'edit' : `${r.status}:${r.reason}`;

function run(files: Record<string, string> | string, intent: EditIntent) {
	const s = setup(files);
	return { s, r: applyIntent(s.snap, s.index, intent) };
}

const move = (resource: string, parent: string | null, index: number): EditIntent => ({
	type: 'moveResource',
	resource,
	parent,
	index,
});

describe('moveResource later in reading order', () => {
	const supp =
		H +
		'resource a "A"\nsupplement resource a { efficiency 0.5 }\nresource b "B"\n' +
		'task t "T" { effort 3d allocate b }\n';

	it('refuses a place past a supplement of the subtree (cases supp, supp2)', () => {
		const { s, r } = run(supp, move('a', 'b', 0));
		expect(status(r)).toBe('refused:unfixable-reference');
		const at = r.status === 'refused' ? r.at : [];
		expect(at.map((x) => s.file().text.sliceString(x.from, x.to))).toEqual([
			'supplement resource a',
		]);
		expect(status(run(supp, move('a', null, 2)).r)).toBe('refused:unfixable-reference');
		// A supplement of a child of the moved resource counts too.
		const child = supp
			.replace('resource a "A"', 'resource a "A" {\n  resource k "K"\n}')
			.replace('supplement resource a', 'supplement resource k');
		expect(status(run(child, move('a', null, 2)).r)).toBe('refused:unfixable-reference');
	});

	it('refuses a place past an include whose resourceprefix names the subtree', () => {
		const files = {
			'plan.tjp':
				H +
				'resource a "A"\ninclude "x.tji" { resourceprefix a }\nresource b "B"\n' +
				'task t "T" { effort 3d allocate b }\n',
			'x.tji': 'resource x "X"\n',
		};
		expect(status(run(files, move('a', null, 2)).r)).toBe('refused:unfixable-reference');
	});

	it('refuses opaque mentions read before the new place, not those read after it', () => {
		const plan =
			H +
			'resource a "A"\nresource b "B"\ntask u "U" { effort 1d allocate b }\nresource c "C"\n' +
			'task t "T" {\n  effort 3d\n  allocate b\n  booking a 2026-01-05-09:00 +4h\n}\n';
		// Past b only: the booking in t is still read after a.
		const ok = run(plan, move('a', null, 1));
		expect(status(ok.r)).toBe('edit');
		expect(textsAfter(ok.s.snap, ok.r)['plan.tjp']).toContain(
			'resource b "B"\nresource a "A"\ntask u',
		);
		// Past t: the booking would name an undefined resource.
		const late = plan.replace('task t "T" {', 'task t "T" {').concat('resource z "Z"\n');
		expect(status(run(late, move('a', null, 3)).r)).toBe('refused:unfixable-reference');
		// A mention in a macro body counts wherever the macro is defined.
		const macro = plan + 'macro m [ booking a 2026-01-06-09:00 +4h ]\n';
		expect(status(run(macro, move('a', null, 1)).r)).toBe('refused:unfixable-reference');
	});
});

describe('moveResource earlier in reading order', () => {
	it('refuses a block with a booking of a task declared in between (case bookearly)', () => {
		const plan =
			H +
			'resource b "B"\ntask t "T" { effort 3d allocate b }\n' +
			'resource a "A" {\n  booking t 2026-01-05-09:00 +4h\n}\n';
		expect(status(run(plan, move('a', null, 0)).r)).toBe('refused:unfixable-reference');
		// Without the booking the move is fine.
		const plain = plan.replace('  booking t 2026-01-05-09:00 +4h\n', '');
		expect(status(run(plain, move('a', null, 0)).r)).toBe('edit');
	});

	it('refuses flags, shifts and macros declared in between', () => {
		const tail = 'task t "T" { effort 3d allocate b }\n';
		const flags = H + 'resource b "B"\nflags f1\nresource a "A" { flags f1 }\n' + tail;
		expect(status(run(flags, move('a', null, 0)).r)).toBe('refused:unfixable-reference');
		expect(status(run('flags f1\n' + flags.replace('flags f1\n', ''), move('a', null, 0)).r)).toBe(
			'edit',
		);
		const shifts = H + 'resource b "B"\n' + S1 + 'resource a "A" { shifts s1 }\n' + tail;
		expect(status(run(shifts, move('a', null, 0)).r)).toBe('refused:unfixable-reference');
		const early = H + S1 + 'resource b "B"\nresource a "A" { shifts s1 }\n' + tail;
		expect(status(run(early, move('a', null, 0)).r)).toBe('edit');
		const macro =
			H + 'resource b "B"\nmacro m [ efficiency 0.5 ]\nresource a "A" {\n  ${m}\n}\n' + tail;
		expect(status(run(macro, move('a', null, 0)).r)).toBe('refused:unfixable-reference');
	});
});
