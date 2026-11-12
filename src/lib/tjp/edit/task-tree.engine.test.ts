// SPDX-License-Identifier: GPL-2.0-or-later
// Task tree intents against the engine (phase-1.md 9.3 P4): on every golden plan, deletes,
// additions, reorders and reparenting moves are applied and the wasm engine (booted in Node by
// engine/golden/run-wasm.mjs) schedules the result. Each edited plan must stay `ok` when the
// golden is, with no new error or fatal message ids. A reorder of a task whose subtree allocates
// nothing (so no resource contention depends on declaration order) is semantically neutral: every
// task keeps its scheduled dates. A reparenting move keeps the moved task's dependencies (the
// index check of the property tests); its dates are compared and counted. Needs the built engine
// (npm run build:engine); skipped without it, except with TJP_EDIT_ENGINE=1, where a missing
// engine fails. FC_SEED fixes the fast-check seed.
import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bootNodeEngine, loadCorpus, planRequest } from '../../../../engine/golden/run-wasm.mjs';
import { ROOT } from '../../../../tests/grammar/corpus';
import type { ScheduleRequest, ScheduleResult } from '../../../engine/protocol';
import { applyIntent } from './apply';
import { arbPlan, load, movedId, type Loaded } from './testing-plans';
import type { EditIntent } from './types';

const ENGINE = path.join(ROOT, 'public/engine/manifest.json');
const REQUIRED = process.env['TJP_EDIT_ENGINE'] === '1';
/** A fixed fast-check seed (CI sets FC_SEED), else a random one. */
const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };

interface Golden {
	entry: string;
	files: string[];
	options: { now: string | null };
	result: ScheduleResult;
}

const errorIds = (r: ScheduleResult): string[] =>
	r.messages
		.filter((m) => m.level === 'error' || m.level === 'fatal')
		.map((m) => `${m.level}:${m.id}`)
		.sort();

/** Dates per task id (mapped), per scenario. */
function dates(r: ScheduleResult, map: (id: string) => string = (x) => x): Map<string, string> {
	const out = new Map<string, string>();
	for (const t of r.tasks) {
		const sc = Object.entries(t.scenarios).map(([k, v]) => `${k}:${v.start}-${v.end}`);
		out.set(map(t.id), sc.sort().join(' '));
	}
	return out;
}

/**
 * The engine's task tree after the intent against the base tree mapped through it: every kept task
 * has its (mapped) parent, deleted ones are gone, and an addition adds exactly one task.
 */
function treeDiff(base: ScheduleResult, result: ScheduleResult, intent: EditIntent): string[] {
	const gone = (id: string): boolean =>
		intent.type === 'deleteTask' && (id === intent.task || id.startsWith(`${intent.task}.`));
	const map = intent.type === 'moveTask' ? movedId(intent.task, intent.parent) : (x: string) => x;
	const now = new Map(result.tasks.map((t) => [t.id, t.parent]));
	const out: string[] = [];
	let kept = 0;
	// Automatic ids (`_Task_12`) count declarations, so they renumber when the order changes; no
	// text can name them, so only their number is compared (through the task count).
	const auto = (id: string): boolean => /(^|\.)_Task_\d+/.test(id);
	for (const t of base.tasks) {
		if (auto(t.id)) {
			kept++;
			continue;
		}
		if (gone(t.id)) {
			if (now.has(t.id)) out.push(`${t.id} not deleted`);
			continue;
		}
		kept++;
		const id = map(t.id);
		const moved = intent.type === 'moveTask' && t.id === intent.task;
		const want = moved ? intent.parent : t.parent === null ? null : map(t.parent);
		if (!now.has(id)) out.push(`${id} missing`);
		else if (now.get(id) !== want) out.push(`${id} has parent ${now.get(id)}, not ${want}`);
	}
	const added = intent.type === 'addTask' ? 1 : 0;
	if (result.tasks.length !== kept + added)
		out.push(`${result.tasks.length} tasks, not ${kept + added}`);
	return out;
}

/** Intents for a plan: delete a leaf, add a sibling, reorder and reparent (deterministic). */
function intentsFor(c: Loaded): Array<{ intent: EditIntent; neutral: boolean }> {
	const tasks = [...c.index.tasks.values()].filter((t) => t.idSource === 'text');
	const out: Array<{ intent: EditIntent; neutral: boolean }> = [];
	const leaf = [...tasks].reverse().find((t) => t.children.length === 0);
	if (leaf) {
		// A plan without tasks fails natively (`no_tasks`), so the only task is not deleted.
		if (tasks.length > 1)
			out.push({ intent: { type: 'deleteTask', task: leaf.id }, neutral: false });
		const sibs =
			leaf.parent === null ? c.index.taskRoots : (c.index.tasks.get(leaf.parent)?.children ?? []);
		out.push({
			intent: {
				type: 'addTask',
				parent: leaf.parent,
				index: sibs.length,
				name: 'Added',
				attrs: [['milestone', true]],
			},
			neutral: false,
		});
	}
	const allocates = (id: string): boolean =>
		c.index.allocations.some(
			(a) => a.task !== null && (a.task === id || a.task.startsWith(`${id}.`)),
		);
	for (const t of tasks) {
		const sibs =
			t.parent === null ? c.index.taskRoots : (c.index.tasks.get(t.parent)?.children ?? []);
		if (sibs.length < 2 || sibs.indexOf(t.id) === 0) continue;
		out.push({
			intent: { type: 'moveTask', task: t.id, parent: t.parent, index: 0 },
			neutral: !allocates(t.id),
		});
		break;
	}
	const deep = tasks.find((t) => t.parent !== null && t.children.length === 0);
	if (deep) {
		out.push({
			intent: { type: 'moveTask', task: deep.id, parent: null, index: c.index.taskRoots.length },
			neutral: false,
		});
	}
	return out;
}

