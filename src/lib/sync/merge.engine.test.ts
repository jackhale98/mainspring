// SPDX-License-Identifier: GPL-2.0-or-later
// The gate's blocked case on the real engine (phase-4.md 16.1 step 6, 6.5): A deletes task T while
// B adds a dependency on T. The merge is clean text (nothing proves the two edits clash), and the
// engine (wasm, booted in Node) refuses the merged plan with the dependency error pinned to the
// dependent task, so the app's check blocks the commit. Both sides and the base schedule on their
// own, and the gate's clean case schedules. Needs the built engine (npm run build:engine);
// skipped without it unless MERGE_ENGINE=1.
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ScheduleResult } from '../../engine/protocol';
import { bootNodeEngine } from '../../../engine/golden/run-wasm.mjs';
import { ROOT } from '../../../tests/grammar/corpus';
import { mergeAll } from '../tjp/merge/testing';
import { edited, PLAN } from './merge-testing';

const ENGINE = path.join(ROOT, 'public/engine/manifest.json');
const REQUIRED = process.env['MERGE_ENGINE'] === '1';
const ENTRY = 'plan.tjp';

interface Engine {
	schedule(req: {
		files: Record<string, string>;
		entry: string;
		revision: number;
		options: Record<string, never>;
	}): ScheduleResult;
}

let engine: Engine;
let revision = 0;
const schedule = (files: Record<string, string>): ScheduleResult =>
	engine.schedule({ files, entry: ENTRY, revision: ++revision, options: {} });
const errors = (r: ScheduleResult): ScheduleResult['messages'] =>
	r.messages.filter((m) => m.level === 'error' || m.level === 'fatal');

describe.skipIf(!REQUIRED && !fs.existsSync(ENGINE))('merged plans on the engine', () => {
	beforeAll(async () => {
		engine = (await bootNodeEngine({ log: () => {} })) as Engine;
	}, 120_000);

	it('blocks a deleted task with a new dependency on it, pinned to the dependent task', () => {
		const a = edited(PLAN, { type: 'deleteTask', task: 't' });
		const b = edited(PLAN, { type: 'addDepends', task: 'x', target: 't' });
		for (const side of [PLAN, a, b]) {
			const r = schedule(side);
			expect(errors(r)).toEqual([]);
			expect(r.ok).toBe(true);
		}
		const m = mergeAll(ENTRY, PLAN, a, b);
		expect(m.conflicts).toEqual([]);
		const merged = Object.fromEntries(m.files);
		const r = schedule(merged);
		const errs = errors(r);
		console.info(
			`blocked merge: ok ${r.ok}; ${errs.map((e) => `${e.id} ${e.file}:${e.line} ${e.text}`).join('; ')}`,
		);
		expect(r.ok).toBe(false);
		expect(errs.length).toBeGreaterThan(0);
		// TaskJuggler pins the error to the declaration of the task that depends (`task x`).
		const line = (merged[ENTRY] ?? '').split('\n').indexOf('task x "X" {') + 1;
		expect(errs.map((e) => [e.id, e.file, e.line])).toEqual([['task_depend_unknown', ENTRY, line]]);
		// The fix of 16.1 step 6: B removes the dependency in the text, and the plan schedules.
		const fixed = { ...merged, [ENTRY]: (merged[ENTRY] ?? '').replace(/ *depends !t\n/, '') };
		expect(schedule(fixed).ok).toBe(true);
	}, 60_000);

	it('schedules the clean merge of the gate', () => {
		const a = edited(PLAN, { type: 'setAttr', task: 'x', attr: 'effort', value: '5d' });
		const b = edited(PLAN, { type: 'allocate', task: 'x', resources: ['qa'] });
		const m = mergeAll(ENTRY, PLAN, a, b);
		expect(m.conflicts).toEqual([]);
		const r = schedule(Object.fromEntries(m.files));
		expect(errors(r)).toEqual([]);
		expect(r.ok).toBe(true);
	}, 60_000);
});
