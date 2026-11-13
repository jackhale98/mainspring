// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The golden corpus as the parity test sees it: manifest plans, their goldens and native
 * timings, requests built the way engine/golden/run-wasm.mjs builds them, and a seeded shuffle.
 * Node only: it reads the repository's files.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScheduleRequest } from '../../src/engine/protocol';
import type { GoldenLike } from './compare';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GOLDEN_DIR = path.join(REPO, 'engine', 'golden');

export interface ManifestPlan {
	id: string;
	kind: string;
	root: string;
	entry: string;
	now: string | null;
}

export interface GoldenFile extends GoldenLike {
	/** GOLDEN_SCHEMA_VERSION of engine/golden/lib.mjs when the golden is current. */
	schemaVersion: number;
	id: string;
	entry: string;
	files: string[];
	options: { now: string | null };
	native: { tjCommit: string };
}

export interface NativeTiming {
	tasks: number;
	totalMs: number;
}

export interface CorpusEntry {
	plan: ManifestPlan;
	golden: GoldenFile;
	native: NativeTiming | null;
}

function readJson<T>(file: string): T {
	return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export function loadManifest(): ManifestPlan[] {
	return readJson<ManifestPlan[]>(path.join(GOLDEN_DIR, 'manifest.json'));
}

/** Ids of the files in engine/golden/expected, without the extension. */
export function expectedIds(): string[] {
	return readdirSync(path.join(GOLDEN_DIR, 'expected'))
		.filter((name) => name.endsWith('.json'))
		.map((name) => name.slice(0, -'.json'.length))
		.sort();
}

export function pinnedCommit(): string {
	return readJson<{ commit: string }>(path.join(REPO, 'engine', 'tj.pin.json')).commit;
}

export function loadCorpus(): CorpusEntry[] {
	const native = readJson<{ plans: Record<string, NativeTiming> }>(
		path.join(GOLDEN_DIR, 'native-timings.json'),
	).plans;
	return loadManifest().map((plan) => ({
		plan,
		golden: readJson<GoldenFile>(path.join(GOLDEN_DIR, 'expected', `${plan.id}.json`)),
		native: native[plan.id] ?? null,
	}));
}

/**
 * The request for a plan: exactly the golden's files, decoded as the browser decodes them
 * (UTF-8, invalid bytes to U+FFFD, a leading BOM kept for the bridge to drop).
 */
export function planRequest(
	plan: Pick<ManifestPlan, 'root'>,
	golden: Pick<GoldenFile, 'entry' | 'files' | 'options'>,
	revision: number,
): ScheduleRequest {
	const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
	const files: Record<string, string> = {};
	for (const f of golden.files) {
		files[f] = decoder.decode(readFileSync(path.join(REPO, plan.root, f)));
	}
	const options = golden.options.now ? { now: golden.options.now } : {};
	return { files, entry: golden.entry, revision, options };
}

/** A small deterministic generator (mulberry32) returning numbers in [0, 1). */
export function seededRandom(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Fisher-Yates shuffle of a copy; the same seed gives the same order. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
	const out = [...items];
	const random = seededRandom(seed);
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[out[i], out[j]] = [out[j] as T, out[i] as T];
	}
	return out;
}
