// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { buildIndex } from '../index';
import { createWorkspace } from '../../workspace/workspace';
import { applyIntent } from './apply';
import { addDepends, removeDepends } from './link-intents';
import { setup, textsAfter } from './testing';
import type { EditIntent, EditResult } from './types';

const HEAD = 'project p "P" 2026-01-05 +2m\nresource r "R"\n';

function run(files: Record<string, string> | string, intent: EditIntent): EditResult {
	const s = setup(files);
	return applyIntent(s.snap, s.index, intent);
}

function after(
	files: Record<string, string> | string,
	intent: EditIntent,
	path = 'plan.tjp',
): string {
	const s = setup(files);
	return textsAfter(s.snap, applyIntent(s.snap, s.index, intent))[path] ?? '';
}

const add = (task: string, target: string): EditIntent => ({ type: 'addDepends', task, target });
const remove = (task: string, target: string): EditIntent => ({
	type: 'removeDepends',
	task,
	target,
});

describe('addDepends', () => {
	it('appends a sibling as !id to the last own depends', () => {
		const plan = HEAD + 'task a "A"\ntask c "C"\ntask b "B" {\n  depends !c\n  effort 1d\n}\n';
		expect(after(plan, add('b', 'a'))).toBe(
			HEAD + 'task a "A"\ntask c "C"\ntask b "B" {\n  depends !c, !a\n  effort 1d\n}\n',
		);
	});

	it('inserts a depends statement by 7.2 order, with the absolute id for a non-sibling', () => {
		const plan =
			HEAD + 'task g "G" {\n  task x "X"\n}\ntask b "B" {\n  effort 1d\n  allocate r\n}\n';
		expect(after(plan, add('b', 'g.x'))).toBe(
			HEAD +
				'task g "G" {\n  task x "X"\n}\ntask b "B" {\n  effort 1d\n  depends g.x\n  allocate r\n}\n',
		);
	});

	it('creates a body when the task has none, and keeps CRLF and tabs', () => {
		expect(after(HEAD + 'task a "A"\ntask b "B"\n', add('b', 'a'))).toBe(
			HEAD + 'task a "A"\ntask b "B" {\n  depends !a\n}\n',
		);
		const crlf =
			'project p "P" 2026-01-05 +2m\r\ntask a "A"\r\ntask b "B" {\r\n\teffort 1d\r\n}\r\n';
		expect(after(crlf, add('b', 'a'))).toBe(
			'project p "P" 2026-01-05 +2m\r\ntask a "A"\r\ntask b "B" {\r\n\teffort 1d\r\n\tdepends !a\r\n}\r\n',
		);
	});

	it('never puts the new statement after a child task (container_attribute)', () => {
		const plan = HEAD + 'task a "A"\ntask b "B" {\n  task c "C"\n  note "late"\n}\n';
		expect(after(plan, add('b', 'a'))).toBe(
			HEAD + 'task a "A"\ntask b "B" {\n  depends !a\n  task c "C"\n  note "late"\n}\n',
		);
	});

	it('appends to the supplement site when that is the last one', () => {
		const plan =
			HEAD +
			'task a "A"\ntask c "C"\ntask b "B" {\n  depends !c\n}\nsupplement task b {\n  depends a\n}\n';
		const s = setup(plan);
		const r = addDepends(s.snap, s.index, 'b', 'c');
		expect(r).toEqual({ status: 'noop', reason: 'already-linked' });
		const plan2 = plan.replace('task c "C"\n', 'task c "C"\ntask d "D"\n');
		expect(after(plan2, add('b', 'd'))).toBe(plan2.replace('  depends a\n', '  depends a, !d\n'));
	});

	it('is already-linked through depends, precedes and inherited lists', () => {
		expect(run(HEAD + 'task a "A"\ntask b "B" { depends !a }\n', add('b', 'a'))).toEqual({
			status: 'noop',
			reason: 'already-linked',
		});
		expect(run(HEAD + 'task a "A" { precedes !b }\ntask b "B"\n', add('b', 'a'))).toMatchObject({
			status: 'noop',
			reason: 'already-linked',
		});
		const inherited = HEAD + 'task a "A"\ntask g "G" {\n  depends a\n  task x "X"\n}\n';
		expect(run(inherited, add('g.x', 'a'))).toMatchObject({ reason: 'already-linked' });
		// A parent's depends written after the child is not inherited.
		const later =
			HEAD + 'task a "A"\ntask g "G" {\n  task x "X"\n}\nsupplement task g { depends a }\n';
		expect(run(later, add('g.x', 'a'))).toMatchObject({ status: 'edit' });
	});

	it('refuses an unprefixed link when only a scenario-prefixed depends exists', () => {
		const plan =
			'project p "P" 2026-01-05 +2m {\n  scenario plan "Plan" {\n    scenario d "D"\n  }\n}\n' +
			'task a "A"\ntask b "B" {\n  d:depends !a\n}\n';
		expect(run(plan, add('b', 'a'))).toMatchObject({
			status: 'refused',
			reason: 'conflicting-attribute',
		});
		// A prefix naming the top scenario is the same as none.
		expect(run(plan.replace('d:depends', 'plan:depends'), add('b', 'a'))).toMatchObject({
			status: 'noop',
		});
	});

	it('refuses unknown targets, self, parent and child dependencies', () => {
		const plan = HEAD + 'task g "G" {\n  task x "X"\n}\n';
		expect(run(plan, add('g.x', 'nope'))).toMatchObject({ reason: 'unknown-target' });
		expect(run(plan, add('nope', 'g'))).toMatchObject({ reason: 'unknown-target' });
		expect(run(plan, add('g', 'g'))).toMatchObject({ reason: 'cycle' });
		expect(run(plan, add('g.x', 'g'))).toMatchObject({ reason: 'cycle' });
		expect(run(plan, add('g', 'g.x'))).toMatchObject({ reason: 'cycle' });
	});

	it('refuses loops the way TaskJuggler finds them', () => {
		const chain =
			HEAD +
			'task a "A" { effort 1d allocate r }\ntask b "B" { effort 1d depends !a allocate r }\n';
		expect(run(chain, add('a', 'b'))).toMatchObject({ reason: 'cycle' });
		// Through a container: g depends on c, and g's child x would feed c.
		const via =
			HEAD +
			'task c "C" { effort 1d allocate r }\ntask g "G" {\n  depends c\n  task x "X" { effort 1d allocate r }\n}\n';
		expect(run(via, add('c', 'g.x'))).toMatchObject({ reason: 'cycle' });
		// Through precedes, with either scheduling direction.
		const prec =
			HEAD +
			'task a "A" { effort 1d precedes !b scheduling asap allocate r }\ntask b "B" { effort 1d allocate r }\n';
		expect(run(prec, add('a', 'b'))).toMatchObject({ reason: 'cycle' });
		expect(run(prec.replace(' scheduling asap', ''), add('a', 'b'))).toMatchObject({
			reason: 'cycle',
		});
		// Contradictions TaskJuggler's own walk misses (an ALAP task feeding an ASAP one, a start
		// linked back to a start) are cycles of time points: refused too (dep-loops.ts).
		const alap =
			HEAD +
			'task c "C" { effort 1d precedes !g allocate r }\ntask g "G" {\n  task x "X" { effort 1d allocate r }\n}\n';
		expect(run(alap, add('c', 'g.x'))).toMatchObject({ reason: 'cycle' });
		const starts =
			HEAD +
			'task a "A" { effort 1d allocate r }\ntask b "B" { effort 1d depends !a { onstart } allocate r }\n';
		expect(run(starts, add('a', 'b'))).toMatchObject({ reason: 'cycle' });
		// The Tutorial case: gui (in software) after test, whose alpha follows software.
		const nested =
			HEAD +
			'task sw "SW" {\n  task gui "GUI" { effort 1d allocate r }\n}\n' +
			'task test "Test" {\n  task alpha "Alpha" { effort 1d depends !!sw allocate r }\n' +
			'  task beta "Beta" { effort 1d depends !alpha allocate r }\n}\n' +
			'task done "Done" { depends test.beta }\n';
		expect(run(nested, add('sw.gui', 'test'))).toMatchObject({ reason: 'cycle' });
		// The ProjectTemplate case: an unnamed child of del follows wp1.
		const unnamed =
			HEAD +
			'task top "Top" {\n  task wp1 "WP1" { effort 1d allocate r }\n' +
			'  task del "Del" {\n    task "Item 1" { depends !!wp1 }\n  }\n}\n';
		expect(run(unnamed, add('top.wp1', 'top.del'))).toMatchObject({ reason: 'cycle' });
		// `depends` makes a task ASAP: with an effort and a fixed end it is overspecified.
		const fixed =
			HEAD +
			'task a "A" { effort 1d allocate r }\n' +
			'task b "B" { end 2026-02-02 effort 1d allocate r }\n';
		expect(run(fixed, add('b', 'a'))).toMatchObject({
			reason: 'conflicting-attribute',
			at: [{ from: fixed.indexOf('end 2026'), to: fixed.indexOf('end 2026') + 14 }],
		});
		expect(run(fixed.replace('02-02 effort 1d allocate r', '02-02'), add('b', 'a'))).toMatchObject({
			status: 'edit',
		});
		// del's new depends would be inherited by Item 1, which has it already.
		expect(run(unnamed, add('top.del', 'top.wp1'))).toMatchObject({
			reason: 'conflicting-attribute',
		});
		// Milestones walk both ways.
		const ms = HEAD + 'task a "A" { milestone }\ntask b "B" { milestone depends !a { onstart } }\n';
		expect(run(ms, add('a', 'b'))).toMatchObject({ reason: 'cycle' });
		const ok = HEAD + 'task a "A" { effort 1d allocate r }\ntask b "B" { effort 1d allocate r }\n';
		expect(run(ok, add('a', 'b'))).toMatchObject({ status: 'edit' });
	});

	it("refuses overriding the successor's own scheduling alap", () => {
		const at = (plan: string, text: string) => [
			{ from: plan.indexOf(text), to: plan.indexOf(text) + text.length },
		];
		// rule_depends sets ASAP and drops the clash silently: refused at the statement.
		const own =
			HEAD + 'task a "A" { duration 1d }\ntask b "B" {\n  scheduling alap\n  duration 1d\n}\n';
		expect(run(own, add('b', 'a'))).toMatchObject({
			status: 'refused',
			reason: 'conflicting-attribute',
			at: at(own, 'scheduling alap'),
		});
		// A container: its later children would inherit ASAP.
		const box =
			HEAD +
			'task a "A" { duration 1d }\ntask g "G" {\n  scheduling alap\n  end 2026-03-02\n' +
			'  task c "C" { duration 1d }\n}\n';
		expect(run(box, add('g', 'a'))).toMatchObject({
			reason: 'conflicting-attribute',
			at: at(box, 'scheduling alap'),
		});
		// A prefixed one counts in its scenario.
		const sc =
			'project p "P" 2026-01-05 +2m {\n  scenario plan "Plan" {\n    scenario d "D"\n  }\n}\n' +
			'task a "A" { duration 1d }\ntask b "B" {\n  d:scheduling alap\n  duration 1d\n}\n';
		expect(run(sc, add('b', 'a'))).toMatchObject({
			reason: 'conflicting-attribute',
			at: at(sc, 'd:scheduling alap'),
		});
		// Not when something later decides the direction, when ALAP comes from the parent or from
		// `end`, or when the alap is read after the item (TaskJuggler's documented behaviour).
		const started = own.replace('  duration 1d\n}', '  start 2026-02-02\n  duration 1d\n}');
		expect(run(started, add('b', 'a'))).toMatchObject({ status: 'edit' });
		const inherited =
			HEAD +
			'task a "A" { duration 1d }\ntask g "G" {\n  scheduling alap\n  end 2026-03-02\n' +
			'  task b "B" { duration 1d }\n}\n';
		expect(run(inherited, add('g.b', 'a'))).toMatchObject({ status: 'edit' });
		const ends = HEAD + 'task a "A" { duration 1d }\ntask b "B" { end 2026-03-02 }\n';
		expect(run(ends, add('b', 'a'))).toMatchObject({ status: 'edit' });
		const later =
			HEAD +
			'task a "A" { duration 1d }\ntask c "C" { duration 1d }\n' +
			'task b "B" {\n  depends !c\n  scheduling alap\n  duration 1d\n}\n';
		expect(after(later, add('b', 'a'))).toBe(later.replace('depends !c', 'depends !c, !a'));
	});

	it("refuses overspecifying a container's later children", () => {
		// g's new depends reaches c, which is ASAP with a sized fixed end (task_overspecified).
		const plan =
			HEAD +
			'task b "B" { duration 5d start 2026-01-05 }\ntask g "G" {\n' +
			'  task c "C" { duration 2d end 2026-03-02 scheduling asap }\n}\n';
		expect(run(plan, add('g', 'b'))).toMatchObject({
			status: 'refused',
			reason: 'conflicting-attribute',
			at: [{ from: plan.indexOf('end 2026-03-02'), to: plan.indexOf('end 2026-03-02') + 14 }],
		});
		// Without its own asap, c's end keeps it ALAP: accepted.
		expect(run(plan.replace(' scheduling asap', ''), add('g', 'b'))).toMatchObject({
			status: 'edit',
		});
		// A child that is already overspecified is not the edit's doing.
		const already = plan
			.replace('scheduling asap', 'scheduling asap depends !!b')
			.replace('task b "B"', 'task z "Z" { duration 1d }\ntask b "B"');
		expect(run(already, add('g', 'z'))).toMatchObject({ status: 'edit' });
	});

	it('refuses in a shared file and in macro bodies', () => {
		const shared = {
			'plan.tjp':
				HEAD +
				'task a "A"\ntask g1 "G1"\ntask g2 "G2"\n' +
				'include "t.tji" { taskprefix g1 }\ninclude "t.tji" { taskprefix g2 }\n',
			't.tji': 'task t "T"\n',
		};
		const s = setup(shared);
		expect(s.index.tasks.has('g1.t')).toBe(true);
		const r = addDepends(s.snap, s.index, 'g1.t', 'a', { confirmShared: true });
		expect(r).toMatchObject({ status: 'refused', reason: 'shared-declaration' });
		expect(r.status === 'refused' && [...(r.affects ?? [])].sort()).toEqual(['g1.t', 'g2.t']);
		// A list whose last item is a macro call: the new item would join its expansion.
		const macro = HEAD + 'macro d [a]\ntask a "A"\ntask c "C"\ntask b "B" {\n  depends ${d}\n}\n';
		expect(run(macro, add('b', 'c'))).toMatchObject({ status: 'refused' });
		// A task whose id is a macro is not a target.
		const id = HEAD + 'macro i [x]\ntask a "A"\ntask ${i} "X"\n';
		expect(run(id, add('x', 'a'))).toMatchObject({ reason: 'unknown-target' });
	});

	it('resolves relative and scenario-prefixed references on the relative-ids layout', () => {
		const plan =
			HEAD +
			'task top "Top" {\n  task s1 "S1" { effort 1d allocate r }\n  task grp "Grp" {\n' +
			'    task g1 "G1" {\n      effort 1d\n      depends !!s1\n      allocate r\n    }\n' +
			'    task g2 "G2" { effort 1d allocate r }\n  }\n}\n';
		expect(run(plan, add('top.grp.g1', 'top.s1'))).toMatchObject({ reason: 'already-linked' });
		expect(after(plan, add('top.grp.g1', 'top.grp.g2'))).toContain('depends !!s1, !g2\n');
	});
});

