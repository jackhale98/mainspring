// SPDX-License-Identifier: GPL-2.0-or-later
// The dependency and allocation intents on golden plans, scheduled by the wasm engine booted in
// Node (engine/golden/run-wasm.mjs; phase-1.md 9.3 P4). For random intents (fast-check, fixed
// seed) on every golden plan that schedules (the two slowest are left to the nightly fidelity
// job), each edit must keep `ok`, add no new error or fatal message ids, and have its effect:
// - addDepends: the successor starts no earlier than the predecessor ends;
// - setDependsGap: the gap is honoured on every item of the link (calendar minutes for
//   gapduration; at least the working minutes for gaplength);
// - addAllocation, allocate, replaceAllocation: an effort leaf task books the new resource (or a
//   leaf of it), and bookings come only from allocated resources;
// - removeAllocation: the resource no longer books the task.
// And the loop check: a `cycle` refusal for unrelated tasks (links back along existing ones, the
// sampled refusals, and the Tutorial's gui -> test), forced into the text anyway, must not
// schedule: the engine reports `loop_detected`, another error, or overflows its stack (the
// loops TaskJuggler's own walk misses, dep-loops.ts). Accepted links never loop.
// Needs the built engine (npm run build:engine); skipped without it unless EDIT_ENGINE=1.
import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bootNodeEngine } from '../../../../engine/golden/run-wasm.mjs';
import { ROOT } from '../../../../tests/grammar/corpus';
import type { ScheduleResult } from '../../../engine/protocol';
import { lastSite } from '../index';
import { applyIntent, buildEdit } from './apply';
import { depOnEnd } from './dep-graph';
import { isAncestor, linkItems, unprefixed } from './deps-links';
import { appendOrInsert } from './lists';
import { intentArb, LINK_TYPES, linkCorpora, rebuilt, type LinkCorpus } from './links-testing';
import { taskRefText } from './refs';
import { textsAfter } from './testing';
import type { EditIntent, EditResult } from './types';

const ENGINE = path.join(ROOT, 'public/engine/manifest.json');
const REQUIRED = process.env['EDIT_ENGINE'] === '1';
const SLOW = new Set(['upstream-fedora-20', 'syn-20-scale-1000']);
/** Edits scheduled per intent type, and forced cycles checked (about 2.5 s each in all). */
const CASES = Number(process.env['LINK_ENGINE_RUNS'] ?? 10);
const SEED = Number(process.env['LINK_ENGINE_SEED'] ?? 1109);

type Engine = Awaited<ReturnType<typeof bootNodeEngine>>;
let revision = 0;

function schedule(engine: Engine, c: LinkCorpus, files: Record<string, string>): ScheduleResult {
	return engine.schedule({ files, entry: c.snap.entry, revision: ++revision, options: {} });
}

const texts = (c: LinkCorpus): Record<string, string> => {
	const out: Record<string, string> = {};
	for (const [p, f] of c.snap.files) out[p] = f.text.toString();
	return out;
};

const errorIds = (r: ScheduleResult): string[] =>
	r.messages.filter((m) => m.level === 'error' || m.level === 'fatal').map((m) => m.id);

/**
 * Errors that depend on the computed schedule (fixed dates against a new dependency, resource
 * capacity against a removed allocation). The edit API cannot foresee them without scheduling,
 * which only the engine does, so for corpus plans they count as a conflicting edit, not as a
 * broken one. Every other new error (task_depend_*, loop_end, milestone_*, container_*,
 * effort_no_allocations, task_underspecified, …) is a failure.
 */
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
	'not_scheduled',
]);

/** Calendar minutes a gap stands for at least (working days of 8 hours, weeks of 5 days). */
function gapMinutes(g: { kind: string; value: string }): number {
	const m = /^(\d+)(min|h|d|w)$/.exec(g.value);
	if (!m) return 0;
	const n = Number(m[1]);
	const work = g.kind === 'gaplength';
	const unit = { min: 1, h: 60, d: work ? 480 : 1440, w: work ? 2400 : 10080 }[m[2] as 'min'];
	return n * unit;
}

/** The leaf resources a resource stands for (itself, or its group's leaves). */
function leaves(c: LinkCorpus, id: string): string[] {
	const r = c.index.resources.get(id);
	if (!r || r.children.length === 0) return [id];
	return r.children.flatMap((x) => leaves(c, x));
}

/**
 * Whether a leaf resource was free over the task's whole base window (no booking of any task),
 * so a new allocation must book it; resources with their own calendar and tasks with `limits`
 * are not judged.
 */
