// SPDX-License-Identifier: GPL-2.0-or-later
// Unit tests for corpus.ts: the manifest checks the parity test relies on, request building and
// the seeded shuffle.
import { describe, expect, it } from 'vitest';
import { GOLDEN_SCHEMA_VERSION } from '../../engine/golden/lib.mjs';
import { planRequest as nodeHarnessRequest } from '../../engine/golden/run-wasm.mjs';
import {
	expectedIds,
	loadCorpus,
	loadManifest,
	pinnedCommit,
	seededShuffle,
	planRequest,
} from './corpus';

describe('corpus', () => {
	it('has the expected plan count, one golden per manifest id and no stray goldens', () => {
		const ids = loadManifest().map((p) => p.id);
		expect(ids).toHaveLength(36);
		expect(new Set(ids).size).toBe(ids.length);
		expect(expectedIds()).toEqual([...ids].sort());
	});

	it('records every golden against the pinned TaskJuggler commit and the current schema', () => {
		const pin = pinnedCommit();
		for (const { plan, golden } of loadCorpus()) {
			expect(golden.schemaVersion, `${plan.id} schemaVersion`).toBe(GOLDEN_SCHEMA_VERSION);
			expect(golden.native.tjCommit, plan.id).toBe(pin);
			expect(golden.id).toBe(plan.id);
			expect(golden.options.now, `${plan.id} options.now`).toBe(plan.now);
			expect(golden.entry, `${plan.id} entry`).toBe(plan.entry);
		}
	});

	it('builds the same requests as the Node harness', () => {
		for (const { plan, golden } of loadCorpus()) {
			expect(planRequest(plan, golden, 3), plan.id).toEqual(nodeHarnessRequest(plan, golden, 3));
		}
	});

	it('only passes options.now when the golden has one', () => {
		for (const { plan, golden } of loadCorpus()) {
			const { options } = planRequest(plan, golden, 1);
			expect('now' in (options ?? {})).toBe(golden.options.now !== null);
		}
	});
});

describe('seededShuffle', () => {
	const items = Array.from({ length: 34 }, (_, i) => i);

	it('is deterministic per seed and a permutation', () => {
		const a = seededShuffle(items, 1234);
		expect(seededShuffle(items, 1234)).toEqual(a);
		expect([...a].sort((x, y) => x - y)).toEqual(items);
		expect(a).not.toEqual(items);
	});

	it('differs between seeds and leaves the input alone', () => {
		expect(seededShuffle(items, 1)).not.toEqual(seededShuffle(items, 2));
		expect(items[0]).toBe(0);
		expect(items[33]).toBe(33);
	});
});
