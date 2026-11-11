// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Golden parity in the browser (phase-0 spec 6.3). The whole corpus goes through the real worker
 * on /dev/engine, in a seeded shuffled order, in one long-lived client. Then upstream-fedora-20
 * runs again in a fresh page. Every result must equal its golden (revision and timings aside).
 * Writes test-results/golden-report.{md,json} for the gate document.
 *
 * Run with `npm run test:golden` (Chromium only; the page needs MAINSPRING_DEV_PAGES=1).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { ScheduleOutcome } from '../../src/engine/client';
import type { EngineVersions, ScheduleRequest } from '../../src/engine/protocol';
import { compareWithGolden } from './compare';
import {
	REPO,
	expectedIds,
	loadCorpus,
	loadManifest,
	pinnedCommit,
	planRequest,
	seededShuffle,
	type CorpusEntry,
} from './corpus';
import { renderReport, type PlanRow } from './report';

const EXPECTED_PLAN_COUNT = 34;
const FRESH_PLAN = 'upstream-fedora-20';
const SEED = Number(process.env['GOLDEN_SEED'] ?? 20261111);
// A cold boot is several seconds; syn-20 takes 7 to 9 s; CI is slower than a dev machine.
const BOOT_TIMEOUT_MS = 180_000;
const PLAN_TIMEOUT_MS = 120_000;

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName }) => browserName !== 'chromium', 'Golden parity gates on Chromium only');

const corpus = loadCorpus();
const rows: PlanRow[] = [];
let versions: EngineVersions | null = null;
let revision = 0;

async function openEngine(page: Page): Promise<EngineVersions> {
	await page.goto('/dev/engine');
	return page.evaluate(async () => {
		const api = window.mainspringDev;
		if (!api) throw new Error('window.mainspringDev is missing; build with MAINSPRING_DEV_PAGES=1');
		return api.ready();
	});
}

async function schedule(page: Page, request: ScheduleRequest): Promise<ScheduleOutcome> {
	return page.evaluate(async (req) => {
		const api = window.mainspringDev;
		if (!api) throw new Error('window.mainspringDev is missing');
		return api.schedule(req);
	}, request);
}

/** Schedules one plan and compares it; returns the table row. */
async function runPlan(page: Page, entry: CorpusEntry, label: string): Promise<PlanRow> {
	const { plan, golden, native } = entry;
	const outcome = await schedule(page, planRequest(plan, golden, ++revision));
	const base = {
		id: plan.id,
		run: label,
		tasks: golden.result.tasks.length,
		nativeMs: native?.totalMs ?? null,
	};
	if (outcome.status !== 'done') {
		const detail =
			outcome.status === 'failed'
				? `${outcome.error.kind}: ${outcome.error.message}`
				: outcome.status;
		return {
			...base,
			workerMs: null,
			pass: false,
			diffs: [`engine did not deliver a result (${detail})`],
		};
	}
	const comparison = compareWithGolden(golden, outcome.result);
	return {
		...base,
		workerMs: outcome.result.timings.totalMs,
		pass: comparison.ok,
		diffs: comparison.diffs,
	};
}

test.afterAll(() => {
	const dir = path.join(REPO, 'test-results');
	mkdirSync(dir, { recursive: true });
	const meta = { seed: SEED, engine: versions, expectedPlans: EXPECTED_PLAN_COUNT };
	writeFileSync(path.join(dir, 'golden-report.md'), renderReport(rows, meta));
	writeFileSync(
		path.join(dir, 'golden-report.json'),
		`${JSON.stringify({ ...meta, rows }, null, 2)}\n`,
	);
});

test('manifest, goldens and pin agree', () => {
	const ids = loadManifest().map((p) => p.id);
	expect(ids).toHaveLength(EXPECTED_PLAN_COUNT);
	expect(expectedIds()).toEqual([...ids].sort());
	const pin = pinnedCommit();
	for (const { plan, golden } of corpus) expect(golden.native.tjCommit, plan.id).toBe(pin);
});

test('every golden plan matches in one long-lived worker (shuffled)', async ({ page }) => {
	test.setTimeout(BOOT_TIMEOUT_MS + PLAN_TIMEOUT_MS * corpus.length);
	versions = await openEngine(page);
	const order = seededShuffle(corpus, SEED);
	console.log(`golden order (seed ${SEED}): ${order.map((e) => e.plan.id).join(' ')}`);
	for (const entry of order) {
		const row = await Promise.race([
			runPlan(page, entry, 'shuffled'),
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new Error(`${entry.plan.id}: no result in ${PLAN_TIMEOUT_MS} ms`)),
					PLAN_TIMEOUT_MS,
				),
			),
		]);
		rows.push(row);
	}
	const failed = rows.filter((r) => r.run === 'shuffled' && !r.pass);
	expect(rows.filter((r) => r.run === 'shuffled')).toHaveLength(EXPECTED_PLAN_COUNT);
	expect(
		failed.map((r) => `${r.id}\n  ${r.diffs.join('\n  ')}`),
		'plans that differ from their golden',
	).toEqual([]);
});

test(`${FRESH_PLAN} matches again in a fresh page and client`, async ({ page }) => {
	test.setTimeout(BOOT_TIMEOUT_MS + PLAN_TIMEOUT_MS);
	await openEngine(page);
	const entry = corpus.find((e) => e.plan.id === FRESH_PLAN);
	if (!entry) throw new Error(`${FRESH_PLAN} is not in the manifest`);
	const row = await runPlan(page, entry, 'fresh');
	rows.push(row);
	expect(row.diffs).toEqual([]);
	expect(row.pass).toBe(true);
});
