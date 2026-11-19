// SPDX-License-Identifier: GPL-2.0-or-later
// Gate criterion 1 (phase-3.md 16.1): on the Fedora plan with its people (`fedora-res`), the
// heatmap's hours per person per week match the engine's load data exactly. The spec opens the
// plan in the Workload view at week zoom with every group expanded, scrolls through every person
// and every week reading each cell's exact minutes from the ARIA mirror, and compares them with
// an oracle (tests/e2e/lib/workload-rig.ts) that walks the live result's `bookings` and
// `workingTime` slot by slot into local weeks with `Intl`, sharing no code with the view or with
// src/lib/workload. Groups are compared with the sums of their members. Pass: zero differences in
// integer minutes. The cell's sentence is checked to say the same hours as its minutes.
// The rows are checked against the oracle's, not the view's own: the set of rows the view shows
// equals the set of resources of the result (every person and every group, with the groups
// expanded, the ones with no bookings included), so a person the view drops cannot pass.
// "The live result equals the committed golden" (16.1's parity) is checked here too: the live
// result the page holds (revision and timings aside, as the golden parity job leaves them, and the
// wall clock `project.now`, see below) is
// compared with engine/golden/expected/fedora-res.json by the job's own comparison, so the cells
// are compared against an engine result that is the committed one. The counts go to
// test-results/workload-gate.json (phase-3.md 17), one entry per project.
// The plan upstream-fedora-20 itself declares no resources: the view says so (zero cells, zero
// differences, which is stated, not counted as evidence).
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { compareWithGolden, type GoldenLike } from '../golden/compare';
import { REPO } from '../golden/corpus';
import { READY_TIMEOUT_MS, isTouch } from './lib/gantt-rig';
import { openHeatmap, oracle, resultOf, shape, walkGrid } from './lib/workload-rig';

test.setTimeout(READY_TIMEOUT_MS * 3);

const OUT = path.join(REPO, 'test-results', 'workload-gate.json');
function record(key: string, value: unknown): void {
	fs.mkdirSync(path.dirname(OUT), { recursive: true });
	const old = fs.existsSync(OUT) ? (JSON.parse(fs.readFileSync(OUT, 'utf8')) as object) : {};
	fs.writeFileSync(OUT, JSON.stringify({ ...old, [key]: value }, null, 2));
}

test('fedora-res: every person and week cell equals the hours of the result bookings', async ({
	page,
}, info) => {
	await openHeatmap(page, info);
	const s = await shape(page);
	expect(s?.zoom).toBe('week');
	const result = await resultOf(page);
	if (!result) throw new Error('no result');
	const o = oracle(result);
	expect(s?.cols).toBe(o.weeks);

	// Parity: the live result is the committed golden's (the zero-difference criterion is then about
	// the engine's recorded data, not about whatever the page happens to hold).
	const golden = JSON.parse(
		fs.readFileSync(path.join(REPO, 'engine', 'golden', 'expected', 'fedora-res.json'), 'utf8'),
	) as GoldenLike;
	// One input differs by design: the app schedules as of the wall clock (`project.now`, which the
	// worker reads and a page cannot pin), the golden as of 2013-09-02 12:00 UTC. It is the clock, not
	// an engine result, and nothing else in the result depends on it for this plan; it is set to the
	// golden's before the comparison, and any other difference fails.
	const liveNow = result.project?.now;
	const parity = compareWithGolden(
		golden,
		result.project
			? { ...result, project: { ...result.project, now: golden.result.project?.now ?? '' } }
			: result,
	);
	expect(parity.diffs, 'the live result differs from the committed golden').toEqual([]);

	// Every resource of the result is a row, and nothing else is.
	expect(new Set(s?.rows)).toEqual(new Set(result.resources.map((r) => r.id)));
	expect(new Set(s?.rows)).toEqual(new Set(o.booked.keys()));

	const cells = await walkGrid(page);
	let differences = 0;
	const wrong: string[] = [];
	for (const person of o.booked.keys()) {
		for (let c = 0; c < o.weeks; c++) {
			const cell = cells.get(`${person}|${c}`);
			const b = o.booked.get(person)?.[c];
			const a = o.available.get(person)?.[c];
			if (!cell || cell.booked !== b || cell.available !== a) {
				differences++;
				if (wrong.length < 10) {
					wrong.push(
						`${person} week ${c}: view ${cell?.booked}/${cell?.available}, oracle ${b}/${a}`,
					);
				}
			}
		}
	}
	const people = o.booked.size;
	console.log(
		`workload gate (${info.project.name}): ${people} rows x ${o.weeks} weeks = ${people * o.weeks} cells compared, ${differences} differences`,
	);
	record(info.project.name, {
		plan: 'fedora-res',
		zoom: 'week',
		rows: people,
		weeks: o.weeks,
		cellsCompared: people * o.weeks,
		differences,
		goldenParityDiffs: parity.diffs.length,
		goldenParityIgnored: ['/project/now'],
		liveNow,
		workerMemoryBytes: result.timings?.memoryBytes ?? null,
	});
	expect(wrong).toEqual([]);
	expect(differences).toBe(0);
	expect(people).toBeGreaterThan(20);
	expect(o.weeks).toBeGreaterThan(80);

	// The words say what the minutes say: "38 of 40 hours" for a cell that has working time.
	const hours = (m: number): string => String(Math.round((m / 60) * 100) / 100);
	for (const cell of cells.values()) {
		if (cell.available > 0) {
			expect(cell.name).toContain(`${hours(cell.booked)} of ${hours(cell.available)} hours`);
		}
	}
});

test('upstream-fedora-20: no resources, so the view says so', async ({ page }, info) => {
	const phone = isTouch(info);
	await page.goto(
		phone
			? '/app?sample=upstream-fedora-20&hooks=edits,workload'
			: '/app?sample=upstream-fedora-20&mode=visual&view=workload&hooks=edits,workload',
	);
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	if (phone) {
		await page.getByRole('tablist', { name: 'Panels' }).getByRole('tab', { name: 'People' }).tap();
	}
	await expect(page.getByText('No people yet')).toBeVisible({ timeout: 60_000 });
	await expect(page.getByTestId('heat-cell')).toHaveCount(0);
});
