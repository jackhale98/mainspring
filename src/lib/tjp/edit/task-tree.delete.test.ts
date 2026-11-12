// SPDX-License-Identifier: GPL-2.0-or-later
// deleteTask (phase-1.md 7.1): the block with its attached leading comments, the subtree's
// supplement blocks and the depends/precedes items naming it elsewhere; refusals for references
// it cannot fix; inverse and targets.
import { describe, expect, it } from 'vitest';
import { applyIntent } from './apply';
import { deleteTask } from './task-tree';
import { setup, textsAfter } from './testing';
import type { EditResult } from './types';

const H = 'project p "P" 2026-01-05 +2m\nresource r "R"\n';

function del(files: Record<string, string> | string, task: string): EditResult {
	const s = setup(files);
	return deleteTask(s.snap, s.index, task);
}

function after(files: Record<string, string> | string, task: string, path = 'plan.tjp'): string {
	const s = setup(files);
	return textsAfter(s.snap, applyIntent(s.snap, s.index, { type: 'deleteTask', task }))[path] ?? '';
}

describe('deleteTask', () => {
	it('removes the block with its attached comments, not a detached one', () => {
		const plan = H + '# detached\n\n# about a\n# more\ntask a "A" {\n  effort 1d\n}\ntask b "B"\n';
		expect(after(plan, 'a')).toBe(H + '# detached\n\ntask b "B"\n');
	});

	it('removes dependency items naming the subtree and empties statements whole', () => {
		const plan =
			H +
			'task a "A" {\n  task x "X" { effort 1d }\n  task y "Y" { effort 1d depends !x }\n}\n' +
			'task b "B" {\n  effort 1d\n  depends a.x, c { gapduration 1d }, a.y\n}\n' +
			'task c "C" {\n  effort 1d\n  precedes a.y # gone\n  depends a\n}\n';
		expect(after(plan, 'a')).toBe(
			H +
				'task b "B" {\n  effort 1d\n  depends c { gapduration 1d }\n}\n' +
				'task c "C" {\n  effort 1d\n  # gone\n}\n',
		);
	});

	it('removes supplement blocks of the subtree, in other files too', () => {
		const files = {
			'plan.tjp': H + 'task a "A" {\n  task x "X"\n}\ntask b "B"\ninclude "s.tji"\n',
			's.tji':
				'# for x\nsupplement task a.x {\n  effort 2d\n}\nsupplement task b {\n  effort 1d\n}\n',
		};
		const s = setup(files);
		const t = textsAfter(s.snap, deleteTask(s.snap, s.index, 'a'));
		expect(t['plan.tjp']).toBe(H + 'task b "B"\ninclude "s.tji"\n');
		expect(t['s.tji']).toBe('supplement task b {\n  effort 1d\n}\n');
	});

	it('keeps references from inside the subtree (they go with it) and CRLF breaks', () => {
		const plan = (H + 'task a "A" {\n  depends b\n}\r\ntask b "B" {\n  depends a\n}\n').replace(
			/\r?\n/g,
			'\r\n',
		);
		expect(after(plan, 'a')).toBe((H + 'task b "B" {\n}\n').replace(/\n/g, '\r\n'));
	});

	it('gives an inverse that restores the text and targets that hold every change', () => {
		const plan = H + 'task a "A"\ntask b "B" { depends a, c }\ntask c "C"\n';
		const s = setup(plan);
		const r = deleteTask(s.snap, s.index, 'a');
		if (r.status !== 'edit') throw new Error(JSON.stringify(r));
		const cs = r.edit.changes['plan.tjp'];
		const inv = r.edit.inverse['plan.tjp'];
		const base = s.file().text;
		expect(cs && inv && inv.apply(cs.apply(base)).toString()).toBe(plan);
		const targets = r.edit.targets['plan.tjp'] ?? [];
		cs?.iterChangedRanges((from, to) => {
			expect(targets.some((t) => t.from <= from && to <= t.to)).toBe(true);
		});
	});
});

describe('deleteTask refusals', () => {
	it('refuses mentions in macro bodies and opaque statements', () => {
		const mac = H + 'macro dep [ depends a ]\ntask a "A"\ntask b "B" { ${dep} }\n';
		expect(del(mac, 'a')).toMatchObject({ status: 'refused', reason: 'unfixable-reference' });
		const report = H + 'task a "A"\ntaskreport t "t" { taskroot a }\n';
		expect(del(report, 'a')).toMatchObject({ reason: 'unfixable-reference' });
	});

	it('refuses a task named by a taskprefix', () => {
		const files = {
			'plan.tjp': H + 'task p "P"\ninclude "s.tji" { taskprefix p }\n',
			's.tji': 'task s "S"\n',
		};
		const r = del(files, 'p');
		expect(r).toMatchObject({ reason: 'unfixable-reference' });
		// A task declared in the prefixed file can go.
		expect(del(files, 'p.s')).toMatchObject({ status: 'edit' });
	});

	it('refuses text read in several include visits and expanded-only or unknown tasks', () => {
		const shared = {
			'plan.tjp':
				H +
				'task g1 "G1"\ntask g2 "G2"\n' +
				'include "t.tji" { taskprefix g1 }\ninclude "t.tji" { taskprefix g2 }\n',
			't.tji': 'task t "T"\n',
		};
		expect(del(shared, 'g1.t')).toMatchObject({
			reason: 'shared-declaration',
			affects: ['g1.t', 'g2.t'],
		});
		expect(del(H + 'task a "A"\n', 'zz')).toMatchObject({ reason: 'unknown-target' });
	});

	it('refuses a block that holds a statement-level macro call that may declare tasks', () => {
		const plan = H + 'macro kids [ task k "K" ]\ntask a "A" {\n  ${kids}\n}\n';
		expect(del(plan, 'a')).toMatchObject({ status: 'refused' });
	});

	it('refuses a dependency statement written with a macro', () => {
		const plan = H + 'macro t [ a ]\ntask a "A"\ntask b "B" {\n  depends ${t}, a\n}\n';
		expect(del(plan, 'a')).toMatchObject({ status: 'refused' });
	});
});
