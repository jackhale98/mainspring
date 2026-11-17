// SPDX-License-Identifier: GPL-2.0-or-later
// The working-hours editor's reading and writing against the wasm engine (phase-3.md 9.6, W8),
// booted in Node by engine/golden/run-wasm.mjs. Needs the built engine (npm run build:engine);
// skipped without it unless TJP_EDIT_ENGINE=1.
//
// - `weekOf` says what the engine's own working time is: for a project, a group and the people in
//   it (with and without statements of their own), the hours of a week as the text says them
//   expand to the `workingTime` (v3) the engine gives each person for the first two weeks.
// - `changeDay` through the edit API gives text the engine schedules with no error, and the
//   person's working time then has exactly that day changed.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootNodeEngine } from '../../../engine/golden/run-wasm.mjs';
import { ROOT } from '../../../tests/grammar/corpus';
import type { Minutes, ScheduleResult } from '../../engine/protocol';
import { applyIntent } from '../tjp/edit/apply';
import { setup, textsAfter } from '../tjp/edit/testing';
import type { SymbolIndex } from '../tjp/index';
import { TJ_WEEKDAYS } from '../tjp/values';
import { changeDay, weekOf } from './hours';

const ENGINE = path.join(ROOT, 'public/engine/manifest.json');
const REQUIRED = process.env['TJP_EDIT_ENGINE'] === '1';
let revision = 0;

const PLAN = `project p "P" 2026-03-02 +4w {
  timezone "UTC"
  workinghours mon - thu 8:00 - 12:00, 13:00 - 16:00
  workinghours fri off
}
resource team "Team" {
  workinghours sat 10:00 - 12:00
  resource a "A" {
    workinghours mon off
  }
  resource b "B"
}
resource c "C" {
  workinghours tue 9:00 - 10:00
}
task t "T" { effort 1d  allocate c }
`;

/** The frame starts on a Monday at midnight UTC: the expansion of a week table over two weeks. */
function expand(index: SymbolIndex, id: string): Array<[Minutes, Minutes]> {
	const w = weekOf(index, { kind: 'resource', resource: id });
	if (w.kind !== 'week') throw new Error('not a week');
	const out: Array<[Minutes, Minutes]> = [];
	for (let day = 0; day < 14; day++) {
		const name = TJ_WEEKDAYS[(day + 1) % 7];
		const ranges = w.days.find((d) => d.day === name)?.ranges ?? [];
		for (const [s, e] of ranges) {
			const last = out.at(-1);
			if (last && last[1] === day * 1440 + s) last[1] = day * 1440 + e;
			else out.push([day * 1440 + s, day * 1440 + e]);
		}
	}
	return out;
}

/** The engine's working time of a person (the project's when it says null), the first two weeks. */
function engineTime(r: ScheduleResult, id: string): Array<[Minutes, Minutes]> {
	const scenario = r.project?.scenarios[0]?.id ?? '';
	const own = r.resources.find((x) => x.id === id)?.scenarios[scenario]?.workingTime;
	const list = own ?? r.project?.workingTime ?? [];
	return list.filter(([, e]) => e <= 14 * 1440).map(([s, e]) => [s, e]);
}

describe.skipIf(!REQUIRED && !fs.existsSync(ENGINE))('working hours on the engine', () => {
	it('weekOf matches the engine for the project, a group and its people', async () => {
		const engine = await bootNodeEngine({ log: () => {} });
		const s = setup(PLAN);
		const r = engine.schedule({
			files: { 'plan.tjp': PLAN },
			entry: 'plan.tjp',
			revision: ++revision,
		});
		expect(r.ok).toBe(true);
		for (const id of ['a', 'b', 'c']) expect(engineTime(r, id)).toEqual(expand(s.index, id));
	}, 120_000);

	it('a changed day is exactly that day in the engine’s working time', async () => {
		const engine = await bootNodeEngine({ log: () => {} });
		const s = setup(PLAN);
		const c = changeDay({ kind: 'resource', resource: 'b' }, 'B', 'wed', [[600, 900]]);
		if (c.status !== 'intent') throw new Error('invalid');
		const text = textsAfter(s.snap, applyIntent(s.snap, s.index, c.intent))['plan.tjp'] as string;
		expect(text).toContain('workinghours wed 10:00 - 15:00');
		const before = engine.schedule({
			files: { 'plan.tjp': PLAN },
			entry: 'plan.tjp',
			revision: ++revision,
		});
		const after = engine.schedule({
			files: { 'plan.tjp': text },
			entry: 'plan.tjp',
			revision: ++revision,
		});
		expect(after.ok).toBe(true);
		const wed = (r: ScheduleResult): Array<[Minutes, Minutes]> =>
			engineTime(r, 'b').filter(([s0]) => Math.floor(s0 / 1440) % 7 === 2);
		expect(wed(before)).toEqual([
			[2 * 1440 + 480, 2 * 1440 + 720],
			[2 * 1440 + 780, 2 * 1440 + 960],
			[9 * 1440 + 480, 9 * 1440 + 720],
			[9 * 1440 + 780, 9 * 1440 + 960],
		]);
		expect(wed(after)).toEqual([
			[2 * 1440 + 600, 2 * 1440 + 900],
			[9 * 1440 + 600, 9 * 1440 + 900],
		]);
		// Every other day is what it was.
		const rest = (r: ScheduleResult): Array<[Minutes, Minutes]> =>
			engineTime(r, 'b').filter(([s0]) => Math.floor(s0 / 1440) % 7 !== 2);
		expect(rest(after)).toEqual(rest(before));
		// And the editor reads the new text as the engine has it.
		const s2 = setup(text);
		expect(engineTime(after, 'b')).toEqual(expand(s2.index, 'b'));
	}, 120_000);
});
