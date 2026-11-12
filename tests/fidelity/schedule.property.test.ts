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
import { CONFIG, plannedCases } from './config';
import { runCase } from './harness';
import { percentile, writePart, type P4Part } from './stats';
import { buildCase, describeFailure, knownP4 } from './shared';

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
const stats = { runs: 0, cases: 0, okBefore: 0, okKept: 0, newErrors: 0, known: 0 };
const started = performance.now();

beforeAll(async () => {
	if (!fs.existsSync(path.join(REPO, 'public/engine/manifest.json'))) {
		throw new Error('public/engine is missing: run npm run build:engine first');
	}
	engine = await bootNodeEngine({ log: () => {} });
}, 120_000);

describe('patch fidelity P4: the edited plan still schedules', () => {
	it(`schedules the old and the new plan of every edit (${CONFIG.runs} generated, ${CONFIG.corpusRuns} corpus cases)`, () => {
		for (const p of plannedCases('all')) {
			const t0 = performance.now();
			const c = buildCase(p);
			const o = runCase(c);
			if (o.status !== 'edit' || !o.after) continue;
			const intent = c.drawn.intent;
			let before: ScheduleResult;
			if (c.source === 'corpus') {
				before = oldCache.get(c.name) ?? schedule(c.files, c.entry, c.now);
				oldCache.set(c.name, before);
			} else before = schedule(c.files, c.entry, c.now);
			const after = schedule(o.after, c.entry, c.now);
			stats.cases++;
			stats.runs += c.source === 'corpus' && oldCache.has(c.name) ? 1 : 2;
			const bad: string[] = [];
			if (c.source === 'generated' && errorsOf(before).size > 0) {
				bad.push(
					`the generated plan does not schedule cleanly (a bug in the generator): ${[...errorsOf(before).keys()].join(', ')}`,
				);
			}
			if (before.ok) stats.okBefore++;
			if (before.ok && after.ok) stats.okKept++;
			const added = newErrors(before, after);
			const known = added.length > 0 && knownP4(c, added) !== null;
			if (known) stats.known++;
			else if (before.ok && !after.ok) bad.push('ok went from true to false');
			const fine =
				c.source === 'corpus' &&
				added.length > 0 &&
				added.every((k) => SCHEDULE_DEPENDENT.has(k.split(':')[1] ?? ''));
			if (fine) for (const k of added) tolerated[k] = (tolerated[k] ?? 0) + 1;
			else if (added.length > 0 && !known) {
				stats.newErrors += added.length;
				bad.push(`new error ids: ${added.join(', ')}`);
			}
			if (intent.type === 'renameTask' || intent.type === 'format') {
				if (
					normalized(before, intent.type === 'renameTask') !==
					normalized(after, intent.type === 'renameTask')
				) {
					bad.push('the schedule changed (compared apart from names, source lines and timings)');
				}
			}
			if (bad.length > 0)
				failures.push(
					describeFailure(
						c,
						o,
						bad.map((b) => `P4: ${b}`),
					),
				);
			times.push(performance.now() - t0);
		}
		expect(failures.join('\n')).toBe('');
	}, 1_800_000);
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
