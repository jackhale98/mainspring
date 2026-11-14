// SPDX-License-Identifier: GPL-2.0-or-later
// Frame cost of the gestures (phase-2.md 7.3, 8.2; T16), measured and recorded, not enforced (a
// shared runner has no GPU and other load; T22 owns the budgets): the frame intervals during a 3 s
// drag of the size handle (desktop, and the Pixel 7 with a finger at 4x CPU), and the intervals of
// a native one-finger scroll at 4x with the non-passive `touchmove` listener the Gantt attaches
// (8.2) and with it left out (an init script drops it), for the touch-listener comparison. Written
// to test-results/gantt-gesture-frames.json.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';
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

test.describe('gesture frame cost (recorded)', () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name === 'iphone-14', 'Chromium measures (T16)');
	});

	test('a 3 s drag of the size handle, and a scroll with and without the touchmove listener', async ({
		page,
	}, info) => {
		const results: Record<string, Stats> = {};
		const rig = await Rig.open(page, info);
		const cdp = await page.context().newCDPSession(page);
		if (rig.touch) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
		const b = await rig.select('design.research');
		const to = { x: await rig.x(minute('2026-03-06', 17)), y: b.endEdge.y };
		await startMeter(page);
		await rig.drag(b.endEdge, to, { steps: 60 });
		results[rig.touch ? 'drag-touch-4x' : 'drag-mouse'] = await stopMeter(page);
		await page.keyboard.press('ControlOrMeta+z');

		if (rig.touch) {
			const scroller = page.getByTestId('gantt').locator('.scroller');
			const box = await scroller.boundingBox();
			if (!box) throw new Error('no chart');
			const x = box.x + box.width / 2;
			const y = box.y + box.height / 2;
			await startMeter(page);
			await cdp.send('Input.synthesizeScrollGesture', {
				x,
				y,
				yDistance: -300,
				speed: 600,
				gestureSourceType: 'touch',
			});
			results['scroll-4x-with-listener'] = await stopMeter(page);
		}
		fs.mkdirSync(path.dirname(OUT), { recursive: true });
		const old = fs.existsSync(OUT) ? (JSON.parse(fs.readFileSync(OUT, 'utf8')) as object) : {};
		fs.writeFileSync(OUT, JSON.stringify({ ...old, ...results }, null, 2));
		for (const s of Object.values(results)) expect(s.frames).toBeGreaterThan(10);
	});

	test('the same scroll with the listener left out', async ({ page }, info) => {
		test.skip(info.project.name !== 'pixel-7', 'the touch listener comparison is a phone one');
		// Drop non-passive touchmove listeners (the Gantt's) before the app runs.
		await page.addInitScript(() => {
			const add = EventTarget.prototype.addEventListener;
			EventTarget.prototype.addEventListener = function (type, fn, opts) {
				const passive = typeof opts === 'object' && opts !== null ? opts.passive : undefined;
				if (type === 'touchmove' && passive === false) return;
				return add.call(this, type, fn, opts);
			};
		});
		const rig = await Rig.open(page, info);
		const cdp = await page.context().newCDPSession(page);
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
		const box = await page.getByTestId('gantt').locator('.scroller').boundingBox();
		if (!box) throw new Error('no chart');
		await startMeter(page);
		await cdp.send('Input.synthesizeScrollGesture', {
			x: box.x + box.width / 2,
			y: box.y + box.height / 2,
			yDistance: -300,
			speed: 600,
			gestureSourceType: 'touch',
		});
		const s = await stopMeter(page);
		void rig;
		const old = fs.existsSync(OUT) ? (JSON.parse(fs.readFileSync(OUT, 'utf8')) as object) : {};
		fs.writeFileSync(OUT, JSON.stringify({ ...old, 'scroll-4x-without-listener': s }, null, 2));
		expect(s.frames).toBeGreaterThan(5);
	});
});
