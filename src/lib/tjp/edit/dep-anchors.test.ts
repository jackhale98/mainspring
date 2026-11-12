// SPDX-License-Identifier: GPL-2.0-or-later
// The anchor rule (dep-anchors.ts `isUnanchored`) and the intents that share it. Every plan was
// checked in native tj3 3.8.4: the refused edits would give `not_scheduled` (the fidelity suite's
// generated seed 1573606886 is the first case), the accepted ones schedule.
import { describe, expect, it } from 'vitest';
import { applyIntent } from './apply';
import { stateReader } from './dep-graph';
import { anchorsOf, isUnanchored, namedBy } from './dep-anchors';
import { setup } from './testing';
import { corpusPlans, load } from './testing-plans';
import type { EditIntent, EditResult } from './types';

const H = 'project p "P" 2026-01-05 +3m\nresource r "R"\ntask x "X" { start 2026-01-10 }\n';

function run(body: string, intent: EditIntent): EditResult {
	const s = setup(H + body);
	return applyIntent(s.snap, s.index, intent);
}

function loose(body: string, task: string): boolean {
	const s = setup(H + body);
	const st = stateReader(s.snap, s.index)(task).state;
	return isUnanchored(anchorsOf(st), namedBy(s.snap, s.index, task));
}

const CHAIN = 'task a "A" { effort 1d allocate r precedes b }\n';

describe('isUnanchored', () => {
	it('needs a start or a depends for an ASAP task a precedes names', () => {
		expect(loose(CHAIN + 'task b "B" { effort 1d allocate r }\n', 'b')).toBe(true);
		expect(loose(CHAIN + 'task b "B" { effort 1d allocate r start 2026-02-02 }\n', 'b')).toBe(
			false,
		);
		expect(loose(CHAIN + 'task b "B" { effort 1d allocate r depends x }\n', 'b')).toBe(false);
		// ALAP through its own end: computed backwards, fine.
		expect(loose(CHAIN + 'task b "B" { effort 1d allocate r end 2026-02-20 }\n', 'b')).toBe(false);
		// A parent's start is not inherited (native c14); a parent's depends is (c1).
		const parentStart =
			'task a "A" { effort 1d allocate r precedes g.b }\n' +
			'task g "G" { start 2026-02-02\n  task b "B" { effort 1d allocate r }\n}\n';
		expect(loose(parentStart, 'g.b')).toBe(true);
		expect(loose(parentStart.replace('start 2026-02-02', 'depends x'), 'g.b')).toBe(false);
	});

	it('needs an end or a precedes for an ALAP task a depends names (the mirror)', () => {
		const dep = 'task b "B" { effort 1d allocate r depends a }\n';
		expect(loose('task a "A" { effort 1d allocate r scheduling alap }\n' + dep, 'a')).toBe(true);
		expect(
			loose('task a "A" { effort 1d allocate r scheduling alap end 2026-02-02 }\n' + dep, 'a'),
		).toBe(false);
		expect(loose('task a "A" { effort 1d allocate r }\n' + dep, 'a')).toBe(false);
	});
});

describe('intents that would leave a chain waiting on itself', () => {
	it('refuses removeAttr start of the task a precedes names (fidelity seed 1573606886)', () => {
		const plan = CHAIN + 'task b "B" { effort 1d allocate r start 2026-02-02 }\n';
		expect(run(plan, { type: 'removeAttr', task: 'b', attr: 'start' })).toMatchObject({
			reason: 'conflicting-attribute',
		});
		// With a depends left it stays anchored.
		const dep = CHAIN + 'task b "B" { effort 1d allocate r start 2026-02-02 depends x }\n';
		expect(run(dep, { type: 'removeAttr', task: 'b', attr: 'start' })).toMatchObject({
			status: 'edit',
		});
	});

	it('refuses removing the end of an ALAP task a depends names, not of one that turns ASAP', () => {
		const alap =
			'task a "A" { effort 1d allocate r scheduling alap end 2026-02-02 }\n' +
			'task b "B" { effort 1d allocate r depends a }\n';
		expect(run(alap, { type: 'removeAttr', task: 'a', attr: 'end' })).toMatchObject({
			reason: 'conflicting-attribute',
		});
		// Without `scheduling alap` the end was its only ALAP setting: it becomes ASAP (native m2).
		const turns = alap.replace(' scheduling alap', '');
		expect(run(turns, { type: 'removeAttr', task: 'a', attr: 'end' })).toMatchObject({
			status: 'edit',
		});
	});

	it('refuses removeDepends and addDepends that leave a task unanchored', () => {
		const plan = CHAIN + 'task b "B" { effort 1d allocate r depends x }\n';
		expect(run(plan, { type: 'removeDepends', task: 'b', target: 'x' })).toMatchObject({
			reason: 'conflicting-attribute',
		});
		const alap =
			'task a "A" { effort 1d allocate r scheduling alap }\ntask b "B" { effort 1d allocate r }\n';
		expect(run(alap, { type: 'addDepends', task: 'b', target: 'a' })).toMatchObject({
			reason: 'conflicting-attribute',
		});
	});

	it('refuses deleting or moving away the only anchor of a task a precedes names', () => {
		const plan = CHAIN + 'task b "B" { effort 1d allocate r depends x }\n';
		expect(run(plan, { type: 'deleteTask', task: 'x' })).toMatchObject({
			reason: 'conflicting-attribute',
		});
		const inherited =
			'task a "A" { effort 1d allocate r precedes g.b }\n' +
			'task g "G" { depends x\n  task b "B" { effort 1d allocate r }\n  task c "C" { effort 1d allocate r }\n}\n';
		expect(run(inherited, { type: 'moveTask', task: 'g.b', parent: null, index: 0 })).toMatchObject(
			{ reason: 'conflicting-attribute' },
		);
	});
});

describe('items aimed at the other end leave the chain anchored (native N15b, N13b, syn-07)', () => {
	const H2 = 'project p "P" 2026-01-05 - 2026-06-27\nresource r "R"\nresource s "S"\n';
	const run2 = (body: string, intent: EditIntent): EditResult => {
		const st = setup(H2 + body);
		return applyIntent(st.snap, st.index, intent);
	};

	it('allows removing the start of a task a `precedes … { onend }` names (N15b)', () => {
		const plan =
			'task a "A" { effort 1d allocate r precedes b { onend } }\n' +
			'task b "B" { effort 2d allocate s start 2026-01-12 }\n';
		expect(run2(plan, { type: 'removeAttr', task: 'b', attr: 'start' })).toMatchObject({
			status: 'edit',
		});
	});

	it('allows removing the end of an ALAP task a `depends … { onstart }` names (N13b)', () => {
		const plan =
			'task a "A" { effort 1d allocate r depends b { onstart } }\n' +
			'task b "B" { effort 2d allocate s scheduling alap end 2026-03-02 }\n';
		expect(run2(plan, { type: 'removeAttr', task: 'b', attr: 'end' })).toMatchObject({
			status: 'edit',
		});
	});

	it('allows removeDepends chain.g -> chain.a in syn-07 (chain.h precedes it { onend })', () => {
		const p = corpusPlans().find((c) => c.name.endsWith('07-deps-onstart-onend'));
		if (!p) throw new Error('no syn-07');
		const c = load(p.name, p.plan);
		const r = applyIntent(c.snap, c.index, {
			type: 'removeDepends',
			task: 'chain.g',
			target: 'chain.a',
		});
		expect(r).toMatchObject({ status: 'edit' });
	});
});
