// SPDX-License-Identifier: GPL-2.0-or-later
// Patch fidelity, P4 (phase-1.md 9.3): the edited workspace still schedules. The real engine runs on
// the old and the new text (the built public/engine bundle, booted once in Node by bootNodeEngine, so
// no native Ruby is involved). For every edit, `ok` must not go from true to false and no new error or
// fatal message id may appear (a multiset of level and id, ignoring lines). For renameTask and
// formatFile the results must be equal apart from names, source lines and timings. A generated plan
// is valid by construction, so its old schedule must be clean and nothing is tolerated; for corpus
// plans the errors that depend on the computed schedule (15.19) are counted, not failed.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootNodeEngine } from '../../engine/golden/run-wasm.mjs';
import type { ScheduleResult } from '../../src/engine/protocol';
import { REPO } from '../golden/corpus';
import { CONFIG, plannedCases, type PlannedCase } from './config';
import { runCase, type Case, type Outcome } from './harness';
import { percentile, writePart, type P4Part } from './stats';
import {
	buildCase,
	describeFailure,
	guarded,
	REGRESSIONS,
	regressionProblem,
	type Regression,
} from './shared';

type Engine = Awaited<ReturnType<typeof bootNodeEngine>>;

/** Errors that depend on the computed schedule, which the edit API cannot see (15.19). */
const SCHEDULE_DEPENDENT = new Set([
	'task_pred_before',
	'task_succ_after',
	'impossible_start_dep',
	'impossible_end_dep',
	'sched_runaway',
	'task_start_range',
	'task_end_range',
	'task_start_in_parent',
	'task_end_in_parent',
	'start_after_end',
]);

/** Bookings are opaque text, so a calendar change of the booked resource (15.22) can only be seen here. */
const CALENDAR_DEPENDENT = new Set(['booking_no_duty', 'booking_on_vacation']);
const CALENDAR_INTENTS = new Set(['setWorkingHours', 'addLeave', 'updateLeave', 'removeLeave']);

const errorsOf = (r: ScheduleResult): Map<string, number> => {
	const out = new Map<string, number>();
	for (const m of r.messages) {
		if (m.level !== 'error' && m.level !== 'fatal') continue;
		const k = `${m.level}:${m.id}`;
		out.set(k, (out.get(k) ?? 0) + 1);
	}
	return out;
};

/** Ids that appear more often in `after` than in `before`. */
function newErrors(before: ScheduleResult, after: ScheduleResult): string[] {
	const b = errorsOf(before);
	return [...errorsOf(after)].filter(([k, n]) => n > (b.get(k) ?? 0)).map(([k]) => k);
}

/** The result without what a rename or a format may change: names, source lines, timings. */
function normalized(r: ScheduleResult, names: boolean): string {
	const { revision: _r, timings: _t, ...rest } = r;
	const copy = JSON.parse(JSON.stringify(rest)) as {
		tasks: Array<{ name: string; source: { line: number | null; column: number | null } | null }>;
		resources: Array<{
			name: string;
			source: { line: number | null; column: number | null } | null;
		}>;
		messages: Array<{ line?: number | null; column?: number | null; text?: string }>;
	};
	for (const x of [...copy.tasks, ...copy.resources]) {
		if (x.source) x.source = { ...x.source, line: null, column: null };
		if (names) x.name = '';
	}
	for (const m of copy.messages) {
		delete m.line;
		delete m.column;
		delete m.text;
	}
	return JSON.stringify(copy);
}

let engine: Engine;
let revision = 0;
const oldCache = new Map<string, ScheduleResult>();

function schedule(
	files: Readonly<Record<string, string>>,
	entry: string,
	now: string | null,
): ScheduleResult {
	return engine.schedule({
		files,
		entry,
		revision: ++revision,
		options: now ? { now } : {},
	}) as ScheduleResult;
}

const failures: string[] = [];
const times: number[] = [];
const tolerated: Record<string, number> = {};
const stats = { runs: 0, cases: 0, okBefore: 0, okKept: 0, newErrors: 0 };
const started = performance.now();

