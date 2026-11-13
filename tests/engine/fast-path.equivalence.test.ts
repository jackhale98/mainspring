// SPDX-License-Identifier: GPL-2.0-or-later
// The fast-path spike's equivalence suite (phase-2.md section 12, step 4; T19). The real engine
// (the built public/engine bundle, booted in Node by bootNodeEngine) runs each in-place value
// rewrite twice: fast, from the kept parse of the text before the rewrite, and in full, from the
// rewritten text. The two results must be equal as canonical JSON, `revision` and `timings`
// aside: tasks, resources, bookings, messages with their lines. A case may fall back to a full
// run (the bridge cannot vouch for it); it must match all the same, and the fallbacks are counted
// by reason.
//
// Cases:
// - every golden plan: FAST_PATH_CORPUS_EDITS rewrites each (default 6), plus one patch of
//   several rewrites;
// - FAST_PATH_RUNS generated plans of the fidelity generator (default 500, one or two rewrites
//   each, with `options.now` fixed so that the clock cannot move between runs);
// - FAST_PATH_DIRECTION_RUNS plans of the direction family (default 100; fast-path-cases.ts
//   `directionPlan`): start and end with statements that set the direction in the `late`
//   scenario or both, every start and end line rewritten whether or not the main thread would
//   offer it;
// - a shuffled replay of a sample through the same engine, with unrelated full runs in between,
//   to catch state left behind by a run (FAST_PATH_SHUFFLED limits its plans; default all).
// FAST_PATH_SEED seeds it all; FAST_PATH_PLANS limits the golden plans for a replay.
//
// Opt-in (FAST_PATH=1): it boots the engine and runs a few thousand schedules. Writes
// test-results/fast-path-equivalence.json.
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { bootNodeEngine } from '../../engine/golden/run-wasm.mjs';
import type { ScheduleRequest, ScheduleResult } from '../../src/engine/protocol';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import { goldenHints } from '../fidelity/oracle';
import { genPlan } from '../fidelity/gen/model';
import { printPlan } from '../fidelity/gen/print-plan';
import { mixSeed } from '../fidelity/gen/rng';
import { loadCorpus, planRequest, REPO } from '../golden/corpus';
import {
	canonicalResult,
	directionPlan,
	eligibleSites,
	indexOf,
	newValue,
	rawDateRewrites,
	rewrite,
	Rng,
	type Rewrite,
} from './fast-path-cases';

const ENGINE = path.join(REPO, 'public/engine/manifest.json');
const ON = process.env['FAST_PATH'] === '1';
const num = (name: string, dflt: number): number => {
	const v = process.env[name];
	return v === undefined || v === '' ? dflt : Number(v);
};
const RUNS = num('FAST_PATH_RUNS', 500);
const DIRECTION_RUNS = num('FAST_PATH_DIRECTION_RUNS', 100);
/** FAST_PATH_SHUFFLED=n: at most n plans in the shuffled replay; default all of its sample. */
const SHUFFLED = num('FAST_PATH_SHUFFLED', Infinity);
const CORPUS_EDITS = num('FAST_PATH_CORPUS_EDITS', 6);
const SEED = num('FAST_PATH_SEED', 20261113);
/** FAST_PATH_PLANS=a,b: only these golden plans (a replay); default all. */
const ONLY = (process.env['FAST_PATH_PLANS'] ?? '').split(',').filter(Boolean);
const GENERATED_NOW = '2026-03-02T09:00:00Z';

type Engine = { schedule(r: ScheduleRequest): ScheduleResult };

interface Plan {
	readonly name: string;
	readonly request: Omit<ScheduleRequest, 'revision'>;
	readonly rewrites: readonly Rewrite[];
	/** Several rewrites of one plan in one patch, when the plan has two or more. */
	readonly multi: readonly Rewrite[] | null;
}

interface Checked {
	readonly plan: string;
	readonly edits: string;
	readonly path: 'fast' | 'full';
	readonly fallback: string | null;
	readonly fullMs: number;
	readonly fastMs: number;
}

const report = {
	seed: SEED,
	runs: RUNS,
	cases: 0,
	fast: 0,
	fallbacks: {} as Record<string, number>,
	differences: [] as string[],
	clockMoved: 0,
	shuffled: { cases: 0, differences: 0 },
	plans: { corpus: 0, generated: 0, direction: 0, withoutSites: 0 },
};

