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
// "The live result equals the committed golden" (16.1 step 3's parity) is the golden parity job's
// (`npm run test:golden`, which runs the fedora-res golden through the browser engine); this spec
// takes the live result as the engine's data and does not compare it with the golden file again.
// The plan upstream-fedora-20 itself declares no resources: the view says so (zero cells, zero
// differences, which is stated, not counted as evidence).
import { expect, test } from '@playwright/test';
import { READY_TIMEOUT_MS } from './lib/gantt-rig';
import { openHeatmap, oracle, resultOf, shape, walkGrid } from './lib/workload-rig';

test.beforeEach(({ browserName: _b }, info) => {
	test.skip(info.project.name === 'iphone-14', 'desktop and Pixel 7 (T14); iPhone is reported');
});
test.setTimeout(READY_TIMEOUT_MS * 3);

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
	const phone = info.project.name === 'pixel-7';
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
