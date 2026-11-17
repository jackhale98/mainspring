// SPDX-License-Identifier: GPL-2.0-or-later
// The explainer and demand on the real engine (wasm, booted in Node), for the T10 review's
// truthfulness cases: each plan is scheduled, explained, and checked to say nothing the schedule
// does not show. Each case has a control, the same plan without the restriction, that does give
// the mark, so the case exercises the path it guards.
// - F1: task `shifts` (own or inherited) or an `allocate { shifts … }` body: the wait is `unknown`
//   and nothing is held, although the person was booked elsewhere in the morning;
// - F2: a macro-written `start` and `effort` on a task that waits for a busy person: no false
//   `constraint` bound, `unknown`;
// - F3: a length task with task `limits`, a morning shift, or a person with `limits`: no unmet
//   marks;
// - on every plan: the causes tile the wait, and an effort leaf on its bound starts in the first
//   slot its people work (the independent oracle of F4).
// Needs the built engine (npm run build:engine); skipped without it unless EXPLAIN_ENGINE=1.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootNodeEngine } from '../../../engine/golden/run-wasm.mjs';
import { ROOT } from '../../../tests/grammar/corpus';
import type { ScheduleResult } from '../../engine/protocol';
import { demandOf } from './demand';
import { explainTask } from './explain-task';
import { firstSlotOracle, inlineContext, partitionProblems, windowed } from './explain-testing';
import type { ExplainContext } from './explain-types';
import { at } from './testing';

const ENGINE = path.join(ROOT, 'public/engine/manifest.json');
const REQUIRED = process.env['EXPLAIN_ENGINE'] === '1';
/** The first case boots the engine (seconds, more on a loaded machine). */
const TIMEOUT = 120_000;
const H = 'project p "P" 2026-01-05 - 2026-01-30\n';
const AFTERNOON = 'shift aft "Afternoon" {\n  workinghours mon - fri 13:00 - 17:00\n}\n';
const MORNING = 'shift morn "Morning" {\n  workinghours mon - fri 9:00 - 12:00\n}\n';
/** x takes r first (priority 900), Mon 09:00 to 13:00 or for days. */
const X = (effort: string) => `task x "X" {\n  effort ${effort}\n  allocate r\n  priority 900\n}\n`;

let engine: Awaited<ReturnType<typeof bootNodeEngine>> | null = null;
let revision = 0;
async function contextOf(text: string): Promise<ExplainContext> {
	engine ??= await bootNodeEngine({ log: () => {} });
	const r: ScheduleResult = engine.schedule({
		files: { 'plan.tjp': text },
		entry: 'plan.tjp',
		revision: ++revision,
		options: {},
	});
	expect(r.messages.filter((m) => m.level === 'error' || m.level === 'fatal')).toEqual([]);
	const ctx = inlineContext(r, text);
	checkAll(ctx);
	return ctx;
}

/** The properties every plan here must keep (see the module comment). */
function checkAll(ctx: ExplainContext): void {
	const res = ctx.result.project?.timingResolutionMin ?? 60;
	for (const t of ctx.result.tasks) {
		const p = explainTask(t.id, ctx);
		if (p.at === null || p.bound === null) continue;
		const [lo, hi] = p.anchor === 'start' ? [p.bound, p.at] : [p.at, p.bound];
		const asked = t.scenarios[ctx.scenario]?.allocate.flatMap((i) => i.candidates) ?? [];
		const people = ctx.result.resources
			.filter((r) => !r.group && asked.some((c) => c === r.id || c === r.parent))
			.map((r) => r.id);
		if (people.length === 0) people.push('(project)');
		if (windowed(p.causes).length > 0) {
			expect(partitionProblems(p.causes, people, lo, hi), t.id).toEqual([]);
		}
		if (p.anchor === 'start' && p.at <= p.bound && p.bound - p.at < res) {
			const first = firstSlotOracle(ctx, t.id);
			if (first !== null) expect(p.at, `${t.id} on its bound`).toBe(first);
		}
	}
}

const marks = (ctx: ExplainContext) => {
	const d = demandOf(ctx);
	const list = (m: typeof d.held) =>
		[...m].flatMap(([p, es]) => es.map((e) => `${p} ${e.task} ${e.window[0]}-${e.window[1]}`));
	return { held: list(d.held), unmet: list(d.unmet) };
};
const kinds = (ctx: ExplainContext, id: string) => explainTask(id, ctx).causes.map((c) => c.kind);

