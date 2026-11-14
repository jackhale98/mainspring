// SPDX-License-Identifier: GPL-2.0-or-later
// One engine's memory stays bounded over many full runs (engine/bridge/wasm/tj_wasm_jumps.rb).
// WebAssembly memory never shrinks, so a run that leaves anything behind shows as growth of
// `timings.memoryBytes`: before the fix every run of a golden plan left about 1.1 MB (8 MB for a
// plan with `extend`), 43 MB per pass over the plans, and a worker failed near 2 GiB after some
// 1,800 runs. Without a leak the memory still creeps up for a while (Ruby's heap meets new
// high-water marks as its collections fall at other points of a run; 122 MB after 100 runs,
// 136 MB after 2,000 in one measurement), so the built engine (npm run build:engine) first runs two
// passes over the golden plans, then ENGINE_MEMORY_PASSES more (default 2), which may add at most
// ENGINE_MEMORY_SLACK_MB (default 20); every result must equal its golden. Opt-in with
// ENGINE_MEMORY=1 (about 25 s per pass here); a missing engine then fails instead of skipping.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootNodeEngine, compareWithGolden, loadCorpus, planRequest } from '../../engine/golden/run-wasm.mjs';
import { REPO } from '../golden/corpus';

const ON = process.env['ENGINE_MEMORY'] === '1';
const ENGINE = path.join(REPO, 'public/engine/manifest.json');
const PASSES = Number(process.env['ENGINE_MEMORY_PASSES'] ?? 2);
const SLACK_MB = Number(process.env['ENGINE_MEMORY_SLACK_MB'] ?? 20);
const WARMUP = 2;
/** syn-20-scale-1000 alone takes longer than the rest together and leaves nothing more. */
const SKIP = new Set(['syn-20-scale-1000']);

interface Golden {
	entry: string;
	files: string[];
	options: { now: string | null };
	result: unknown;
}

const mb = (bytes: number): number => Math.round((bytes / 2 ** 20) * 10) / 10;

describe.skipIf(!ON)('engine memory over many runs', () => {
	it(
		`grows by at most ${SLACK_MB} MB over ${PASSES} passes of the golden plans after ${WARMUP}`,
		async () => {
			expect(fs.existsSync(ENGINE), 'build the engine first: npm run build:engine').toBe(true);
			const corpus = (loadCorpus() as Array<{ plan: { id: string; root: string }; golden: Golden }>).filter(
				(c) => !SKIP.has(c.plan.id),
			);
			const engine = await bootNodeEngine({ log: () => {} });
			let revision = 0;
			const pass = (): number => {
				let memory = 0;
				for (const { plan, golden } of corpus) {
					const result = engine.schedule(planRequest(plan, golden, ++revision));
					expect(compareWithGolden(golden, { ...result }), plan.id).toEqual([]);
					const bytes = result.timings.memoryBytes;
					expect(typeof bytes, 'timings.memoryBytes').toBe('number');
					memory = bytes ?? 0;
				}
				return memory;
			};
			pass();
			const mark = pass();
			const after: number[] = [];
			for (let i = 0; i < PASSES; i++) after.push(pass());
			const last = after.at(-1) ?? mark;
			console.log(
				`engine memory: ${mb(mark)} MB after ${WARMUP * corpus.length} runs, ` +
					`${after.map(mb).join(' MB, ')} MB after each further pass (${PASSES * corpus.length} runs)`,
			);
			expect(mb(last - mark)).toBeLessThanOrEqual(SLACK_MB);
		},
		(PASSES + WARMUP) * 240_000,
	);
});
