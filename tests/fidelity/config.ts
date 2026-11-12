// SPDX-License-Identifier: GPL-2.0-or-later
// Run size and seeds of the fidelity suite. FIDELITY_RUNS (generated cases, default 200),
// FIDELITY_CORPUS_RUNS (corpus cases, default 50, or a tenth of the runs above 200), FIDELITY_SEED and
// FIDELITY_SHARD ("i/n": this shard runs every n-th case of the same sequence, for the nightly job).
import fc from 'fast-check';
import type { IntentType } from '../../src/lib/tjp/edit/types';
import { NIGHTLY_EXTRA, TEXT_ONLY_TYPES, typeOfCase } from './cases';

const num = (name: string, dflt: number): number => {
	const v = process.env[name];
	return v === undefined || v === '' ? dflt : Number(v);
};

const runs = num('FIDELITY_RUNS', 200);
const shard = (process.env['FIDELITY_SHARD'] ?? '0/1').split('/').map(Number) as [number, number];

export const CONFIG = {
	runs,
	/** Extra generated cases aimed at text-only text; they are refused, so they cost no engine time. */
	textOnlyRuns: num('FIDELITY_TEXTONLY_RUNS', runs <= 200 ? 40 : Math.round(runs / 10)),
	corpusRuns: num('FIDELITY_CORPUS_RUNS', runs <= 200 ? 50 : Math.round(runs / 10)),
	seed: num('FIDELITY_SEED', 20261112),
	shard: { index: shard[0] ?? 0, count: shard[1] ?? 1 },
	/** FIDELITY_CORPUS=nightly adds Tutorial and Fedora (corpus.json); the default set is the per-push list. */
	corpus: process.env['FIDELITY_CORPUS'] === 'nightly' ? ('nightly' as const) : ('push' as const),
	/** `FIDELITY_CASE=generated:<seed>:<type>` or `corpus:<seed>:<type>:<plan>` replays one case. */
	only: process.env['FIDELITY_CASE'] ?? null,
};

export interface PlannedCase {
	readonly n: number;
	readonly source: 'generated' | 'corpus';
	readonly seed: number;
	readonly type: IntentType;
	/** For a corpus case: the golden plan it is pinned to (the nightly set pins Tutorial and Fedora). */
	readonly plan?: string;
	/** A generated case aimed at text-only text (macros), which the edit API must refuse. */
	readonly aim?: 'text-only';
}

/** The nightly set gives Tutorial and Fedora their own corpus cases, in blocks at the start of the sequence. */
function nightlyPin(n: number): string | undefined {
	if (CONFIG.corpus !== 'nightly') return undefined;
	let at = 0;
	for (const [plan, count] of Object.entries(NIGHTLY_EXTRA)) {
		if (n < at + count) return plan;
		at += count;
	}
	return undefined;
}

/** The cases of this run: seeds come from fast-check, so a run is a function of FIDELITY_SEED. */
export function plannedCases(kind: 'generated' | 'corpus' | 'all' = 'all'): PlannedCase[] {
	const draw = (count: number, seed: number): number[] =>
		fc.sample(fc.integer({ min: 1, max: 0x7fffffff }), { numRuns: count, seed });
	if (CONFIG.only) {
		const [source, seed, type, extra] = CONFIG.only.split(':') as [
			PlannedCase['source'],
			string,
			PlannedCase['type'],
			string | undefined,
		];
		const more =
			source === 'corpus'
				? extra
					? { plan: extra }
					: {}
				: extra === 'text-only'
					? { aim: 'text-only' as const }
					: {};
		return [{ n: 0, source, seed: Number(seed), type, ...more }];
	}
	const out: PlannedCase[] = [];
	const add = (source: PlannedCase['source'] | 'text-only', count: number, seed: number): void => {
		// The type cycles over the cases this shard runs, so every shard covers every type.
		let local = 0;
		draw(count, seed).forEach((s, n) => {
			if (n % CONFIG.shard.count === CONFIG.shard.index) {
				if (source === 'text-only') {
					const type = TEXT_ONLY_TYPES[local++ % TEXT_ONLY_TYPES.length] as IntentType;
					out.push({ n, source: 'generated', seed: s, type, aim: 'text-only' });
					return;
				}
				const plan = source === 'corpus' ? nightlyPin(n) : undefined;
				out.push({ n, source, seed: s, type: typeOfCase(local++), ...(plan ? { plan } : {}) });
			}
		});
	};
	if (kind !== 'corpus') add('generated', CONFIG.runs, CONFIG.seed);
	if (kind !== 'generated') add('corpus', CONFIG.corpusRuns, CONFIG.seed + 1);
	if (kind !== 'corpus') add('text-only', CONFIG.textOnlyRuns, CONFIG.seed + 2);
	return out;
}
