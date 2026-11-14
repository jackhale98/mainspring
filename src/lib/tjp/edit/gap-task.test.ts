// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { labelOf } from '../../workspace/history-steps';
import { buildIndex } from '../index';
import { applyIntent } from './apply';
import { setup, textsAfter } from './testing';
import type { EditResult, IntentOf } from './types';

const HEAD = 'project p "P" 2026-01-05 +3m\n';

const PLAN = `${HEAD}
task design "Design" {
  length 3d
}
task build "Build" {
  depends !design { gaplength 5d }
  length 4d
}
`;

const gap = (task: string, target: string, name = 'Wait', id?: string): IntentOf<'gapToTask'> => ({
	type: 'gapToTask',
	task,
	target,
	name,
	...(id === undefined ? {} : { id }),
});

function run(text: string, intent: IntentOf<'gapToTask'>) {
	const s = setup(text);
	const r = applyIntent(s.snap, s.index, intent);
	return { r, text: r.status === 'edit' ? textsAfter(s.snap, r)['plan.tjp'] : undefined };
}

const status = (r: EditResult): string =>
	r.status === 'edit' ? 'edit' : `${r.status}:${r.reason}`;

describe('gapToTask', () => {
	it('turns a gaplength into a waiting task with that length', () => {
		// The new block follows addTask's layout: a blank line before it, as before its sibling.
		const r = run(PLAN, gap('build', 'design', 'Wait for review'));
		expect(r.text).toBe(`${HEAD}
task design "Design" {
  length 3d
}

task wait_for_review "Wait for review" {
  length 5d
  depends !design
}
task build "Build" {
  depends !wait_for_review
  length 4d
}
`);
		// One edit, the header selected, every change in a declared target.
		expect(r.r.status).toBe('edit');
		if (r.r.status !== 'edit') return;
		const sel = r.r.edit.select;
		expect(sel && r.text?.slice(sel.from, sel.to)).toBe('task wait_for_review "Wait for review"');
	});

	it('turns a gapduration into a duration, and keeps the rest of the body', () => {
		const text = `${HEAD}
task a "A" { length 1d }
task b "B" {
  depends !a {
    # calendar days
    gapduration 2w
  }, !c
  length 1d
}
task c "C" { length 1d }
`;
		expect(run(text, gap('b', 'a', 'Cure', 'cure')).text).toBe(`${HEAD}
task a "A" { length 1d }

task cure "Cure" {
  duration 2w
  depends !a
}
task b "B" {
  depends !cure {
    # calendar days
  }, !c
  length 1d
}
task c "C" { length 1d }
`);
	});

	it('writes references from the new task, and works on containers and supplements', () => {
		const text = `${HEAD}
task a "A" {
  task x "X" { length 1d }
}
task b "B" {
  task y "Y" { length 1d }
  task z "Z" { length 1d }
}
supplement task b.z {
  depends a.x { gaplength 2d }
}
`;
		expect(run(text, gap('b.z', 'a.x')).text).toBe(`${HEAD}
task a "A" {
  task x "X" { length 1d }
}
task b "B" {
  task y "Y" { length 1d }
  task wait "Wait" {
    length 2d
    depends a.x
  }
  task z "Z" { length 1d }
}
supplement task b.z {
  depends !wait
}
`);
		const container = `${HEAD}
task a "A" { length 1d }
task b "B" {
  depends !a { gaplength 1w }
  task c "C" { length 1d }
}
`;
		expect(run(container, gap('b', 'a', 'Settle')).text).toContain(
			'task settle "Settle" {\n  length 1w\n  depends !a\n}\ntask b "B" {\n  depends !settle\n',
		);
	});

	it('is a no-op without a gap', () => {
		const text = PLAN.replace(' { gaplength 5d }', '');
		expect(status(run(text, gap('build', 'design')).r)).toBe('noop:not-present');
	});

	it('refuses items it cannot convert', () => {
		const onend = PLAN.replace('{ gaplength 5d }', '{ gaplength 5d onstart }');
		expect(status(run(onend, gap('build', 'design')).r)).toBe('refused:unsupported-form');
		const both = PLAN.replace('{ gaplength 5d }', '{ gaplength 5d gapduration 1d }');
		expect(status(run(both, gap('build', 'design')).r)).toBe('refused:unsupported-form');
		const twice = PLAN.replace('{ gaplength 5d }', '{ gaplength 5d gaplength 2d }');
		expect(status(run(twice, gap('build', 'design')).r)).toBe('refused:unsupported-form');
		// A link made by the target's `precedes`: the successor has no item to point at the task.
		const precedes = `${HEAD}
task design "Design" {
  length 3d
  precedes !build { gaplength 5d }
}
task build "Build" { length 4d }
`;
		expect(status(run(precedes, gap('build', 'design')).r)).toBe('refused:unsupported-form');
		const scoped = `project p "P" 2026-01-05 +3m {
  scenario plan "Plan" { scenario late "Late" }
}
task design "Design" { length 3d }
task build "Build" {
  late:depends !design { gaplength 5d }
  length 4d
}
`;
		expect(status(run(scoped, gap('build', 'design')).r)).toBe('refused:unsupported-form');
	});

	it('refuses an inherited link, unknown tasks and macro text', () => {
		const inherited = `${HEAD}
task a "A" { length 1d }
task b "B" {
  depends !a { gaplength 2d }
  task c "C" { length 1d }
}
`;
		expect(status(run(inherited, gap('b.c', 'a')).r)).toBe('refused:inherited');
		expect(status(run(PLAN, gap('build', 'nope')).r)).toBe('refused:unknown-target');
		expect(status(run(PLAN, gap('design', 'build')).r)).toBe('refused:unknown-target');
		const written = `${HEAD}macro g [gaplength 5d]
task design "Design" { length 3d }
task build "Build" {
  depends !design { \${g} }
  length 4d
}
`;
		expect(run(written, gap('build', 'design')).r).toMatchObject({
			status: 'refused',
			reason: 'text-only',
			textOnly: 'macro-call',
		});
		const body = `${HEAD}macro d [depends !design]
task design "Design" { length 3d }
task build "Build" {
  depends !design { gaplength 1d }
  \${d}
  length 4d
}
`;
		expect(status(run(body, gap('build', 'design')).r)).toBe('refused:macro-in-body');
		const expanded = `${HEAD}macro t [task build "Build" { depends !design { gaplength 1d } length 1d }]
task design "Design" { length 3d }
\${t}
`;
		// Declared only by the macro: unknown without the engine's ids, text-only with them.
		expect(status(run(expanded, gap('build', 'design')).r)).toBe('refused:unknown-target');
		const s = setup(expanded);
		const hints = {
			tasks: [{ id: 'build', parent: null, file: 'plan.tjp', line: 4 }],
			resources: [],
		};
		const index = buildIndex(s.snap, hints, { cache: null });
		expect(index.tasks.get('build')?.expandedOnly).toBe(true);
		expect(applyIntent(s.snap, index, gap('build', 'design'))).toMatchObject({
			status: 'refused',
			reason: 'text-only',
		});
	});

	it("refuses a new task that would collide or inherit the parent's people", () => {
		expect(status(run(PLAN, gap('build', 'design', 'Design', 'design')).r)).toBe(
			'refused:id-collision',
		);
		expect(status(run(PLAN, gap('build', 'design', 'W', '1bad')).r)).toBe('refused:invalid-value');
		expect(status(run(PLAN, gap('build', 'design', 'W "quoted"\n')).r)).toBe('refused:unsafe-text');
		// Without an id the name gives a fresh one.
		expect(run(PLAN, gap('build', 'design', 'Design')).text).toContain('task design_2 "Design"');
		const staffed = `${HEAD}resource dev "Dev"
task phase "Phase" {
  allocate dev
  task a "A" { effort 1d }
  task b "B" {
    depends !a { gaplength 2d }
    effort 1d
  }
}
`;
		const r = run(staffed, gap('phase.b', 'phase.a')).r;
		expect(status(r)).toBe('refused:conflicting-attribute');
		expect(r.status === 'refused' && staffed.slice(r.at[0]?.from, r.at[0]?.to)).toBe(
			'allocate dev',
		);
	});

	it('gives an index that reads the waiting task and the links', () => {
		const s = setup(PLAN);
		const r = applyIntent(s.snap, s.index, gap('build', 'design', 'Wait', 'wait'));
		const after = textsAfter(s.snap, r);
		const index = buildIndex(setup(after['plan.tjp'] ?? '').snap, undefined, { cache: null });
		const links = index.dependencies.map((d) => `${d.succ}<-${d.pred}`);
		expect(links.sort()).toEqual(['build<-wait', 'wait<-design']);
		expect(index.taskRoots).toEqual(['design', 'wait', 'build']);
		expect(index.dependencies.every((d) => d.body === null)).toBe(true);
	});

	it('has a history label', () => {
		expect(labelOf(gap('build', 'design'))).toBe('convert gap to task');
	});
});