beforeAll(async () => {
	if (!fs.existsSync(path.join(REPO, 'public/engine/manifest.json'))) {
		throw new Error('public/engine is missing: run npm run build:engine first');
	}
	engine = await bootNodeEngine({ log: () => {} });
}, 120_000);

/** P4 for one case that was edited; the failures, and whether the engine ran on the old plan. */
function checkP4(c: Case, o: Outcome): string[] {
	if (o.status !== 'edit' || !o.after) return [];
	const intent = c.drawn.intent;
	let before: ScheduleResult;
	let ranOld = true;
	if (c.source === 'corpus') {
		const cached = oldCache.get(c.name);
		ranOld = cached === undefined;
		before = cached ?? schedule(c.files, c.entry, c.now);
		oldCache.set(c.name, before);
	} else before = schedule(c.files, c.entry, c.now);
	const after = schedule(o.after, c.entry, c.now);
	stats.cases++;
	stats.runs += ranOld ? 2 : 1;
	const bad: string[] = [];
	if (c.source === 'generated' && errorsOf(before).size > 0) {
		bad.push(
			`the generated plan does not schedule cleanly (a bug in the generator): ${[...errorsOf(before).keys()].join(', ')}`,
		);
	}
	if (before.ok) stats.okBefore++;
	const added = newErrors(before, after);
	// Errors that depend on the computed schedule (15.19) are counted, not failed, for corpus plans.
	const fine =
		c.source === 'corpus' &&
		added.length > 0 &&
		added.every((k) => {
			const id = k.split(':')[1] ?? '';
			return (
				SCHEDULE_DEPENDENT.has(id) ||
				(CALENDAR_DEPENDENT.has(id) && CALENDAR_INTENTS.has(intent.type))
			);
		});
	if (before.ok && after.ok) stats.okKept++;
	else if (before.ok && !fine) bad.push('ok went from true to false');
	if (fine) for (const k of added) tolerated[k] = (tolerated[k] ?? 0) + 1;
	else if (added.length > 0) {
		stats.newErrors += added.length;
		bad.push(`new error ids: ${added.join(', ')}`);
	}
	if (
		intent.type === 'renameTask' ||
		intent.type === 'renameResource' ||
		intent.type === 'format'
	) {
		const names = intent.type !== 'format';
		if (normalized(before, names) !== normalized(after, names)) {
			bad.push('the schedule changed (compared apart from names, source lines and timings)');
		}
	}
	return bad.map((b) => `P4: ${b}`);
}

/** Builds, edits and checks one case; a throw anywhere is a failure with its replay line. */
function runP4(p: PlannedCase | Regression): string | null {
	const t0 = performance.now();
	const r = guarded(p, () => {
		const c = buildCase(p);
		const o = runCase(c);
		const wrong = 'intent' in p ? regressionProblem(p, c, o) : null;
		return { c, o, bad: [...(wrong ? [wrong] : []), ...checkP4(c, o)] };
	});
	times.push(performance.now() - t0);
	if ('failure' in r) return r.failure;
	return r.value.bad.length > 0 ? describeFailure(r.value.c, r.value.o, r.value.bad) : null;
}

describe('patch fidelity P4: the edited plan still schedules', () => {
	it('replays the recorded regressions', () => {
		const bad = REGRESSIONS.map(runP4).filter((x): x is string => x !== null);
		expect(bad.join('\n')).toBe('');
	}, 600_000);

	it(`schedules the old and the new plan of every edit (${CONFIG.runs} generated, ${CONFIG.corpusRuns} corpus cases)`, () => {
		for (const p of plannedCases('all')) {
			const bad = runP4(p);
			if (bad) failures.push(bad);
		}
		expect(failures.join('\n')).toBe('');
	}, 3_600_000);

	it('ran the engine on at least one edited case', () => {
		expect(stats.cases, 'P4 checked no case: the run proves nothing').toBeGreaterThan(0);
	});
});

afterAll(() => {
	if (stats.cases === 0) return;
	const part: P4Part = {
		...stats,
		wallMs: performance.now() - started,
		p95Ms: percentile(times, 0.95),
		toleratedIds: tolerated,
		failures,
	};
	writePart('p4', part);
});
