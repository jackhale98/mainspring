// SPDX-License-Identifier: GPL-2.0-or-later
// Run size and seeds of the fidelity suite. FIDELITY_RUNS (generated cases, default 200),
// FIDELITY_CORPUS_RUNS (corpus cases, default 50, or a tenth of the runs above 200), FIDELITY_SEED and
// FIDELITY_SHARD ("i/n": this shard runs every n-th case of the same sequence, for the nightly job).
import fc from 'fast-check';
import type { IntentType } from '../../src/lib/tjp/edit/types';
import { typeOfCase } from './cases';

const num = (name: string, dflt: number): number => {
	const v = process.env[name];
	return v === undefined || v === '' ? dflt : Number(v);
};

const runs = num('FIDELITY_RUNS', 200);
const shard = (process.env['FIDELITY_SHARD'] ?? '0/1').split('/').map(Number) as [number, number];

export const CONFIG = {
	runs,
	corpusRuns: num('FIDELITY_CORPUS_RUNS', runs <= 200 ? 50 : Math.round(runs / 10)),
	seed: num('FIDELITY_SEED', 20261112),
	shard: { index: shard[0] ?? 0, count: shard[1] ?? 1 },
	/** `FIDELITY_CASE=generated:<seed>:<type>` replays one case. */
	only: process.env['FIDELITY_CASE'] ?? null,
};

export interface PlannedCase {
	readonly n: number;
	readonly source: 'generated' | 'corpus';
	readonly seed: number;
	readonly type: IntentType;
}

/** The cases of this run: seeds come from fast-check, so a run is a function of FIDELITY_SEED. */
export function plannedCases(kind: 'generated' | 'corpus' | 'all' = 'all'): PlannedCase[] {
	const draw = (count: number, seed: number): number[] =>
		fc.sample(fc.integer({ min: 1, max: 0x7fffffff }), { numRuns: count, seed });
	if (CONFIG.only) {
		const [source, seed, type] = CONFIG.only.split(':') as [
			PlannedCase['source'],
			string,
			PlannedCase['type'],
		];
		return [{ n: 0, source, seed: Number(seed), type }];
	}
	if (CONFIG.only) {
		const [source, seed, type] = CONFIG.only.split(':') as [
			PlannedCase['source'],
			string,
			PlannedCase['type'],
		];
		return [{ n: 0, source, seed: Number(seed), type }];
	}
	const out: PlannedCase[] = [];
	const add = (source: PlannedCase['source'], count: number, seed: number): void => {
		draw(count, seed).forEach((s, n) => {
			if (n % CONFIG.shard.count === CONFIG.shard.index)
				out.push({ n, source, seed: s, type: typeOfCase(n) });
		});
	};
	if (kind !== 'corpus') add('generated', CONFIG.runs, CONFIG.seed);
	if (kind !== 'generated') add('corpus', CONFIG.corpusRuns, CONFIG.seed + 1);
	return out;
}
