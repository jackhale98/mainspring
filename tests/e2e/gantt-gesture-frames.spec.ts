// SPDX-License-Identifier: GPL-2.0-or-later
// Frame cost of the gestures (phase-2.md 7.3, 8.2; T16), measured and recorded, not enforced (a
// shared runner has no GPU and other load; T22 owns the budgets): the frame intervals during a 3 s
// drag of the size handle (desktop, the Pixel 7 with a finger at 4x CPU, and the iPhone 14 with dispatched touch events, unthrottled: WebKit has no CPU throttling) on the small
// gantt-manipulation plan. The scroll frame times, the touch-listener comparison (8.2) and the
// 500-task drag live in gantt-perf.spec.ts (T22), on gantt-500. Written to
// test-results/gantt-gesture-frames.json.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { isWebKit } from './lib/finger';
import { READY_TIMEOUT_MS, Rig, minute } from './lib/gantt-rig';

interface Stats {
	frames: number;
	medianMs: number;
	p95Ms: number;
	maxMs: number;
	over50: number;
	longTasks: number;
}

const OUT = path.join(REPO, 'test-results', 'gantt-gesture-frames.json');

async function startMeter(page: Page): Promise<void> {
	await page.evaluate(() => {
		const w = window as unknown as { __frames: number[]; __lt: number; __stop: boolean };
		w.__frames = [];
		w.__lt = 0;
		w.__stop = false;
		try {
			new PerformanceObserver((l) => (w.__lt += l.getEntries().length)).observe({
				entryTypes: ['longtask'],
			});
		} catch {
			// No long task entries here.
		}
		let last = performance.now();
		const tick = (t: number): void => {
			w.__frames.push(t - last);
			last = t;
			if (!w.__stop) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
}

async function stopMeter(page: Page): Promise<Stats> {
	return page.evaluate(() => {
		const w = window as unknown as { __frames: number[]; __lt: number; __stop: boolean };
		w.__stop = true;
		const f = w.__frames.slice(2).sort((a, b) => a - b);
		const at = (q: number): number => f[Math.min(f.length - 1, Math.floor(q * f.length))] ?? 0;
		return {
			frames: f.length,
			medianMs: at(0.5),
			p95Ms: at(0.95),
			maxMs: f[f.length - 1] ?? 0,
			over50: f.filter((x) => x > 50).length,
			longTasks: w.__lt,
		};
	});
}

test.describe('gesture frame cost (recorded)', { tag: '@timing' }, () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);

	const record = (name: string, stats: Stats): void => {
		fs.mkdirSync(path.dirname(OUT), { recursive: true });
		const old = fs.existsSync(OUT) ? (JSON.parse(fs.readFileSync(OUT, 'utf8')) as object) : {};
		fs.writeFileSync(OUT, JSON.stringify({ ...old, [name]: stats }, null, 2));
		expect(stats.frames).toBeGreaterThan(10);
	};

	test('a 3 s drag of the size handle', async ({ page }, info) => {
		const rig = await Rig.open(page, info);
		// CPU throttling is a Chromium DevTools setting: the iPhone's drag (dispatched events) runs
		// unthrottled and is recorded under its own name.
		const throttled = rig.touch && !isWebKit(page);
		if (throttled) {
			const cdp = await page.context().newCDPSession(page);
			await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
		}
		const b = await rig.select('design.research');
		const to = { x: await rig.x(minute('2026-03-06', 17)), y: b.endEdge.y };
		await startMeter(page);
		await rig.drag(b.endEdge, to, { steps: 60 });
		const name = throttled ? 'drag-touch-4x' : rig.touch ? 'drag-touch-webkit' : 'drag-mouse';
		record(name, await stopMeter(page));
	});
});