describe('removeDepends', () => {
	it('removes one item with its body and comma, or the statement', () => {
		const plan =
			HEAD + 'task a "A"\ntask c "C"\ntask b "B" {\n  depends !c, !a { gaplength 1d }\n}\n';
		expect(after(plan, remove('b', 'a'))).toBe(
			HEAD + 'task a "A"\ntask c "C"\ntask b "B" {\n  depends !c\n}\n',
		);
		expect(after(plan, remove('b', 'c'))).toBe(
			HEAD + 'task a "A"\ntask c "C"\ntask b "B" {\n  depends !a { gaplength 1d }\n}\n',
		);
		const only = HEAD + 'task a "A"\ntask b "B" {\n  depends !a # why\n  effort 1d\n}\n';
		expect(after(only, remove('b', 'a'))).toBe(
			HEAD + 'task a "A"\ntask b "B" {\n  # why\n  effort 1d\n}\n',
		);
	});

	it('removes precedes items and prefixed items too', () => {
		const plan =
			'project p "P" 2026-01-05 +2m {\n  scenario plan "Plan" {\n    scenario d "D"\n  }\n}\n' +
			'task a "A" {\n  precedes !b\n}\ntask b "B" {\n  d:depends !a\n  effort 1d\n}\n';
		expect(after(plan, remove('b', 'a'))).toBe(
			'project p "P" 2026-01-05 +2m {\n  scenario plan "Plan" {\n    scenario d "D"\n  }\n}\n' +
				'task a "A" {\n}\ntask b "B" {\n  effort 1d\n}\n',
		);
	});

	it('refuses a link that exists only in another scenario', () => {
		const plan =
			'project p "P" 2026-01-05 +2m {\n  scenario plan "Plan" {\n    scenario alt "Alt"\n  }\n}\n' +
			'task b "B" { duration 1d }\ntask a "A" {\n  alt:depends !b\n  duration 1d\n}\n';
		const item = plan.indexOf('!b');
		expect(run(plan, remove('a', 'b'))).toEqual({
			status: 'refused',
			reason: 'conflicting-attribute',
			at: [{ file: 'plan.tjp', from: item, to: item + 2 }],
		});
		// The top scenario's prefix is the same as none.
		const top = plan.replace('alt:depends', 'plan:depends');
		expect(after(top, remove('a', 'b'))).toBe(top.replace('  plan:depends !b\n', ''));
	});

	it('is not-present, or inherited when only a parent has it', () => {
		const plan = HEAD + 'task a "A"\ntask g "G" {\n  depends a\n  task x "X"\n}\n';
		expect(run(plan, remove('g.x', 'a'))).toMatchObject({ status: 'refused', reason: 'inherited' });
		expect(run(plan, remove('a', 'g'))).toEqual({ status: 'noop', reason: 'not-present' });
		const s = setup(plan);
		expect(removeDepends(s.snap, s.index, 'zz', 'a')).toMatchObject({ reason: 'unknown-target' });
	});

	it('works across files and keeps the inverse exact', () => {
		const files = {
			'plan.tjp': HEAD + 'task a "A"\ninclude "b.tji"\n',
			'b.tji': 'task b "B" {\r\n  depends a\r\n  effort 1d\r\n}\r\n',
		};
		const ws = createWorkspace({ entry: 'plan.tjp', files });
		const snap = ws.snapshot();
		const r = applyIntent(snap, buildIndex(snap), remove('b', 'a'));
		const text = textsAfter(snap, r);
		expect(text['b.tji']).toBe('task b "B" {\r\n  effort 1d\r\n}\r\n');
		if (r.status !== 'edit') throw new Error('expected an edit');
		const base = snap.files.get('b.tji')?.text;
		const cs = r.edit.changes['b.tji'];
		const inv = r.edit.inverse['b.tji'];
		expect(base && cs && inv && inv.apply(cs.apply(base)).toString()).toBe(files['b.tji']);
	});
});
