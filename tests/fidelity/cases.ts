// SPDX-License-Identifier: GPL-2.0-or-later
// Builds fidelity cases: one plan and one intent, a function of one integer seed. Generated cases print
// a random plan (gen/) and read the oracle from the printer's record; corpus cases take a golden plan
// and read the oracle from the index (oracle.ts). The intent type of case number `n` cycles through
// the enforced types, so every type gets its share of the cases.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EditIntent, IntentType } from '../../src/lib/tjp/edit/types';
import { buildIndex } from '../../src/lib/tjp/index';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import { loadCorpus as loadGoldens, REPO } from '../golden/corpus';
import { realApply, type Case } from './harness';
import type { Aim } from './families/types';
import { ENFORCED, familyOf } from './families';
import { semOf, type Facts, type Sem } from './gen/facts';
import { genPlan } from './gen/model';
import { printPlan } from './gen/print-plan';
import { mixSeed, Rng } from './gen/rng';
import { factsFromIndex } from './oracle';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const NOW = '2026-01-05T09:00:00Z';

/** The intent type of case number `n`. */
export const typeOfCase = (n: number): IntentType => ENFORCED[n % ENFORCED.length] as IntentType;

/** The types a case aimed at text-only text can have (the families that write such targets). */
export const TEXT_ONLY_TYPES: readonly IntentType[] = [
	'setAttr',
	'removeAttr',
	'renameTask',
	'addDepends',
	'allocate',
	'addAllocation',
];

/** Whether the edit API makes an edit of this intent on these files (a probe for `generatedCase`). */
function edits(entry: string, files: Record<string, string>, intent: EditIntent): boolean {
	const snap = createWorkspace({ entry, files }).snapshot();
	return realApply(snap, buildIndex(snap, undefined, { cache: null }), intent).status === 'edit';
}

/**
 * A generated case; plans that offer no target for the type are redrawn with the next attempt. Six
 * cases in seven are drawn until the edit API makes an edit, so that every type gets edits to check; the
 * seventh keeps whatever the draw gave, which is where the no-ops and ordinary refusals come from. With
 * `aim` the plan is rich in macros and the intent aims at text-only text.
 */
export function generatedCase(seed: number, type: IntentType, aim?: Aim): Case {
	const family = familyOf(type);
	const seek = !aim && mixSeed(seed, 5) % 7 !== 0;
	let fallback: Case | null = null;
	for (let attempt = 0; attempt < 40; attempt++) {
		const rng = new Rng(mixSeed(seed, attempt));
		const plan = genPlan(rng, {
			...(type === 'format' ? { sloppy: true } : {}),
			...(aim ? { rich: true } : {}),
		});
		plan.seed = seed;
		const { files, facts } = printPlan(plan, rng);
		const sem = semOf(facts);
		const drawn = family.draw(type, facts, sem, rng, aim);
		if (!drawn) continue;
		const made: Case = {
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
			...(aim ? { aim } : {}),
		};
		if (!seek || drawn.mustRefuse || edits(facts.entry, files, drawn.intent)) return made;
		fallback ??= made;
	}
	if (fallback) return fallback;
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

interface CorpusList {
	basis: string;
	measuredMs: Record<string, number>;
	push: string[];
	nightlyExtra: Record<string, number>;
}

/**
 * The corpus lists (corpus.json): which golden plans a push run draws from, chosen from engine times
 * measured once and committed with them, and the plans the nightly run adds with their case counts. Nothing
 * here depends on the machine, a report or the environment, so a case replays anywhere.
 */
export const CORPUS: CorpusList = JSON.parse(
	fs.readFileSync(path.join(HERE, 'corpus.json'), 'utf8'),
) as CorpusList;
export const NIGHTLY_EXTRA: Readonly<Record<string, number>> = CORPUS.nightlyExtra;

const loaded = new Map<string, CorpusPlan | null>();

/** A golden plan by id with its index facts (read once); null when it has no task. */
export function corpusPlan(id: string): CorpusPlan | null {
	if (loaded.has(id)) return loaded.get(id) ?? null;
	const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
	const found = loadGoldens().find((e) => e.plan.id === id);
	if (!found) throw new Error(`corpus.json names an unknown plan: ${id}`);
	const { plan, golden } = found;
	const files: Record<string, string> = {};
	for (const f of golden.files)
		files[f] = decoder.decode(fs.readFileSync(path.join(REPO, plan.root, f)));
	const snap = createWorkspace({ entry: golden.entry, files }).snapshot();
	const facts = factsFromIndex(snap, buildIndex(snap, undefined, { cache: null }));
	const out =
		facts.tasks.length === 0
			? null
			: {
					id,
					entry: golden.entry,
					files,
					facts,
					sem: semOf(facts),
					now: golden.options.now,
					workerMs: CORPUS.measuredMs[id] ?? 0,
				};
	loaded.set(id, out);
	return out;
}

/** The plans of the per-push list that have a task. */
export const corpusPlans = (): CorpusPlan[] =>
	CORPUS.push.map(corpusPlan).filter((p): p is CorpusPlan => p !== null);

const hash = (s: string): number =>
	[...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

/**
 * A corpus case: a golden plan and an intent drawn against its index facts. The plan is `pin` when given
 * (and offers a target), else chosen from the per-push list by the seed; a plan that offers none passes the
 * turn to the next. The intent is drawn from a stream of (seed, plan), so replaying with the plan a case
 * ran on (`replayLine`) reproduces it.
 */
export function corpusCase(seed: number, type: IntentType, pin?: string): Case {
	const family = familyOf(type);
	const list = CORPUS.push;
	const start = seed % list.length;
	const order = [
		...(pin ? [pin] : []),
		...list.map((_, i) => list[(start + i) % list.length] as string),
	];
	for (const id of order) {
		const p = corpusPlan(id);
		if (!p) continue;
		const drawn = family.draw(type, p.facts, p.sem, new Rng(mixSeed(seed, hash(id))));
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
