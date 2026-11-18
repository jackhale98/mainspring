// SPDX-License-Identifier: GPL-2.0-or-later
// Progress beats on the real engine (engine/bridge/progress.rb, wasm/tj_progress.rb): the built
// bundle booted in Node (engine/golden/run-wasm.mjs). A long run beats while it runs, never after,
// at most once per `progressMs`; beats change no result, even when the listener throws; syntax
// beats too. Needs the built engine (npm run build:engine); skipped without it, except with
// ENGINE_PROGRESS=1 (the CI engine job), where a missing engine fails.
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	bootNodeEngine,
	compareWithGolden,
	loadCorpus,
	planRequest,
} from '../../engine/golden/run-wasm.mjs';
import { REPO } from '../../tests/golden/corpus';
import type { ScheduleRequest } from './protocol';
import type { NodeEngine } from './runtime';

const ENGINE = path.join(REPO, 'public/engine/manifest.json');
const REQUIRED = process.env['ENGINE_PROGRESS'] === '1';

interface Golden {
	entry: string;
	files: string[];
	options: { now: string | null };
	result: unknown;
}

function fedora(revision: number): { request: ScheduleRequest; golden: Golden } {
	const corpus = loadCorpus(['fedora-res']) as Array<{ plan: { root: string }; golden: Golden }>;
	const c = corpus[0];
	if (!c) throw new Error('no golden fedora-res');
	return { request: planRequest(c.plan, c.golden, revision) as ScheduleRequest, golden: c.golden };
}

describe.skipIf(!REQUIRED && !fs.existsSync(ENGINE))('progress beats on the real engine', () => {
	let engine: NodeEngine;
	let coarse: NodeEngine;
	let revision = 0;

	beforeAll(async () => {
		// A 1 ms interval beats at nearly every site, so even a fast machine sees many.
		engine = await bootNodeEngine({ log: () => {}, progressMs: 1 });
		coarse = await bootNodeEngine({ log: () => {} });
	}, 120_000);

	it('beats while fedora-res schedules, only during the call, and leaves the result unchanged', () => {
		const { request, golden } = fedora(++revision);
		let calling = true;
		let beats = 0;
		let outside = 0;
		const result = engine.schedule(request, () => (calling ? beats++ : outside++));
		calling = false;
		expect(compareWithGolden(golden, { ...result })).toEqual([]);
		// Parse, grammar, scheduling and serializer sites: several hundred on this plan.
		expect(beats).toBeGreaterThan(100);
		expect(outside).toBe(0);
		// The next call without a listener: the old one hears nothing.
		const before = beats;
		engine.schedule(fedora(++revision).request);
		expect(beats).toBe(before);
	}, 120_000);

	it('keeps the result when the listener throws', () => {
		const { request, golden } = fedora(++revision);
		let beats = 0;
		const result = engine.schedule(request, () => {
			beats++;
			throw new Error('listener failed');
		});
		expect(beats).toBeGreaterThan(100);
		expect(compareWithGolden(golden, { ...result })).toEqual([]);
	}, 120_000);

	it('beats at most once per progressMs by default (1 s)', () => {
		const { request, golden } = fedora(++revision);
		let beats = 0;
		const t0 = performance.now();
		const result = coarse.schedule(request, () => beats++);
		const ms = performance.now() - t0;
		expect(compareWithGolden(golden, { ...result })).toEqual([]);
		expect(beats).toBeGreaterThanOrEqual(1);
		expect(beats).toBeLessThanOrEqual(Math.floor(ms / 1000) + 1);
	}, 120_000);

	it('beats while it builds the syntax docs', () => {
		let beats = 0;
		const docs = engine.syntax(() => beats++);
		expect(docs.keywords.length).toBeGreaterThan(200);
		expect(beats).toBeGreaterThan(100);
	}, 120_000);
});