function idle(c: LinkCorpus, base: ScheduleResult, task: string, leaf: string): boolean {
	const sc = base.project?.scenarios[0]?.id ?? 'plan';
	const t = base.tasks.find((x) => x.id === task)?.scenarios[sc];
	// Own limits, working hours, leaves or shifts can keep a free resource from the task's slots.
	const CALENDAR = ['limits', 'workinghours', 'leaves', 'vacation', 'shifts', 'shift'];
	const limited = (attrs: ReadonlyArray<{ keyword: string }>): boolean =>
		attrs.some((a) => CALENDAR.includes(a.keyword));
	if (!t || t.start === null || t.end === null) return false;
	if (limited(c.index.resources.get(leaf)?.attrs ?? [])) return false;
	if (limited(c.index.tasks.get(task)?.attrs ?? [])) return false;
	const { start, end } = { start: t.start, end: t.end };
	return !base.bookings.some(
		(b) =>
			b.resource === leaf &&
			b.scenario === sc &&
			b.intervals.some(([s, e]) => s < end && e > start),
	);
}

function effectProblem(
	after: LinkCorpus,
	base: ScheduleResult,
	res: ScheduleResult,
	intent: EditIntent,
): string | null {
	const sc = res.project?.scenarios[0]?.id ?? 'plan';
	const at = (id: string) => res.tasks.find((t) => t.id === id)?.scenarios[sc] ?? null;
	const booked = (task: string): Set<string> =>
		new Set(
			res.bookings.filter((b) => b.task === task && b.scenario === sc).map((b) => b.resource),
		);
	const effortLeaf = (task: string): boolean => {
		const sym = after.index.tasks.get(task);
		return !!sym && sym.children.length === 0 && sym.attrs.some((a) => a.keyword === 'effort');
	};
	switch (intent.type) {
		case 'addDepends':
		case 'setDependsGap': {
			const items = linkItems(after.index, intent.task, intent.target).filter((d) =>
				unprefixed(after.index, d.scenario),
			);
			const gap = intent.type === 'setDependsGap' && intent.gap ? gapMinutes(intent.gap) : 0;
			const s = at(intent.task);
			const p = at(intent.target);
			if (!s?.scheduled || !p?.scheduled || s.start === null || p.end === null) return null;
			for (const d of items) {
				const onEnd = depOnEnd(after.snap, d);
				const ok =
					d.form === 'depends'
						? (s.start ?? 0) >= (onEnd ? (p.end ?? 0) : (p.start ?? 0)) + gap
						: (p.end ?? 0) + gap <= (onEnd ? (s.end ?? 0) : (s.start ?? 0));
				if (!ok) return `${d.form} ${d.written}: ${JSON.stringify({ s, p, gap })}`;
			}
			return null;
		}
		case 'addAllocation':
		case 'replaceAllocation':
		case 'allocate': {
			const wanted =
				intent.type === 'addAllocation'
					? [intent.resource]
					: intent.type === 'replaceAllocation'
						? [intent.to]
						: intent.resources;
			if (!effortLeaf(intent.task) || !at(intent.task)?.scheduled) return null;
			const b = booked(intent.task);
			for (const w of wanted) {
				const ls = leaves(after, w);
				if (ls.some((l) => idle(after, base, intent.task, l)) && !ls.some((l) => b.has(l)))
					return `${w} was free but books nothing`;
			}
			if (intent.type === 'allocate') {
				const allowed = new Set(intent.resources.flatMap((r) => leaves(after, r)));
				for (const x of b) if (!allowed.has(x)) return `${x} still books the task`;
			}
			return null;
		}
		case 'removeAllocation': {
			const still = after.index.allocations.some(
				(a) =>
					a.resource !== null &&
					(a.task === intent.task ||
						(a.task !== null && isAncestor(after.index, a.task, intent.task))) &&
					leaves(after, a.resource).includes(intent.resource),
			);
			return !still && booked(intent.task).has(intent.resource) ? 'still booked' : null;
		}
		default:
			return null;
	}
}

/** The addDepends text change without the loop check, as a forced edit. */
function forcedDepends(c: LinkCorpus, task: string, target: string): EditResult | null {
	const succ = c.index.tasks.get(task);
	if (!succ) return null;
	const last = lastSite(succ.attrs, 'depends', null, c.index.scenarios[0]?.id ?? null);
	const r = appendOrInsert(
		(p) => c.snap.files.get(p),
		last?.statement ?? null,
		succ.decl.block,
		'depends',
		taskRefText(task, target),
	);
	if ('status' in r) return null;
	return buildEdit(c.snap, { type: 'addDepends', task, target }, r.ops);
}

