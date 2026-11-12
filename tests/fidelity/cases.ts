// SPDX-License-Identifier: GPL-2.0-or-later
// Builds fidelity cases: one plan and one intent, a function of one integer seed. Generated cases print
// a random plan (gen/) and read the oracle from the printer's record; corpus cases take a golden plan
// and read the oracle from the index (oracle.ts). The intent type of case number `n` cycles through
// the enforced types, so every type gets its share of the cases.
import fs from 'node:fs';
import path from 'node:path';
import type { IntentType } from '../../src/lib/tjp/edit/types';
import { buildIndex } from '../../src/lib/tjp/index';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import { loadCorpus as loadGoldens, REPO } from '../golden/corpus';
import type { Case } from './harness';
import { ENFORCED, familyOf } from './families';
import { semOf, type Facts, type Sem } from './gen/facts';
import { genPlan } from './gen/model';
import { printPlan } from './gen/print-plan';
import { mixSeed, Rng } from './gen/rng';
import { factsFromIndex } from './oracle';

export const NOW = '2026-01-05T09:00:00Z';

/** The intent type of case number `n`. */
export const typeOfCase = (n: number): IntentType => ENFORCED[n % ENFORCED.length] as IntentType;

/** A generated case; plans that offer no target for the type are redrawn with the next attempt. */
export function generatedCase(seed: number, type: IntentType): Case {
	const family = familyOf(type);
	for (let attempt = 0; attempt < 40; attempt++) {
		const rng = new Rng(mixSeed(seed, attempt));
		const plan = genPlan(rng, type === 'format' ? { sloppy: true } : {});
		plan.seed = seed;
		const { files, facts } = printPlan(plan, rng);
		const sem = semOf(facts);
		const drawn = family.draw(type, facts, sem, rng);
		if (!drawn) continue;
		return {
			seed,
			source: 'generated',
			name: `plan ${seed}.${attempt}`,
			type,
			entry: facts.entry,
			files,
			facts,
			sem,
			drawn,
			family,
			now: NOW,
		};
	}
	throw new Error(`no plan offered a target for ${type} (seed ${seed})`);
}

export interface CorpusPlan {
	readonly id: string;
	readonly entry: string;
	readonly files: Readonly<Record<string, string>>;
	readonly facts: Facts;
	readonly sem: Sem;
	readonly now: string | null;
	readonly workerMs: number;
}

/** Worker times from the last golden run, else the native ones (a proxy; documented in the report). */
function plansTiming(): { ms: Map<string, number>; basis: string } {
	const ms = new Map<string, number>();
	try {
		const report = JSON.parse(
			fs.readFileSync(path.join(REPO, 'test-results/golden-report.json'), 'utf8'),
		) as {
			rows: Array<{ id: string; workerMs: number | null }>;
		};
		for (const r of report.rows) if (r.workerMs !== null && !ms.has(r.id)) ms.set(r.id, r.workerMs);
		if (ms.size > 0) return { ms, basis: 'worker totalMs from test-results/golden-report.json' };
	} catch {
		// No report: use the native times.
	}
	for (const e of loadGoldens()) if (e.native) ms.set(e.plan.id, e.native.totalMs);
	return {
		ms,
		basis: 'native totalMs from engine/golden/native-timings.json (no golden report found)',
	};
}

let corpusCache: { plans: CorpusPlan[]; basis: string; maxMs: number } | null = null;

/** The golden plans whose engine time is under `maxMs` (default 500), with their index facts. */
export function corpusPlans(maxMs = Number(process.env['FIDELITY_CORPUS_MAX_MS'] ?? 500)): {
	plans: CorpusPlan[];
	basis: string;
	maxMs: number;
} {
	if (corpusCache && corpusCache.maxMs === maxMs) return corpusCache;
	const { ms, basis } = plansTiming();
	const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
	const plans: CorpusPlan[] = [];
	for (const { plan, golden } of loadGoldens()) {
		const t = ms.get(plan.id);
		if (t === undefined || t >= maxMs) continue;
		const files: Record<string, string> = {};
		for (const f of golden.files)
			files[f] = decoder.decode(fs.readFileSync(path.join(REPO, plan.root, f)));
		const snap = createWorkspace({ entry: golden.entry, files }).snapshot();
		const index = buildIndex(snap, undefined, { cache: null });
		const facts = factsFromIndex(snap, index);
		if (facts.tasks.length === 0) continue;
		plans.push({
			id: plan.id,
			entry: golden.entry,
			files,
			facts,
			sem: semOf(facts),
			now: golden.options.now,
			workerMs: t,
		});
	}
	corpusCache = { plans, basis, maxMs };
	return corpusCache;
}

/** A corpus case: a golden plan and an intent drawn against its index facts. */
export function corpusCase(seed: number, type: IntentType): Case {
	const family = familyOf(type);
	const { plans } = corpusPlans();
	for (let attempt = 0; attempt < 60; attempt++) {
		const rng = new Rng(mixSeed(seed, attempt));
		const p = rng.pick(plans);
		const drawn = family.draw(type, p.facts, p.sem, rng);
		if (!drawn) continue;
		return {
			seed,
			source: 'corpus',
			name: p.id,
			type,
			entry: p.entry,
			files: p.files,
			facts: p.facts,
			sem: p.sem,
			drawn,
			family,
			now: p.now,
		};
	}
	throw new Error(`no corpus plan offered a target for ${type} (seed ${seed})`);
}
