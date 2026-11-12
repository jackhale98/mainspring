// SPDX-License-Identifier: GPL-2.0-or-later
// Task attribute edits still schedule (phase-1.md 9.3 P4): intents applied to golden plans are
// scheduled by the wasm engine in Node (engine/golden/run-wasm.mjs) and compared with the plan
// as it is: `ok` does not go from true to false, no new error or fatal message ids appear, and
// the edit has its effect (doubling a task's effort lengthens it, a rename changes only the name,
// a milestone has no duration, a declared flag can be set). Then random intents from
// task-attrs-testing.ts on the smaller golden plans keep the first two properties. Needs the built
// engine (npm run build:engine); skipped without it, except with TJP_EDIT_ENGINE=1, where a
// missing engine fails.
import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import type { NodeEngine } from '../../../engine/runtime';
import type { ScheduleResult, TaskScenarioResult } from '../../../engine/protocol';
import { bootNodeEngine } from '../../../../engine/golden/run-wasm.mjs';
import { ROOT } from '../../../../tests/grammar/corpus';
import { applyIntent } from './apply';
import { attrCorpora, filesAfter, intentFor, type AttrCorpus } from './task-attrs-testing';
import type { EditIntent } from './types';

const ENGINE = path.join(ROOT, 'public/engine/manifest.json');
const REQUIRED = process.env['TJP_EDIT_ENGINE'] === '1';
/** Plans too slow for many runs (the scale plan and the Fedora schedule). */
const SLOW = new Set(['syn-20-scale-1000', 'upstream-fedora-20']);

const NOW: Readonly<Record<string, string>> = Object.fromEntries(
	(
		JSON.parse(fs.readFileSync(path.join(ROOT, 'engine/golden/manifest.json'), 'utf8')) as Array<{
			id: string;
			now: string | null;
		}>
	).flatMap((p) => (p.now ? [[p.id, p.now]] : [])),
);

let engine: NodeEngine;
let revision = 0;

function schedule(c: AttrCorpus, files: Record<string, string>): ScheduleResult {
	const now = NOW[c.name];
	return engine.schedule({
		files,
		entry: c.snap.entry,
		revision: ++revision,
		options: now ? { now } : {},
	});
}

const errorIds = (r: ScheduleResult): string[] =>
	r.messages
		.filter((m) => m.level === 'error' || m.level === 'fatal')
		.map((m) => `${m.level}:${m.id}`)
		.sort();

/** New error ids of `after` against `before` (multiset difference). */
function newErrors(before: ScheduleResult, after: ScheduleResult): string[] {
	const left = errorIds(before);
	return errorIds(after).filter((id) => {
		const i = left.indexOf(id);
		if (i < 0) return true;
		left.splice(i, 1);
		return false;
	});
}

const base = new Map<string, ScheduleResult>();
function scheduled(c: AttrCorpus): ScheduleResult {
	let r = base.get(c.name);
	if (!r) {
		r = schedule(c, filesAfter(c.snap, { status: 'noop', reason: 'not-present' }));
		base.set(c.name, r);
	}
	return r;
}

/**
 * Error ids that only say the changed plan no longer fits its constraints (a shorter task lets a
 * `precedes` chain run before the project start; a task without its effort and with one bound
 * cannot be placed; an effort needs an allocation, which a later edit adds): the edit is right,
 * the plan is incomplete or tighter. Only random sizing and scheduling
 * changes may add them, and they are counted, not failed.
 */
const CONSEQUENCES: ReadonlySet<string> = new Set([
	'error:sched_runaway',
	'error:not_scheduled',
	'error:task_underspecified',
	'error:effort_no_allocations',
	'error:impossible_end_dep',
	'error:impossible_start_dep',
]);
let consequences = 0;

const timing = (i: EditIntent): boolean =>
	(i.type === 'setAttr' || i.type === 'removeAttr') &&
	['effort', 'length', 'duration', 'scheduling', 'milestone'].includes(i.attr);

/** Applies an intent, schedules the result and checks P4; the new result, or null when no edit. */
function editAndSchedule(
	c: AttrCorpus,
	intent: EditIntent,
	tolerant = false,
): ScheduleResult | null {
	const r = applyIntent(c.snap, c.index, intent);
	if (r.status !== 'edit') return null;
	const before = scheduled(c);
	const after = schedule(c, filesAfter(c.snap, r));
	const label = `${c.name} ${JSON.stringify(intent)}`;
	const added = newErrors(before, after);
	if (tolerant && timing(intent) && added.length > 0 && added.every((id) => CONSEQUENCES.has(id))) {
		consequences++;
		return after;
	}
	const msgs = after.messages.filter((m) => m.level === 'error' || m.level === 'fatal');
	if (before.ok) expect(after.ok, `${label} ${JSON.stringify(msgs)}`).toBe(true);
	expect(added, `${label} ${JSON.stringify(msgs)}`).toEqual([]);
	return after;
}

