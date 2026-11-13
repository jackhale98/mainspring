// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	flowerCentres,
	gauge,
	ganttLayout,
	rosetteAngles,
	tokenize,
	tokensToHtml,
	type GanttOptions,
} from './landing-art';
import { demoPlan, demoPlanText, mockPlanText, samplePlan } from './landing-sample';

const OPTIONS: GanttOptions = {
	nameCol: 84,
	dayW: 12,
	days: 24,
	rowH: 30,
	headerH: 42,
	barH: 16,
	today: 8.5,
};

describe('tokenize', () => {
	it('gives back the line it was given', () => {
		for (const line of [...mockPlanText, ...demoPlanText, 'project p "P" 2026-12-07 +4w # note']) {
			expect(
				tokenize(line)
					.map((t) => t.text)
					.join(''),
			).toBe(line);
		}
	});

	it('marks keywords, ids, strings and durations', () => {
		const kinds = (line: string) => tokenize(line).filter((t) => t.kind !== 'txt');
		expect(kinds('task build "Build" {')).toEqual([
			{ kind: 'kw', text: 'task' },
			{ kind: 'id', text: 'build' },
			{ kind: 'str', text: '"Build"' },
		]);
		expect(kinds('  effort 10d')).toEqual([
			{ kind: 'kw', text: 'effort' },
			{ kind: 'num', text: '10d' },
		]);
		expect(kinds('  allocate ana, ben').map((t) => t.kind)).toEqual(['kw', 'id', 'id']);
		expect(kinds('  depends !build, !docs').map((t) => t.text)).toEqual([
			'depends',
			'!build',
			'!docs',
		]);
		expect(kinds('project p "P" 2026-12-07 +4w').map((t) => t.kind)).toEqual([
			'kw',
			'id',
			'str',
			'num',
			'num',
		]);
		expect(kinds('# a comment')).toEqual([{ kind: 'cmt', text: '# a comment' }]);
	});

	it('escapes markup when it writes HTML', () => {
		const html = tokensToHtml(tokenize('a < b & c'));
		expect(html).toContain('&lt;');
		expect(html).toContain('&amp;');
		expect(html).not.toContain('< b');
	});
});

describe('ganttLayout', () => {
	const layout = ganttLayout(samplePlan, OPTIONS);

	it('places one row per task, a row height apart', () => {
		expect(layout.rows).toHaveLength(5);
		layout.rows.forEach((row, i) => {
			expect(row.y).toBe(OPTIONS.headerH + i * OPTIONS.rowH);
			expect(row.cy).toBe(row.y + OPTIONS.rowH / 2);
		});
	});

	it('sizes bars by days and puts a milestone on its day', () => {
		const design = layout.rows[0];
		const launch = layout.rows[4];
		expect(design?.x).toBe(84);
		expect(design?.w).toBe(60);
		expect(launch?.w).toBe(0);
		expect(launch?.x).toBe(84 + 18 * 12);
	});

	it('cuts the fill at the progress fraction', () => {
		const build = layout.rows[1];
		expect(build && build.progressX - build.x).toBeCloseTo(0.3 * (build?.w ?? 0), 0);
	});

	it('draws one link per dependency and marks the critical ones', () => {
		expect(layout.links).toHaveLength(5);
		expect(layout.links.filter((l) => l.critical)).toHaveLength(3);
		for (const link of layout.links) {
			expect(link.d).toMatch(/^M[\d. -]+/);
			expect(link.d).not.toContain('NaN');
			expect(link.arrow).not.toContain('NaN');
		}
		expect(ganttLayout(demoPlan, OPTIONS).links).toHaveLength(2);
	});

	it('shades Saturdays and Sundays and ticks each Monday', () => {
		expect(layout.weekends.map((w) => w.x)).toEqual(
			[5, 6, 12, 13, 19, 20].map((day) => 84 + day * 12),
		);
		expect(layout.weeks.map((w) => w.index)).toEqual([0, 1, 2, 3]);
		expect(layout.todayX).toBe(84 + 8.5 * 12);
		expect(layout.width).toBe(84 + 24 * 12);
	});
});

describe('gauge', () => {
	it('puts the needle on the left at 0 and on the right at 100', () => {
		expect(gauge(0).needle.x2).toBeLessThan(gauge(0).hub.cx);
		expect(gauge(100).needle.x2).toBeGreaterThan(gauge(100).hub.cx);
		expect(gauge(50).needle.x2).toBeCloseTo(gauge(50).hub.cx, 0);
	});

	it('draws eleven ticks and no arc at zero', () => {
		expect(gauge(30).ticks).toHaveLength(11);
		expect(gauge(0).arc).toBe('');
		expect(gauge(30).arc).toMatch(/^M[\d. ]+A36 36 0 0 1 [\d. ]+$/);
	});

	it('clamps out-of-range values', () => {
		expect(gauge(250).needle).toEqual(gauge(100).needle);
		expect(gauge(-5).needle).toEqual(gauge(0).needle);
	});
});

describe('guilloché', () => {
	it('spreads the copies over half a turn', () => {
		const angles = rosetteAngles(45);
		expect(angles).toHaveLength(45);
		expect(angles[0]).toBe(0);
		expect(Math.max(...angles)).toBeLessThan(180);
	});

	it('puts every circle centre on one ring', () => {
		for (const c of flowerCentres(48, 120)) {
			expect(Math.hypot(c.cx, c.cy)).toBeCloseTo(120, 0);
		}
	});
});