describe.skipIf(!REQUIRED && !fs.existsSync(ENGINE))('task tree intents schedule', () => {
	it('stay ok with no new errors on every golden plan; neutral reorders keep the dates', async () => {
		const engine = await bootNodeEngine({ log: () => {} });
		const corpus = loadCorpus() as Array<{ plan: { id: string; root: string }; golden: Golden }>;
		const failures: string[] = [];
		const counts = { edits: 0, refused: 0, neutral: 0, reparentSame: 0, reparent: 0 };
		let revision = 0;
		for (const { plan, golden } of corpus) {
			const request = planRequest(plan, golden, ++revision) as ScheduleRequest;
			const c = load(plan.id, { entry: golden.entry, files: { ...request.files } });
			const base = golden.result;
			for (const { intent, neutral } of intentsFor(c)) {
				const r = applyIntent(c.snap, c.index, intent);
				if (r.status !== 'edit') {
					counts.refused++;
					continue;
				}
				counts.edits++;
				const files: Record<string, string> = {};
				for (const [p, f] of c.snap.files) {
					const cs = r.edit.changes[p];
					files[p] = cs ? cs.apply(f.text).toString() : f.text.toString();
				}
				const result = engine.schedule({ ...request, files, revision: ++revision });
				const label = `${plan.id} ${JSON.stringify(intent)}`;
				if (base.ok && !result.ok) failures.push(`${label}: not ok`);
				const before = errorIds(base);
				const fresh = errorIds(result).filter((id) => {
					const i = before.indexOf(id);
					if (i >= 0) before.splice(i, 1);
					return i < 0;
				});
				if (fresh.length > 0) failures.push(`${label}: new ${fresh.join(', ')}`);
				if (base.ok)
					for (const d of treeDiff(base, result, intent)) failures.push(`${label}: ${d}`);
				if (intent.type !== 'moveTask') continue;
				const map = movedId(intent.task, intent.parent);
				const old = dates(base, map);
				const now = dates(result);
				if (!now.has(map(intent.task))) failures.push(`${label}: moved task missing`);
				const same = [...old].every(([id, d]) => now.get(id) === d);
				if (neutral) {
					counts.neutral++;
					if (!same) failures.push(`${label}: dates changed by a neutral reorder`);
				} else if (intent.parent !== c.index.tasks.get(intent.task)?.parent) {
					counts.reparent++;
					if (old.get(map(intent.task)) === now.get(map(intent.task))) counts.reparentSame++;
				}
			}
		}
		console.log(`task tree engine check: ${JSON.stringify(counts)}`);
		expect(failures).toEqual([]);
		expect(counts.edits).toBeGreaterThan(40);
	}, 600_000);
});

/**
 * A random move, delete or addition. Edits whose engine error the text decides (a child under a
 * task with effort, a lost allocation, a loop) are refused by the intents, so they are not
 * filtered here; only deleting every task is left out (a plan without tasks fails natively,
 * `no_tasks`).
 */
function anyIntent(c: Loaded, pick: readonly number[]): EditIntent | null {
	const tasks = [...c.index.tasks.values()];
	const t = tasks[(pick[0] ?? 0) % tasks.length];
	if (!t) return null;
	const parents = [null, ...tasks.map((x) => x.id)];
	const parent = parents[(pick[2] ?? 0) % parents.length] ?? null;
	const n = (parent === null ? c.index.taskRoots : (c.index.tasks.get(parent)?.children ?? []))
		.length;
	switch ((pick[1] ?? 0) % 3) {
		case 0: {
			const keepsTasks = t.parent !== null || c.index.taskRoots.length > 1;
			return keepsTasks ? { type: 'deleteTask', task: t.id } : null;
		}
		case 1:
			return { type: 'addTask', parent, index: (pick[3] ?? 0) % (n + 1), name: 'Added' };
		default: {
			const others = n - (t.parent === parent ? 1 : 0);
			return { type: 'moveTask', task: t.id, parent, index: (pick[3] ?? 0) % (others + 1) };
		}
	}
}

describe.skipIf(!REQUIRED && !fs.existsSync(ENGINE))('task tree intents on generated plans', () => {
	it('still schedule with no new errors', async () => {
		const engine = await bootNodeEngine({ log: () => {} });
		let revision = 0;
		let edits = 0;
		const schedule = (files: Record<string, string>): ScheduleResult =>
			engine.schedule({
				files,
				entry: 'plan.tjp',
				revision: ++revision,
				options: { now: '2026-01-05T09:00:00Z' },
			});
		fc.assert(
			fc.property(
				arbPlan(),
				fc.array(fc.nat({ max: 1000 }), { minLength: 4, maxLength: 4 }),
				(plan, p) => {
					const c = load('generated', plan);
					const intent = anyIntent(c, p);
					if (!intent) return;
					const r = applyIntent(c.snap, c.index, intent);
					if (r.status !== 'edit') return;
					edits++;
					const base = schedule(plan.files);
					expect(base.ok).toBe(true);
					const files: Record<string, string> = {};
					for (const [path, f] of c.snap.files) {
						const cs = r.edit.changes[path];
						files[path] = cs ? cs.apply(f.text).toString() : f.text.toString();
					}
					const result = schedule(files);
					expect({ ok: result.ok, errors: errorIds(result), intent }).toEqual({
						ok: true,
						errors: errorIds(base),
						intent,
					});
					expect({ tree: treeDiff(base, result, intent), intent }).toEqual({ tree: [], intent });
				},
			),
			{ numRuns: Number(process.env['TJP_EDIT_ENGINE_RUNS'] ?? 40), ...SEED },
		);
		expect(edits).toBeGreaterThan(10);
	}, 300_000);
});
