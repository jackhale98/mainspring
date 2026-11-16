// SPDX-License-Identifier: GPL-2.0-or-later
// A rename that sets the id from the name schedules the same (polish item 15, phase-1.md 9.3 P4):
// the plan before and after is scheduled by the wasm engine in Node, and the results are equal
// apart from the task's id and name (and source lines and timings), on a hand-written plan with
// people and links and on the generated plans of task-rename-id-testing.ts. Needs the built
// engine (npm run build:engine); skipped without it, except with TJP_EDIT_ENGINE=1, where a
// missing engine fails.
import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import type { NodeEngine } from '../../../engine/runtime';
import type { ScheduleResult } from '../../../engine/protocol';
import { bootNodeEngine } from '../../../../engine/golden/run-wasm.mjs';
import { ROOT } from '../../../../tests/grammar/corpus';
import { applyIntent } from './apply';
import { followingId } from './task-rename-id';
import { FIRST_NAME, genPlan } from './task-rename-id-testing';
import { setup, textsAfter } from './testing';

const ENGINE = path.join(ROOT, 'public/engine/manifest.json');
const REQUIRED = process.env['TJP_EDIT_ENGINE'] === '1';
const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };

let engine: NodeEngine;
let revision = 0;

function schedule(text: string): ScheduleResult {
	return engine.schedule({
		files: { 'plan.tjp': text },
		entry: 'plan.tjp',
		revision: ++revision,
		options: { now: '2026-01-05T00:00:00Z' },
	});
}

/** The result without names, source lines, message texts and timings, with `from` read as `to`. */
function normalized(r: ScheduleResult, from: string, to: string): string {
	const { revision: _r, timings: _t, ...rest } = r;
	const copy = structuredClone(rest);
	for (const t of copy.tasks) {
		t.name = '';
		if (t.source) t.source = { ...t.source, line: 0, column: 0 };
	}
	const messages = copy.messages.map((m) => ({ ...m, line: 0, column: 0, text: '' }));
	return JSON.stringify({ ...copy, messages }).replaceAll(`"${from}"`, `"${to}"`);
}

/** Renames as the inspector does; the plan before and after, and the ids, or null when it stays. */
function rename(text: string, task: string, name: string): { after: string; next: string } | null {
	const s = setup(text);
	const id = followingId(s.index, task, name, FIRST_NAME);
	if (id === null) return null;
	const r = applyIntent(s.snap, s.index, { type: 'renameTask', task, name, id });
	const parent = s.index.tasks.get(task)?.parent ?? null;
	return {
		after: textsAfter(s.snap, r)['plan.tjp'] ?? '',
		next: parent === null ? id : `${parent}.${id}`,
	};
}

describe.skipIf(!REQUIRED && !fs.existsSync(ENGINE))('the id follows the name: schedules', () => {
	beforeAll(async () => {
		engine = (await bootNodeEngine({ log: () => {} })) as NodeEngine;
	}, 120_000);

	it('schedules the same with people, links and a container', () => {
		const text =
			'project p "P" 2026-01-05 +3m\nresource dev "Dev"\n' +
			'task a "A" {\n  effort 3d\n  allocate dev\n}\n' +
			'task g "G" {\n  task new_task "New task" {\n    effort 2d\n    allocate dev\n    depends !!a\n  }\n' +
			'  task c "C" {\n    length 1d\n  }\n}\n' +
			'task new_task_2 "New task" {\n  duration 4d\n  depends g.c\n}\n';
		const before = schedule(text);
		expect(before.ok).toBe(true);
		for (const [task, want] of [
			['g.new_task', 'g.write_specs'],
			['new_task_2', 'review'],
		] as const) {
			const r = rename(text, task, want === 'review' ? 'Review' : 'Write specs');
			expect(r?.next).toBe(want);
			if (!r) continue;
			const after = schedule(r.after);
			expect(after.ok).toBe(true);
			expect(after.tasks.map((t) => t.id)).toContain(want);
			expect(normalized(after, '', '')).toBe(normalized(before, task, want));
		}
	});

	it('schedules the same on generated plans', () => {
		let checked = 0;
		fc.assert(
			fc.property(genPlan, (g) => {
				const r = rename(g.text, g.task, g.name);
				if (!r) return;
				checked++;
				const before = schedule(g.text);
				const after = schedule(r.after);
				expect(after.ok).toBe(before.ok);
				expect(normalized(after, '', '')).toBe(normalized(before, g.task, r.next));
			}),
			{ numRuns: 40, ...SEED },
		);
		expect(checked).toBeGreaterThan(3);
	}, 120_000);
});
