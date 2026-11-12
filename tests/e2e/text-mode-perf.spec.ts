// SPDX-License-Identifier: GPL-2.0-or-later
// Keystroke-to-paint in Text mode (phase-1.md 8.4: 50 ms or less with Fedora open, desktop
// Chrome). The numbers are recorded, not enforced (the gate records them; CI hardware varies):
// they are printed, attached to the report and written to test-results/text-mode-perf.json.
//
// Two measures per keystroke, in the page:
// - Event Timing: `duration` of the keydown and input events, from the event's timestamp to the
//   next paint (rounded to 8 ms; events under 16 ms are not reported, so "reported" counts them);
// - a frame measure: keydown to the first task after the next animation frame, which follows the
//   paint that shows the keystroke.
// The workspace's own work (commit, reparse, runner) is on that path; the engine is in a worker.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';

const READY_TIMEOUT_MS = 120_000;
const KEYS = 60;
const GAP_MS = 90;

interface Samples {
	events: number[];
	frames: number[];
}

declare global {
	interface Window {
		__perf?: Samples;
	}
}

function percentile(values: readonly number[], p: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

function summary(values: readonly number[]) {
	return {
		count: values.length,
		p50: percentile(values, 50),
		p90: percentile(values, 90),
		max: Math.max(0, ...values),
	};
}

async function scheduled(page: Page): Promise<void> {
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText(
		/Scheduled|Scheduled with problems/,
		{ timeout: READY_TIMEOUT_MS },
	);
}

/** Waits for the run that follows an edit: scheduling starts, then the strip shows a result. */
async function settled(page: Page): Promise<void> {
	const state = page.getByRole('group', { name: 'Plan status' }).locator('.state');
	await expect(state).toHaveAttribute('data-kind', 'scheduling', { timeout: 10_000 });
	await expect(state).not.toHaveAttribute('data-kind', 'scheduling', { timeout: READY_TIMEOUT_MS });
}

async function measure(
	page: Page,
): Promise<{ events: ReturnType<typeof summary>; frames: ReturnType<typeof summary> }> {
	await page.evaluate(() => {
		const perf: Samples = { events: [], frames: [] };
		window.__perf = perf;
		new PerformanceObserver((list) => {
			for (const e of list.getEntries()) {
				if (e.name === 'keydown' || e.name === 'input') perf.events.push(e.duration);
			}
		}).observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit);
		document.addEventListener(
			'keydown',
			(e) => {
				const start = e.timeStamp;
				requestAnimationFrame(() =>
					setTimeout(() => perf.frames.push(performance.now() - start), 0),
				);
			},
			true,
		);
	});
	// A new comment line at the end, so the typing never makes a syntax error.
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.insertText('\n# ');
	await page.waitForTimeout(500);
	for (let i = 0; i < KEYS; i++) {
		await page.keyboard.press(i % 7 === 6 ? 'Space' : 'KeyA');
		await page.waitForTimeout(GAP_MS);
	}
	await page.waitForTimeout(500);
	const perf = await page.evaluate(() => window.__perf ?? { events: [], frames: [] });
	return { events: summary(perf.events), frames: summary(perf.frames) };
}

test.describe('keystroke to paint', () => {
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name !== 'desktop', 'desktop Chrome only (spec 8.4)');
	});
	test.setTimeout(READY_TIMEOUT_MS + 60_000);

	const results: Record<string, unknown> = {};

	test.afterAll(() => {
		const file = path.join(REPO, 'test-results', 'text-mode-perf.json');
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, JSON.stringify(results, null, 2));
	});

	test('Fedora 20 sample (414 tasks)', async ({ page }, info) => {
		await page.goto('/app?sample=upstream-fedora-20');
		await scheduled(page);
		await page.getByRole('textbox', { name: /^Editor for / }).click();
		const r = await measure(page);
		results['upstream-fedora-20'] = r;
		console.log('upstream-fedora-20', JSON.stringify(r));
		await info.attach('perf-fedora', { body: JSON.stringify(r), contentType: 'application/json' });
		expect(r.frames.count).toBeGreaterThan(KEYS / 2);
	});

	test('syn-20 scale-1000 pasted in (1,000 tasks, 5,628 lines)', async ({ page }, info) => {
		const text = fs.readFileSync(
			path.join(REPO, 'engine/golden/plans/synthetic/20-scale-1000/plan.tjp'),
			'utf8',
		);
		await page.goto('/app');
		await scheduled(page);
		const editor = page.getByRole('textbox', { name: /^Editor for / });
		await editor.click();
		await page.keyboard.press('ControlOrMeta+a');
		// One paste event with the whole file, as a user pasting a plan would send it.
		await page.evaluate((t) => {
			const data = new DataTransfer();
			data.setData('text/plain', t);
			document
				.querySelector('.cm-content')
				?.dispatchEvent(
					new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
				);
		}, text);
		// The cursor ends after the pasted text, so the end of the file is what shows.
		await expect(editor).toContainText('task t3_4_9_4 "Item 3.4.9.4"');
		await settled(page);
		const r = await measure(page);
		results['syn-20-scale-1000'] = r;
		console.log('syn-20-scale-1000', JSON.stringify(r));
		await info.attach('perf-syn20', { body: JSON.stringify(r), contentType: 'application/json' });
		expect(r.frames.count).toBeGreaterThan(KEYS / 2);
	});
});
