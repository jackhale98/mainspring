// SPDX-License-Identifier: GPL-2.0-or-later
// The fast path's own checks (engine/bridge/fast_path.rb; phase-2.md section 12, T19): every patch
// the bridge cannot vouch for runs in full, says why (`Timings.fastFallback`), and gives the full
// run's result. Small inline plans, the real engine booted in Node. Opt-in with FAST_PATH=1, like
// the equivalence suite.
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { bootNodeEngine } from '../../engine/golden/run-wasm.mjs';
import type { FastEdit, ScheduleRequest, ScheduleResult } from '../../src/engine/protocol';
import { REPO } from '../golden/corpus';
import { canonicalResult } from './fast-path-cases';

const ENGINE = path.join(REPO, 'public/engine/manifest.json');
const ON = process.env['FAST_PATH'] === '1';
/** Each case runs the engine two to four times; generous, for loaded CI runners. */
const CASE_MS = 120_000;
const NOW = { now: '2026-01-05T09:00:00Z' };

const PLAN = [
	'project p "P" 2026-01-05 +3m {',
	'  scenario plan "Plan" {',
	'    scenario delayed "Delayed"',
	'  }',
	'}',
	'resource dev "Dev"',
	'task top "Top" {',
	'  start 2026-01-06',
	'  priority 400',
	'  task a "A" {',
	'    effort 3d',
	'    allocate dev',
	'    complete 20',
	'  }',
	'  task b "B" {',
	'    depends !a',
	'    length 2d',
	'    delayed:length 4d',
	'    priority 600',
	'  }',
	'  task c "C" {',
	'    start 2026-01-07',
	'    end 2026-01-20',
	'  }',
	'}',
	'',
].join('\n');

type Engine = { schedule(r: ScheduleRequest): ScheduleResult };
let engine: Engine;
let revision = 0;

/** PLAN with one line replaced (1-based). */
const withLine = (line: number, text: string): string => {
	const lines = PLAN.split('\n');
	lines[line - 1] = text;
	return lines.join('\n');
};

const edit = (task: string, attribute: FastEdit['attribute'], value: string, line: number): FastEdit => ({
	task,
	attribute,
	scenario: null,
	value,
	file: 'plan.tjp',
	line,
});

/** Keeps PLAN, then runs `text` fast with `edits` and in full; returns both. */
function both(text: string, edits: FastEdit[], base?: number): { fast: ScheduleResult; full: ScheduleResult } {
	const kept = engine.schedule({ files: { 'plan.tjp': PLAN }, entry: 'plan.tjp', options: NOW, retain: true, revision: ++revision });
	const req = { files: { 'plan.tjp': text }, entry: 'plan.tjp', options: NOW };
	const fast = engine.schedule({ ...req, revision: ++revision, fast: { base: base ?? kept.revision, edits } });
	const full = engine.schedule({ ...req, revision: ++revision });
	return { fast, full };
}

