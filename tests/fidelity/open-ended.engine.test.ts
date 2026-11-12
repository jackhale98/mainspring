// SPDX-License-Identifier: GPL-2.0-or-later
// Documents behaviour the fidelity suite relies on (phase-1.md 15.19, 15.24, 25). A leaf with no size, a
// start and an allocation is valid TaskJuggler: open-ended allocated work that runs from its start to the
// project end. The edit API does not refuse `setAttr milestone=false` on a milestone that has such an
// allocation, since what that costs other tasks (a sibling that needs the same resource no longer fits,
// `sched_runaway`) depends on the schedule, not on the text. The generator therefore only draws it where
// the leaf has no allocation, so a generated plan stays valid by construction and nothing is tolerated.
// Needs the built engine; runs in `npm run test:fidelity` only.
import { describe, expect, it } from 'vitest';
import { bootNodeEngine } from '../../engine/golden/run-wasm.mjs';
import { applyIntent } from '../../src/lib/tjp/edit/apply';
import { buildIndex } from '../../src/lib/tjp/index';
import { createWorkspace } from '../../src/lib/workspace/workspace';

const HEAD = 'project p "P" 2026-01-05 +3m\nresource ana "Ana"\nresource bob "Bob"\n';
const FIRST = 'task data "Data" {\n  effort 1d\n  allocate bob\n}\n';
/** `ship` is a milestone after `data`; its parent allocates `ana`, which `setup` shares. */
const PLAN = (shipBody: string, setup: string): string =>
	`${HEAD}${FIRST}task qa "Qa" {\n  allocate ana\n  task ship "Ship" {\n${shipBody}    depends data\n  }\n${setup}}\n`;
// `setup` competes for `ana` from the same moment, with a lower priority than `ship`'s default.
const SHARED = '  task setup "Setup" {\n    effort 1d\n    depends data\n    priority 100\n  }\n';

describe('open-ended allocated work', () => {
	it('is accepted by setAttr milestone=false, and its cost depends on the schedule', async () => {
		const engine = await bootNodeEngine({ log: () => {} });
		const run = (files: Record<string, string>, revision: number) =>
			engine.schedule({
				files,
				entry: 'plan.tjp',
				revision,
				options: { now: '2026-01-05T09:00:00Z' },
			});
		const errors = (r: { messages: Array<{ level: string; id: string }> }): string[] =>
			r.messages.filter((m) => m.level === 'error' || m.level === 'fatal').map((m) => m.id);

		const milestone = PLAN('    milestone\n', SHARED);
		expect(run({ 'plan.tjp': milestone }, 1).ok).toBe(true);
		const snap = createWorkspace({
			entry: 'plan.tjp',
			files: { 'plan.tjp': milestone },
		}).snapshot();
		const r = applyIntent(snap, buildIndex(snap, undefined, { cache: null }), {
			type: 'setAttr',
			task: 'qa.ship',
			attr: 'milestone',
			value: false,
		});
		expect(r.status, 'a valid edit: the API does not foresee schedule-dependent contention').toBe(
			'edit',
		);
		if (r.status !== 'edit') return;
		const text = snap.files.get('plan.tjp')?.text;
		const after = text ? (r.edit.changes['plan.tjp']?.apply(text).toString() ?? '') : '';

		// `ship` now runs from the end of `data` to the project end, booked on `ana`, so `setup`, which
		// inherits `ana` and has the lower priority, cannot get any of it.
		const bad = run({ 'plan.tjp': after }, 2);
		expect(errors(bad)).toEqual(['sched_runaway']);
		const ship = bad.tasks.find((t: { id: string }) => t.id === 'qa.ship')?.scenarios['plan'];
		expect(ship?.allocated).toEqual(['ana']);
		expect(ship?.end).toBe(
			Math.round(
				(Date.parse(bad.project?.end ?? '') - Date.parse(bad.project?.start ?? '')) / 60000,
			),
		);

		// With a size again the same plan schedules.
		expect(run({ 'plan.tjp': PLAN('    length 1d\n', SHARED) }, 4).ok).toBe(true);
	}, 120_000);

	it('does not hurt a sibling that has another resource', async () => {
		const engine = await bootNodeEngine({ log: () => {} });
		const plan = `${HEAD}${FIRST}task qa "Qa" {\n  task ship "Ship" {\n    allocate ana\n    depends data\n  }\n  task setup "Setup" {\n    effort 1d\n    depends data\n    priority 100\n    allocate bob\n  }\n}\n`;
		const r = engine.schedule({
			files: { 'plan.tjp': plan },
			entry: 'plan.tjp',
			revision: 5,
			options: { now: '2026-01-05T09:00:00Z' },
		});
		expect(r.ok).toBe(true);
	}, 120_000);
});