let engine: Engine;
let revision = 0;
const run = (request: Omit<ScheduleRequest, 'revision'>): ScheduleResult =>
	engine.schedule({ ...request, revision: ++revision });

/** Rewrites of a workspace's eligible sites, at most `count`, seeded. */
function rewritesOf(
	request: Omit<ScheduleRequest, 'revision'>,
	hints: Parameters<typeof indexOf>[1],
	rng: Rng,
	count: number,
): { rewrites: Rewrite[]; multi: Rewrite[] | null } {
	const ws = createWorkspace({ entry: request.entry, files: request.files });
	const index = indexOf(ws, hints);
	const sites = eligibleSites(ws, index);
	const rewrites: Rewrite[] = [];
	const used = new Set<number>();
	for (let tries = 0; rewrites.length < count && tries < count * 4 && sites.length > 0; tries++) {
		const i = rng.int(0, sites.length - 1);
		if (used.has(i)) continue;
		used.add(i);
		const site = sites[i];
		if (!site) continue;
		const r = rewrite(ws, index, site, newValue(site, rng));
		if (r) rewrites.push(r);
	}
	// A patch of up to three rewrites on different lines, applied one after another.
	let multi: Rewrite[] | null = null;
	if (rewrites.length >= 2) {
		const picked = rewrites.slice(0, 3).filter(
			(r, i, all) => all.findIndex((o) => o.edit.file === r.edit.file && o.edit.line === r.edit.line) === i,
		);
		let files: Record<string, string> = { ...request.files };
		for (const r of picked) {
			const lines = (files[r.edit.file] ?? '').split('\n');
			const edited = (r.files[r.edit.file] ?? '').split('\n');
			lines[r.edit.line - 1] = edited[r.edit.line - 1] ?? '';
			files = { ...files, [r.edit.file]: lines.join('\n') };
		}
		multi = picked.map((r) => ({ ...r, files }));
	}
	return { rewrites, multi };
}

/** Base (kept), fast and full runs of a plan's rewrites; returns what each case gave. */
function check(plan: Plan): Checked[] {
	const out: Checked[] = [];
	const patches = [...plan.rewrites.map((r) => [r]), ...(plan.multi ? [plan.multi] : [])];
	if (patches.length === 0) return out;
	const base = run({ ...plan.request, retain: true });
	const fast = patches.map((p) => {
		const files = p[0]?.files ?? plan.request.files;
		return run({
			...plan.request,
			files,
			fast: { base: base.revision, edits: p.map((r) => r.edit) },
		});
	});
	patches.forEach((p, i) => {
		const f = fast[i];
		if (!f) return;
		const full = run({ ...plan.request, files: p[0]?.files ?? plan.request.files });
		const edits = p.map((r) => `${r.edit.task} ${r.edit.attribute} ${r.site.value} -> ${r.edit.value}`).join('; ');
		report.cases++;
		if (base.project?.now !== full.project?.now) {
			// The plan reads the clock and the hour turned between the runs: not comparable.
			report.clockMoved++;
			return;
		}
		const fellBack = f.timings.path !== 'fast';
		if (fellBack) {
			const reason = (f.timings.fastFallback ?? 'none').replace(/\d+/g, 'N').slice(0, 80);
			report.fallbacks[reason] = (report.fallbacks[reason] ?? 0) + 1;
		} else report.fast++;
		if (canonicalResult(f) !== canonicalResult(full)) {
			report.differences.push(`${plan.name}: ${edits} (${f.timings.path})`);
		}
		out.push({
			plan: plan.name,
			edits,
			path: fellBack ? 'full' : 'fast',
			fallback: f.timings.fastFallback ?? null,
			fullMs: full.timings.totalMs,
			fastMs: f.timings.totalMs,
		});
	});
	return out;
}

const corpusPlans: Plan[] = [];
const generatedPlans: Plan[] = [];
const directionPlans: Plan[] = [];

