// SPDX-License-Identifier: GPL-2.0-or-later
// setAttr of flags and responsible (task-attrs-ids.ts; phase-1.md section 15, T11a entry): id
// checks, the resourceprefix, accumulation over own statements, supplements and ancestors, and
// the macro rule. Results marked as checked natively were run through tj3 3.8.4.
import { describe, expect, it } from 'vitest';
import { applyIntent } from './apply';
import { setup, textsAfter, type Setup } from './testing';
import type { EditIntent, EditResult, TaskAttr } from './types';

const HEAD = 'project p "P" 2026-01-05 +2m\nresource r "R"\nresource q "Q"\nflags hot, cold\n';

function run(s: Setup, intent: EditIntent): EditResult {
	return applyIntent(s.snap, s.index, intent);
}

/** The entry file's text after an intent (throws unless it is an edit). */
function after(src: string, intent: EditIntent): string {
	const s = setup(src);
	return textsAfter(s.snap, run(s, intent))['plan.tjp'] ?? '';
}

/** A setAttr intent; `value` is unchecked so tests can pass wrong types. */
const set = (task: string, attr: TaskAttr, value: unknown): EditIntent =>
	({ type: 'setAttr', task, attr, value }) as EditIntent;

describe('setAttr flags and responsible', () => {
	const plan = HEAD + 'task a "A" {\n  flags hot\n  effort 1d\n}\n';

	it('rewrites the id list or inserts one', () => {
		expect(after(plan, set('a', 'flags', ['hot', 'cold']))).toBe(
			plan.replace('  flags hot', '  flags hot, cold'),
		);
		expect(after(plan, set('a', 'responsible', ['r', 'q']))).toBe(
			plan.replace('  effort', '  responsible r, q\n  effort'),
		);
		const s = setup(plan);
		expect(run(s, set('a', 'flags', ['hot']))).toMatchObject({ reason: 'already-set' });
	});

	it('refuses undeclared flags and unknown resources; later resources are fine', () => {
		const src = plan + 'resource late "Late"\n';
		const s = setup(src);
		expect(run(s, set('a', 'flags', ['warm']))).toMatchObject({ reason: 'undeclared-flag' });
		expect(run(s, set('a', 'responsible', ['zz']))).toMatchObject({ reason: 'invalid-value' });
		expect(run(s, set('a', 'flags', []))).toMatchObject({ reason: 'invalid-value' });
		// TaskJuggler resolves responsible ids after parsing (checked natively).
		expect(textsAfter(s.snap, run(s, set('a', 'responsible', ['late'])))['plan.tjp']).toBe(
			src.replace('  effort', '  responsible late\n  effort'),
		);
	});

	it('applies the resourceprefix to written ids', () => {
		// rule_undefResourceId reads `responsible r` under `resourceprefix g` as g.r, which no
		// resource can be (ids are global; natively "g.r is not a defined resource").
		const s = setup({
			'plan.tjp':
				HEAD +
				'resource g "G"\ntask top "T"\ninclude "t.tji" { resourceprefix g taskprefix top }\n',
			't.tji': 'task x "X"\n',
		});
		expect(run(s, set('top.x', 'responsible', ['r']))).toMatchObject({ reason: 'invalid-value' });
	});

	// Both lists accumulate over own statements, supplements and ancestors (checked natively:
	// the reports read "warm, hot" and "Q").
	const tree =
		'project p "P" 2026-01-05 +2m\nresource r "R"\nresource q "Q"\nflags hot, cold, warm\n' +
		'task par "Par" {\n  flags warm\n  responsible q\n  task a "A" {\n    flags hot\n' +
		'    responsible r\n    effort 1d\n    allocate r\n    flags cold\n  }\n}\n' +
		'supplement task par.a {\n  flags warm\n}\n';

	it('makes the own contribution equal the value', () => {
		expect(after(tree, set('par.a', 'flags', ['warm', 'hot']))).toBe(
			tree
				.replace('    flags hot\n', '')
				.replace('    flags cold\n', '')
				.replace('{\n  flags warm\n}', '{\n  flags warm, hot\n}'),
		);
		expect(after(tree, set('par.a', 'responsible', ['q']))).toBe(
			tree.replace('responsible r', 'responsible q'),
		);
		const s = setup(tree);
		expect(run(s, set('par.a', 'flags', ['cold', 'warm', 'hot']))).toEqual({
			status: 'noop',
			reason: 'already-set',
		});
	});

	it('refuses dropping an inherited id, at the ancestor', () => {
		const s = setup(tree);
		const r = run(s, set('par.a', 'flags', ['hot']));
		expect(r).toMatchObject({ status: 'refused', reason: 'inherited' });
		const at = r.status === 'refused' ? r.at[0] : undefined;
		expect(at && tree.slice(at.from, at.to)).toBe('flags warm');
		expect(run(s, set('par.a', 'responsible', ['r']))).toMatchObject({ reason: 'inherited' });
	});

	it('checks the macro rule first', () => {
		const src = 'macro m [ flags cold ]\n' + plan.replace('  flags hot\n', '  flags hot\n  ${m}\n');
		const s = setup(src);
		expect(run(s, set('a', 'flags', ['hot']))).toMatchObject({ reason: 'macro-in-body' });
		expect(run(s, set('a', 'responsible', ['r'])).status).toBe('edit');
	});
});
