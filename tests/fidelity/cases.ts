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
import type { Drawn } from './families/types';
import type { Aim } from './families/types';
import { ENFORCED, familyOf } from './families';
import { semOf, type Facts, type Sem } from './gen/facts';
import { genPlan } from './gen/model';
import { printPlan } from './gen/print-plan';
import { mixSeed, Rng } from './gen/rng';
import { factsFromIndex, goldenHints } from './oracle';
import type { ScheduleResult } from '../../src/engine/protocol';

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
export function generatedCase(seed: number, type: IntentType, aim?: Aim, pin?: number): Case {
	const family = familyOf(type);
	// A pinned attempt is the plan and draw of that attempt as they are, whatever the edit API does with
	// them, so a recorded case replays the same intent on any version of the API.
	const seek = pin === undefined && !aim && mixSeed(seed, 5) % 7 !== 0;
	let fallback: Case | null = null;
	for (let attempt = pin ?? 0; attempt < (pin === undefined ? 40 : pin + 1); attempt++) {
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
			attempt,
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
	/** The golden result: its engine hints name tasks the text cannot (Fedora's macro ids). */
	readonly result: Omit<ScheduleResult, 'revision' | 'timings'>;
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
	const hints = goldenHints(golden.result, snap);
	const facts = factsFromIndex(snap, buildIndex(snap, hints, { cache: null }));
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
					result: golden.result,
				};
	loaded.set(id, out);
	return out;
}

/** The plans of the per-push list that have a task. */
export const corpusPlans = (): CorpusPlan[] =>
	CORPUS.push.map(corpusPlan).filter((p): p is CorpusPlan => p !== null);

const hash = (s: string): number =>
	[...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

function corpusOf(p: CorpusPlan, seed: number, type: IntentType, drawn: Drawn): Case {
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
		family: familyOf(type),
		now: p.now,
		result: p.result,
	};
}

/**
 * A corpus case: a golden plan and an intent drawn against its index facts. The intent is drawn from a stream
 * of (seed, plan), so replaying with the plan a case ran on (`replayLine`) reproduces it.
 *
 * Without a pin the plan is chosen from the per-push list by the seed, and a plan that offers no target passes
 * the turn to the next. With a pin (the nightly set pins Tutorial and Fedora) the case stays on that plan: no
 * plan can offer a target for every intent type, so the type moves on to the next one the plan has a target
 * for (the case reports the type it ran), and a plan that has none for any type, or no indexable task, fails
 * loudly instead of falling through to other plans.
 */
export function corpusCase(seed: number, type: IntentType, pin?: string): Case {
	if (pin) {
		const p = corpusPlan(pin);
		if (!p) throw new Error(`the pinned corpus plan ${pin} has no task the index can name`);
		const at = Math.max(0, ENFORCED.indexOf(type));
		for (let i = 0; i < ENFORCED.length; i++) {
			const t = ENFORCED[(at + i) % ENFORCED.length] as IntentType;
			const drawn = familyOf(t).draw(t, p.facts, p.sem, new Rng(mixSeed(seed, hash(pin))));
			if (drawn) return corpusOf(p, seed, t, drawn);
		}
		throw new Error(
			`the pinned corpus plan ${pin} offers no target for any intent type (seed ${seed})`,
		);
	}
	const list = CORPUS.push;
	const start = seed % list.length;
	for (let i = 0; i < list.length; i++) {
		const id = list[(start + i) % list.length] as string;
		const p = corpusPlan(id);
		if (!p) continue;
		const drawn = familyOf(type).draw(type, p.facts, p.sem, new Rng(mixSeed(seed, hash(id))));
		if (drawn) return corpusOf(p, seed, type, drawn);
	}
	throw new Error(`no corpus plan offered a target for ${type} (seed ${seed})`);
}