describe.skipIf(!ON || !fs.existsSync(ENGINE))('fast path: equal to a full run', () => {
	beforeAll(async () => {
		engine = (await bootNodeEngine({ log: () => {} })) as unknown as Engine;
		const rng = new Rng(SEED);
		for (const c of loadCorpus()) {
			if (ONLY.length > 0 && !ONLY.includes(c.plan.id)) continue;
			const request = planRequest(c.plan, c.golden, 0);
			const ws = createWorkspace({ entry: request.entry, files: request.files });
			const hints = goldenHints(c.golden.result, ws.snapshot());
			const { revision: _r, ...req } = request;
			const { rewrites, multi } = rewritesOf(req, hints, rng, CORPUS_EDITS);
			corpusPlans.push({ name: c.plan.id, request: req, rewrites, multi });
		}
		for (let n = 0; n < RUNS; n++) {
			const prng = new Rng(mixSeed(SEED, n));
			const { files, facts } = printPlan(genPlan(prng), prng);
			const req = { files, entry: facts.entry, options: { now: GENERATED_NOW } };
			const { rewrites, multi } = rewritesOf(req, undefined, prng, prng.int(1, 2));
			generatedPlans.push({ name: `generated ${SEED}:${n}`, request: req, rewrites, multi });
		}
		for (let n = 0; n < DIRECTION_RUNS; n++) {
			const prng = new Rng(mixSeed(SEED ^ 0xd1, n));
			const req = { files: directionPlan(prng), entry: 'plan.tjp', options: { now: GENERATED_NOW } };
			const ws = createWorkspace({ entry: req.entry, files: req.files });
			// Every start and end line, offered or not, then what fast-patch.ts offers.
			const raw = rawDateRewrites(ws, indexOf(ws), prng);
			const offered = rewritesOf(req, undefined, prng, 2);
			directionPlans.push({
				name: `direction ${SEED}:${n}`,
				request: req,
				rewrites: [...raw, ...offered.rewrites],
				multi: offered.multi,
			});
		}
	}, 600_000);

	it('every golden plan', () => {
		for (const p of corpusPlans) {
			report.plans.corpus++;
			if (p.rewrites.length === 0) report.plans.withoutSites++;
			check(p);
		}
		expect(report.differences).toEqual([]);
	}, 3_600_000);

	it(`${RUNS} generated plans`, () => {
		for (const p of generatedPlans) {
			report.plans.generated++;
			if (p.rewrites.length === 0) report.plans.withoutSites++;
			check(p);
		}
		expect(report.differences).toEqual([]);
	}, 3_600_000);

	it(`${DIRECTION_RUNS} direction plans: start and end with late: statements`, () => {
		for (const p of directionPlans) {
			report.plans.direction++;
			if (p.rewrites.length === 0) report.plans.withoutSites++;
			check(p);
		}
		expect(report.differences).toEqual([]);
	}, 3_600_000);

	it('a shuffled replay through the same engine, with unrelated full runs between', () => {
		const rng = new Rng(mixSeed(SEED, 0x5f));
		const sample = [...corpusPlans.filter((p) => p.rewrites.length > 0), ...generatedPlans.filter((p) => p.rewrites.length > 0).slice(0, 60)];
		for (let i = sample.length - 1; i > 0; i--) {
			const j = rng.int(0, i);
			[sample[i], sample[j]] = [sample[j] as Plan, sample[i] as Plan];
		}
		sample.splice(SHUFFLED);
		const references = new Map<Rewrite, string>();
		for (const p of sample) {
			const r = p.rewrites[0];
			if (r) references.set(r, canonicalResult(run({ ...p.request, files: r.files })));
		}
		for (const p of sample) {
			const r = p.rewrites[0];
			if (!r) continue;
			// Something unrelated in between, sometimes with a base of its own.
			const other = sample[rng.int(0, sample.length - 1)];
			if (other && rng.chance(0.5)) run({ ...other.request, retain: rng.chance(0.5) });
			const base = run({ ...p.request, retain: true });
			const f = run({ ...p.request, files: r.files, fast: { base: base.revision, edits: [r.edit] } });
			// A second patch from the same base: the kept parse is not changed by a fast run.
			const again = run({ ...p.request, files: r.files, fast: { base: base.revision, edits: [r.edit] } });
			report.shuffled.cases++;
			for (const x of [f, again]) {
				if (canonicalResult(x) !== references.get(r)) {
					report.shuffled.differences++;
					report.differences.push(`shuffled ${p.name}: ${r.edit.task} ${r.edit.attribute} (${x.timings.path})`);
				}
			}
		}
		expect(report.differences).toEqual([]);
	}, 3_600_000);

	it('writes the report', () => {
		const file = path.join(REPO, 'test-results', 'fast-path-equivalence.json');
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
		console.info(JSON.stringify(report, null, 2));
		expect(report.fast).toBeGreaterThan(0);
	});
});