function plan(result: ScheduleResult, task: string): TaskScenarioResult | undefined {
	const t = result.tasks.find((x) => x.id === task);
	const top = result.project?.scenarios[0]?.id ?? 'plan';
	return t?.scenarios[top];
}

const span = (s: TaskScenarioResult | undefined): number =>
	s?.start !== null && s?.start !== undefined && s.end !== null ? s.end - s.start : -1;

describe.skipIf(!REQUIRED && !fs.existsSync(ENGINE))('task attribute edits schedule', () => {
	const corpora = attrCorpora().filter((c) => !c.name.startsWith('tests/'));
	const byName = new Map(corpora.map((c) => [c.name, c]));
	const get = (name: string): AttrCorpus => {
		const c = byName.get(name);
		if (!c) throw new Error(`no corpus ${name}`);
		return c;
	};

	beforeAll(async () => {
		engine = (await bootNodeEngine({ log: () => {} })) as NodeEngine;
	}, 120_000);

	it('doubling effort lengthens the task; a new criterion replaces the old', () => {
		const c = get('poc-sample');
		const before = plan(scheduled(c), 'app.editor');
		const doubled = editAndSchedule(c, {
			type: 'setAttr',
			task: 'app.editor',
			attr: 'effort',
			value: '10d',
		});
		expect(doubled).not.toBeNull();
		expect(span(plan(doubled as ScheduleResult, 'app.editor'))).toBeGreaterThan(span(before));
		const length = editAndSchedule(c, {
			type: 'setAttr',
			task: 'spike.perf',
			attr: 'length',
			value: '1d',
		});
		expect(length).not.toBeNull();
		const perf = plan(length as ScheduleResult, 'spike.perf');
		expect(span(perf)).toBeLessThan(span(plan(scheduled(c), 'spike.perf')));
	}, 60_000);

	it('renames only the name; a milestone has no duration; flags declare and set', () => {
		const c = get('poc-sample');
		const renamed = editAndSchedule(c, {
			type: 'renameTask',
			task: 'app.gantt',
			name: 'Timeline "view"',
		});
		expect(renamed?.tasks.find((t) => t.id === 'app.gantt')?.name).toBe('Timeline "view"');
		const strip = (r: ScheduleResult | null): unknown => r?.tasks.map((t) => ({ ...t, name: '' }));
		expect(strip(renamed)).toEqual(strip(scheduled(c)));
		const flagged = editAndSchedule(c, { type: 'declareFlag', flag: 'urgent' });
		expect(flagged).not.toBeNull();
		for (const name of ['poc-sample', 'syn-17-priority-efficiency', 'upstream-tutorial']) {
			const x = get(name);
			const t = x.tasks.find((id) => x.index.tasks.get(id)?.children.length === 0) ?? '';
			for (const intent of [
				{ type: 'setAttr', task: t, attr: 'priority', value: '900' },
				{ type: 'setAttr', task: t, attr: 'complete', value: '50' },
				{ type: 'setAttr', task: t, attr: 'note', value: '"Checked by the engine"' },
				{ type: 'removeAttr', task: t, attr: 'note' },
			] as const) {
				editAndSchedule(x, intent);
			}
		}
	}, 120_000);

	it('turns a leaf without sizing into a milestone', () => {
		let done = 0;
		for (const c of corpora) {
			if (SLOW.has(c.name) || done >= 3) continue;
			const id = c.tasks.find((t) => {
				const sym = c.index.tasks.get(t);
				return (
					sym?.children.length === 0 &&
					sym.attrs.some((a) => a.keyword === 'start') &&
					!sym.attrs.some((a) => ['effort', 'length', 'duration', 'milestone'].includes(a.keyword))
				);
			});
			if (!id) continue;
			const r = editAndSchedule(c, { type: 'setAttr', task: id, attr: 'milestone', value: true });
			if (!r) continue;
			const t = r.tasks.find((x) => x.id === id);
			expect(t?.milestone, `${c.name} ${id}`).toBe(true);
			done++;
		}
		expect(done).toBeGreaterThan(0);
	}, 120_000);

	it('random intents on golden plans keep ok and add no error ids', () => {
		const small = corpora.filter((c) => !SLOW.has(c.name));
		let edits = 0;
		fc.assert(
			fc.property(
				fc.record({
					ci: fc.nat(small.length - 1),
					kind: fc.nat(4),
					pick: fc.nat(),
					value: fc.nat(1000),
				}),
				({ ci, kind, pick, value }) => {
					const c = small[ci];
					if (!c) return;
					if (editAndSchedule(c, intentFor(c, kind, pick, value), true)) edits++;
				},
			),
			{ numRuns: Number(process.env['TJP_EDIT_ENGINE_RUNS'] ?? 60) },
		);
		console.log(
			`task attribute engine check: ${edits} edits scheduled, ${consequences} tighter plans`,
		);
		expect(edits).toBeGreaterThan(10);
	}, 300_000);
});
