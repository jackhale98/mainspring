// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { FrameMeter, summarise } from './frame-meter';

describe('summarise', () => {
	it('passes when 95% are on time and none is over 50 ms', () => {
		const s = summarise([...new Array<number>(95).fill(16.7), ...new Array<number>(5).fill(33.4)]);
		expect(s.onTimePct).toBe(95);
		expect(s.over50).toBe(0);
		expect(s.pass).toBe(true);
	});
	it('fails on one frame over 50 ms, or too few on time', () => {
		expect(summarise([...new Array<number>(99).fill(16.7), 51]).pass).toBe(false);
		const late = [...new Array<number>(94).fill(16.7), ...new Array<number>(6).fill(33)];
		expect(summarise(late).pass).toBe(false);
	});
	it('does not pass with no frames', () => {
		expect(summarise([])).toMatchObject({ frames: 0, maxMs: 0, pass: false });
	});
});

describe('FrameMeter', () => {
	it('records the interval of each frame, keeps the newest, and stops', () => {
		let clock = 0;
		const queue: Array<(t: number) => void> = [];
		const m = new FrameMeter(
			3,
			() => clock,
			(cb) => queue.push(cb),
			() => queue.splice(0),
		);
		m.start();
		for (const dt of [16, 17, 50, 16]) {
			clock += dt;
			queue.shift()?.(clock);
		}
		// Three kept: 17, 50, 16.
		expect(m.summary()).toMatchObject({ frames: 3, maxMs: 50, over50: 0 });
		m.stop();
		expect(m.running).toBe(false);
		m.reset();
		expect(m.summary().frames).toBe(0);
	});
});