describe.skipIf(!REQUIRED && !fs.existsSync(ENGINE))('the review cases on the engine', () => {
	it(
		'F1: a task shift makes the wait unknown and holds nobody; without it, r is busy',
		async () => {
			const a = (extra: string) => `task a "A" {\n  effort 4h\n  allocate r\n${extra}}\n`;
			const shifted = await contextOf(
				`${H}${AFTERNOON}resource r "R"\n${X('4h')}${a('  shifts aft\n')}`,
			);
			// a starts Mon 13:00 in both plans; with the shift it would start there without x too.
			expect(explainTask('a', shifted)).toMatchObject({ bound: 0, at: at(0, 13) });
			expect(kinds(shifted, 'a')).toEqual(['frame', 'unknown']);
			expect(marks(shifted).held).toEqual([]);
			const alone = await contextOf(`${H}${AFTERNOON}resource r "R"\n${a('  shifts aft\n')}`);
			expect(explainTask('a', alone)).toMatchObject({ at: at(0, 13) });
			expect(kinds(alone, 'a')).toEqual(['frame', 'unknown']);

			// Control: no shift; x's morning is a real wait.
			const plain = await contextOf(`${H}resource r "R"\n${X('4h')}${a('')}`);
			expect(kinds(plain, 'a')).toEqual(['frame', 'off-hours', 'busy']);
			expect(marks(plain).held).toEqual([`r a 0-${at(0, 13)}`]);
		},
		TIMEOUT,
	);

	it(
		'F1: an inherited task shift and an allocation shift too',
		async () => {
			const inherited = await contextOf(
				`${H}${AFTERNOON}resource r "R"\n${X('4h')}task g "G" {\n  shifts aft\n  task a "A" {\n    effort 4h\n    allocate r\n  }\n}\n`,
			);
			expect(kinds(inherited, 'g.a')).toEqual(['frame', 'unknown']);
			expect(marks(inherited).held).toEqual([]);
			const allocation = await contextOf(
				`${H}${AFTERNOON}resource r "R"\n${X('4h')}task a "A" {\n  effort 4h\n  allocate r { shifts aft }\n}\n`,
			);
			expect(kinds(allocation, 'a')).toEqual(['frame', 'unknown']);
			expect(marks(allocation).held).toEqual([]);
		},
		TIMEOUT,
	);

	it(
		'F2: a macro-written size does not let a macro start stand for the bound',
		async () => {
			const macros = 'macro e [effort 2d]\nmacro s [2026-01-05]\n';
			const a = (start: string, effort: string) =>
				`task a "A" {\n  start ${start}\n  ${effort}\n  allocate r\n}\n`;
			const ctx = await contextOf(`${H}${macros}resource r "R"\n${X('2d')}${a('${s}', '${e}')}`);
			// a waits two days for r; the text's start is Mon 00:00, but neither value is readable.
			expect(explainTask('a', ctx)).toMatchObject({
				bound: null,
				at: at(2, 9),
				causes: [{ kind: 'constraint', attr: 'start', inherited: false }, { kind: 'unknown' }],
			});
			expect(marks(ctx)).toEqual({ held: [], unmet: [] });
			const alone = await contextOf(`${H}${macros}resource r "R"\n${a('${s}', '${e}')}`);
			expect(explainTask('a', alone)).toMatchObject({ bound: null, at: at(0, 9) });
			expect(kinds(alone, 'a')).toEqual(['constraint', 'unknown']);

			// Control: written plainly, the bound is the start and the two days are r's on x.
			const plain = await contextOf(
				`${H}resource r "R"\n${X('2d')}${a('2026-01-05', 'effort 2d')}`,
			);
			expect(kinds(plain, 'a')).toEqual(['constraint', 'off-hours', 'busy', 'off-hours']);
			expect(marks(plain).held).toEqual([`r a 0-${at(2, 9)}`]);
		},
		TIMEOUT,
	);

	it(
		'F3: no unmet work under task limits, a task shift or the person’s limits',
		async () => {
			const o = (extra: string) => `task o "O" {\n  length 5d\n  allocate r\n${extra}}\n`;
			const limited = await contextOf(
				`${H}resource r "R"\n${X('3d')}${o('  limits { dailymax 2h }\n')}`,
			);
			expect(marks(limited).unmet).toEqual([]);
			const shifted = await contextOf(
				`${H}${MORNING}resource r "R"\n${X('5d')}${o('  shifts morn\n')}`,
			);
			expect(marks(shifted).unmet).toEqual([]);
			const person = await contextOf(
				`${H}resource r "R" {\n  limits { dailymax 2h }\n}\n${X('2d')}${o('')}`,
			);
			expect(marks(person).unmet).toEqual([]);

			// Control: no limits, no shift; r is on x Mon to Wed while o runs without r.
			const plain = await contextOf(`${H}resource r "R"\n${X('3d')}${o('')}`);
			expect(marks(plain).unmet).toEqual([`r o ${at(0, 9)}-${at(2, 17)}`]);
		},
		TIMEOUT,
	);
});