describe.skipIf(!REQUIRED && !fs.existsSync(ENGINE))('link intents still schedule', () => {
	it('keeps golden plans scheduling, with each intent taking effect', async () => {
		let engine = await bootNodeEngine({ log: () => {} });
		let crashed = false;
		const plans: Array<{ c: LinkCorpus; base: ScheduleResult }> = [];
		for (const c of linkCorpora()) {
			if (c.golden === null || SLOW.has(c.golden)) continue;
			const base = schedule(engine, c, texts(c));
			if (base.ok) plans.push({ c, base });
		}
		expect(plans.length).toBeGreaterThan(20);
		const failures: string[] = [];
		const counts: Record<string, number> = {};
		let conflicts = 0;
		const sampledCycles: Array<{ c: LinkCorpus; task: string; target: string }> = [];
		const run = (c: LinkCorpus, base: ScheduleResult, intent: EditIntent): void => {
			const r = applyIntent(c.snap, c.index, intent);
			if (r.status === 'refused' && r.reason === 'cycle' && intent.type === 'addDepends') {
				sampledCycles.push({ c, task: intent.task, target: intent.target });
			}
			if (r.status !== 'edit') return;
			counts[intent.type] = (counts[intent.type] ?? 0) + 1;
			const label = `${c.golden} ${JSON.stringify(intent)}`;
			let res: ScheduleResult;
			try {
				res = schedule(engine, c, textsAfter(c.snap, r));
			} catch (e) {
				failures.push(`${label}: engine failure ${String(e)}`);
				crashed = true;
				return;
			}
			const fresh = errorIds(res).filter((id) => !errorIds(base).includes(id));
			if (res.messages.some((m) => m.id === 'loop_detected')) failures.push(`${label}: loop`);
			if (fresh.length > 0 && fresh.every((id) => SCHEDULE_DEPENDENT.has(id))) {
				conflicts++;
				return;
			}
			if (!res.ok || fresh.length > 0) {
				failures.push(`${label}: ok ${res.ok}, new ${fresh.join(',')}`);
				return;
			}
			const p = effectProblem(rebuilt(c.snap, r), base, res, intent);
			if (p) failures.push(`${label}: ${p}`);
		};
		for (const type of LINK_TYPES) {
			const arb = fc
				.integer({ min: 0, max: plans.length - 1 })
				.chain((i) => fc.tuple(fc.constant(i), intentArb((plans[i] as (typeof plans)[0]).c, type)));
			for (const [i, intent] of fc.sample(arb, { numRuns: CASES * 3, seed: SEED })) {
				const { c, base } = plans[i] as (typeof plans)[0];
				if ((counts[type] ?? 0) >= CASES) break;
				run(c, base, intent);
				if (crashed) {
					// A crash leaves the engine unusable; boot a fresh one for the remaining cases.
					engine = await bootNodeEngine({ log: () => {} });
					crashed = false;
				}
			}
		}
		// Forced cycles: links back along existing ones, then the sampled `cycle` refusals (the
		// Tutorial's gui -> test is one TaskJuggler's own walk misses).
		const candidates = [
			...plans.flatMap(({ c }) =>
				c.index.dependencies.map((d) => ({ c, task: d.pred ?? '', target: d.succ ?? '' })),
			),
			...sampledCycles,
		];
		const tutorial = plans.find((p) => p.c.golden === 'upstream-tutorial')?.c;
		if (tutorial)
			candidates.unshift({ c: tutorial, task: 'AcSo.software.gui', target: 'AcSo.test' });
		let cycles = 0;
		let reversed = 0;
		const cycleOutcomes: Record<string, number> = {};
		for (const { c, task, target } of candidates) {
			const sampled = sampledCycles.some(
				(x) => x.c === c && x.task === task && x.target === target,
			);
			if (!sampled && reversed >= CASES) continue;
			const r = applyIntent(c.snap, c.index, { type: 'addDepends', task, target });
			if (r.status !== 'refused' || r.reason !== 'cycle') continue;
			if (task === target || isAncestor(c.index, task, target) || isAncestor(c.index, target, task))
				continue;
			const forced = forcedDepends(c, task, target);
			if (forced?.status !== 'edit') continue;
			cycles++;
			if (!sampled) reversed++;
			let res: ScheduleResult | null = null;
			try {
				res = schedule(engine, c, textsAfter(c.snap, forced));
			} catch {
				// A stack overflow in the scheduler: the plan cannot schedule. Reboot the engine.
				engine = await bootNodeEngine({ log: () => {} });
			}
			const how =
				res === null
					? 'crash'
					: res.messages.some((m) => m.id === 'loop_detected')
						? 'loop_detected'
						: res.ok
							? 'ok'
							: 'error';
			cycleOutcomes[how] = (cycleOutcomes[how] ?? 0) + 1;
			if (how === 'ok') failures.push(`${c.golden}: ${task} -> ${target} refused, but schedules`);
		}
		console.log(
			`link intents scheduled: ${JSON.stringify(counts)}, schedule-dependent conflicts ` +
				`${conflicts}, forced cycles ${JSON.stringify(cycleOutcomes)}`,
		);
		expect(failures).toEqual([]);
		for (const type of LINK_TYPES) expect(counts[type] ?? 0).toBeGreaterThanOrEqual(3);
		expect(cycles).toBeGreaterThanOrEqual(3);
	}, 600_000);
});