describe.skipIf(!ON || !fs.existsSync(ENGINE))('fast path: its own checks', () => {
	beforeAll(async () => {
		engine = (await bootNodeEngine({ log: () => {} })) as unknown as Engine;
	}, 300_000);

	const cases: Array<{ name: string; text: string; edits: FastEdit[]; base?: number; fast: boolean; reason?: RegExp }> = [
		{ name: 'an effort rewrite', text: withLine(11, '    effort 5d'), edits: [edit('top.a', 'effort', '5d', 11)], fast: true },
		{ name: 'a complete rewrite', text: withLine(13, '    complete 60'), edits: [edit('top.a', 'complete', '60', 13)], fast: true },
		{ name: 'a priority rewrite on a leaf', text: withLine(19, '    priority 100'), edits: [edit('top.b', 'priority', '100', 19)], fast: true },
		{ name: 'a container start (children do not inherit start)', text: withLine(8, '  start 2026-01-07'), edits: [edit('top', 'start', '2026-01-07', 8)], fast: true },
		{ name: 'an end rewrite on a leaf that ends last', text: withLine(23, '    end 2026-01-22'), edits: [edit('top.c', 'end', '2026-01-22', 23)], fast: true },
		{ name: 'two rewrites in one patch', text: withLine(11, '    effort 5d').replace('    complete 20', '    complete 40'), edits: [edit('top.a', 'effort', '5d', 11), edit('top.a', 'complete', '40', 13)], fast: true },
		{ name: 'a start before a later end (the direction would change)', text: withLine(22, '    start 2026-01-08'), edits: [edit('top.c', 'start', '2026-01-08', 22)], fast: false, reason: /direction/ },
		{ name: 'a priority its children inherit', text: withLine(9, '  priority 450'), edits: [edit('top', 'priority', '450', 9)], fast: false, reason: /inherited by children/ },
		{ name: 'a value another scenario sets too', text: withLine(17, '    length 3d'), edits: [edit('top.b', 'length', '3d', 17)], fast: false, reason: /later statement|another scenario/ },
		{ name: 'a value TaskJuggler refuses', text: withLine(13, '    complete 150'), edits: [edit('top.a', 'complete', '150', 13)], fast: false, reason: /task_complete/ },
		{ name: 'an edit at the wrong line', text: withLine(11, '    effort 5d'), edits: [edit('top.a', 'effort', '5d', 12)], fast: false, reason: /in-place/ },
		{ name: 'a keyword change', text: withLine(11, '    length 5d'), edits: [edit('top.a', 'length', '5d', 11)], fast: false, reason: /in-place/ },
		{ name: 'an unknown base', text: withLine(11, '    effort 5d'), edits: [edit('top.a', 'effort', '5d', 11)], base: 999_999, fast: false, reason: /another base/ },
		{ name: 'a task that does not exist', text: withLine(11, '    effort 5d'), edits: [edit('top.zz', 'effort', '5d', 11)], fast: false, reason: /not one statement|no task/ },
		{ name: 'a line added', text: PLAN.replace('    effort 3d\n', '    effort 5d\n\n'), edits: [edit('top.a', 'effort', '5d', 11)], fast: false, reason: /in-place/ },
	];

	for (const c of cases) {
		it(`${c.name}: ${c.fast ? 'fast' : 'runs in full'}, same result`, () => {
			const { fast, full } = both(c.text, c.edits, c.base);
			expect(fast.timings.path, fast.timings.fastFallback).toBe(c.fast ? 'fast' : 'full');
			if (c.reason) expect(fast.timings.fastFallback).toMatch(c.reason);
			expect(canonicalResult(fast)).toBe(canonicalResult(full));
		}, CASE_MS);
	}

	it('keeps the time zone of the plan across an unrelated run in between', () => {
		const zoned = PLAN.replace('project p "P" 2026-01-05 +3m {', 'project p "P" 2026-01-05 +3m {\n  timezone "America/New_York"');
		const kept = engine.schedule({ files: { 'plan.tjp': zoned }, entry: 'plan.tjp', options: NOW, retain: true, revision: ++revision });
		// Another plan, in UTC, runs in full meanwhile (a full run with retain would forget the base).
		engine.schedule({ files: { 'plan.tjp': PLAN }, entry: 'plan.tjp', options: NOW, revision: ++revision, fast: { base: -1, edits: [] } });
		const text = zoned.replace('    effort 3d', '    effort 5d');
		const req = { files: { 'plan.tjp': text }, entry: 'plan.tjp', options: NOW };
		const fast = engine.schedule({ ...req, revision: ++revision, fast: { base: kept.revision, edits: [edit('top.a', 'effort', '5d', 12)] } });
		const full = engine.schedule({ ...req, revision: ++revision });
		expect(fast.timings.path, fast.timings.fastFallback).toBe('fast');
		expect(canonicalResult(fast)).toBe(canonicalResult(full));
	}, CASE_MS);

	it('a newer run with retain replaces the kept parse; a run without it does not', () => {
		const first = engine.schedule({ files: { 'plan.tjp': PLAN }, entry: 'plan.tjp', options: NOW, retain: true, revision: ++revision });
		engine.schedule({ files: { 'plan.tjp': PLAN }, entry: 'plan.tjp', options: NOW, revision: ++revision });
		const text = withLine(11, '    effort 5d');
		const patch = { edits: [edit('top.a', 'effort', '5d', 11)] };
		const req = { files: { 'plan.tjp': text }, entry: 'plan.tjp', options: NOW };
		const still = engine.schedule({ ...req, revision: ++revision, fast: { base: first.revision, ...patch } });
		expect(still.timings.path, still.timings.fastFallback).toBe('fast');
		engine.schedule({ files: { 'plan.tjp': PLAN }, entry: 'plan.tjp', options: NOW, retain: true, revision: ++revision });
		const old = engine.schedule({ ...req, revision: ++revision, fast: { base: first.revision, ...patch } });
		expect(old.timings.fastFallback).toMatch(/another base/);
	}, CASE_MS);

	it('a plan with shifts is not kept, and says why', () => {
		const shifts = PLAN.replace('resource dev "Dev"', 'shift s "S" {\n  workinghours mon - fri 9:00 - 12:00\n}\nresource dev "Dev" {\n  shifts s 2026-01-05 - 2026-02-01\n}');
		const kept = engine.schedule({ files: { 'plan.tjp': shifts }, entry: 'plan.tjp', options: NOW, retain: true, revision: ++revision });
		expect(kept.timings.retainError).toMatch(/ShiftAssignments/);
		const lines = shifts.split('\n');
		const at = lines.findIndex((l) => l === '    effort 3d') + 1;
		lines[at - 1] = '    effort 5d';
		const fast = engine.schedule({ files: { 'plan.tjp': lines.join('\n') }, entry: 'plan.tjp', options: NOW, revision: ++revision, fast: { base: kept.revision, edits: [edit('top.a', 'effort', '5d', at)] } });
		const full = engine.schedule({ files: { 'plan.tjp': lines.join('\n') }, entry: 'plan.tjp', options: NOW, revision: ++revision });
		expect(fast.timings.fastFallback).toMatch(/no kept run/);
		expect(canonicalResult(fast)).toBe(canonicalResult(full));
	}, CASE_MS);
});
