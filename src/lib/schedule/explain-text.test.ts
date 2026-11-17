// SPDX-License-Identifier: GPL-2.0-or-later
// What the explainer reads from the text (explain-text.ts): size criteria, written dates with
// their scenario and inheritance, and `limits` statements.
import { describe, expect, it } from 'vitest';
import { buildIndex } from '../tjp/index';
import { inline } from '../tjp/index/testing';
import {
	personLimitSite,
	scenarioChainOf,
	sizeKindOf,
	taskLimitSites,
	writtenDates,
} from './explain-text';
import { zones } from './explain-testing';

const index = (text: string) =>
	buildIndex(inline({ 'plan.tjp': text }).snapshot(), undefined, { cache: null, zones });
const START = Date.parse('2026-01-05T00:00:00Z') / 1000;

const PLAN = `project p "P" 2026-01-05 - 2026-03-02 {
  scenario plan "Plan" {
    scenario late "Late"
  }
}
macro d [2026-01-07]
resource team "Team" {
  limits { dailymax 6h }
  resource ann "Ann"
  resource bo "Bo" {
    limits { dailymax 4h }
  }
}
task outer "Outer" {
  start 2026-01-06
  limits { weeklymax 20h }
  task e "E" {
    effort 2d
    late:length 3d
  }
  task l "L" {
    length 2d
    start 2026-01-08
    late:start 2026-01-12
  }
  task m "M" {
    milestone
  }
  task x "X" {
    start \${d}
    duration 2d
  }
}
`;

describe('scenarioChainOf', () => {
	it('walks to the top scenario', () => {
		const scenarios = [
			{ id: 'plan', name: 'P', parent: null, active: true },
			{ id: 'late', name: 'L', parent: 'plan', active: true },
		];
		expect(scenarioChainOf({ scenarios }, 'late')).toEqual(['late', 'plan']);
		expect(scenarioChainOf({ scenarios }, 'plan')).toEqual(['plan']);
		expect(scenarioChainOf(null, 'plan')).toEqual(['plan']);
	});
});

describe('sizeKindOf', () => {
	const idx = index(PLAN);
	it('reads the size criterion in the shown scenario', () => {
		expect(sizeKindOf(idx, 'outer.e', ['plan'])).toBe('effort');
		expect(sizeKindOf(idx, 'outer.e', ['late', 'plan'])).toBe('length');
		expect(sizeKindOf(idx, 'outer.l', ['plan'])).toBe('length');
		expect(sizeKindOf(idx, 'outer.x', ['plan'])).toBe('duration');
	});
	it('is null for a milestone, a container and an unknown task', () => {
		expect(sizeKindOf(idx, 'outer.m', ['plan'])).toBeNull();
		expect(sizeKindOf(idx, 'outer', ['plan'])).toBeNull();
		expect(sizeKindOf(idx, 'nope', ['plan'])).toBeNull();
	});
});

describe('writtenDates', () => {
	const idx = index(PLAN);
	it("gives the task's own date, then its ancestors', in minutes", () => {
		const w = writtenDates(idx, 'outer.l', 'start', ['plan'], START);
		expect(w.map(({ task, at, inherited }) => ({ task, at, inherited }))).toEqual([
			{ task: 'outer.l', at: 3 * 1440, inherited: false },
			{ task: 'outer', at: 1440, inherited: true },
		]);
		expect(writtenDates(idx, 'outer.l', 'start', ['late', 'plan'], START)[0]?.at).toBe(7 * 1440);
	});
	it('only inherits where the task writes nothing', () => {
		expect(writtenDates(idx, 'outer.e', 'start', ['plan'], START)).toMatchObject([
			{ task: 'outer', at: 1440, inherited: true },
		]);
		expect(writtenDates(idx, 'outer.e', 'end', ['plan'], START)).toEqual([]);
	});
	it('gives null for a date it cannot read (a macro)', () => {
		expect(writtenDates(idx, 'outer.x', 'start', ['plan'], START)[0]).toMatchObject({
			task: 'outer.x',
			at: null,
			inherited: false,
		});
	});
	it('reads a local date in the plan zone (Berlin, winter: UTC+1)', () => {
		const berlin = index(`project p "P" 2026-01-05 - 2026-03-02 {
  timezone "Europe/Berlin"
}
task t "T" {
  start 2026-01-06-09:00
  effort 1d
}
`);
		// The project starts at local midnight, 2026-01-04T23:00Z.
		const start = Date.parse('2026-01-04T23:00:00Z') / 1000;
		expect(writtenDates(berlin, 't', 'start', ['plan'], start)[0]?.at).toBe(1440 + 540);
	});
});

describe('limits', () => {
	const idx = index(PLAN);
	it("collects the task's own limits and every ancestor's", () => {
		expect(taskLimitSites(idx, 'outer.e', ['plan']).length).toBe(1);
		expect(taskLimitSites(idx, 'outer', ['plan']).length).toBe(1);
	});
	it("gives a person's own limits, else the nearest group's", () => {
		const bo = personLimitSite(idx, 'bo', ['plan']);
		const ann = personLimitSite(idx, 'ann', ['plan']);
		const team = personLimitSite(idx, 'team', ['plan']);
		expect(bo).not.toBeNull();
		expect(ann).toEqual(team);
		expect(bo).not.toEqual(team);
		expect(personLimitSite(idx, 'nobody', ['plan'])).toBeNull();
	});
});
