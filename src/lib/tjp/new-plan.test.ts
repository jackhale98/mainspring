// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { localDiagnostics } from './diagnostics';
import { createTimeZoneHost } from '../../engine/runtime';
import { createWorkspace } from '../workspace/workspace';
import { applyIntent } from './edit/apply';
import { textsAfter } from './edit/testing';
import { buildIndex } from './index';
import { cleanPlanName, newPlanProblem, newPlanText, planId } from './new-plan';

const text = (name: string, start = '2026-11-14', timezone: string | null = 'Europe/Berlin') =>
	newPlanText({ name, start, timezone }).files['plan.tjp'];

describe('newPlanText', () => {
	it('writes the header and nothing else', () => {
		expect(
			newPlanText({ name: 'Website', start: '2026-11-14', timezone: 'Europe/Berlin' }),
		).toEqual({
			entry: 'plan.tjp',
			files: {
				'plan.tjp': 'project website "Website" 2026-11-14 +1y {\n  timezone "Europe/Berlin"\n}\n',
			},
		});
	});

	it('writes no timezone line, and no block, for None (UTC)', () => {
		expect(text('Launch plan', '2027-01-04', null)).toBe(
			'project launch_plan "Launch plan" 2027-01-04 +1y\n',
		);
	});

	it('escapes the name as a TaskJuggler string', () => {
		expect(text('The "big" one', '2026-11-14', null)).toBe(
			'project the_big_one "The \\"big\\" one" 2026-11-14 +1y\n',
		);
		expect(text("It's a C:\\temp plan", '2026-11-14', null)).toContain('"It\'s a C:\\temp plan"');
	});

	it('cleans white space in the name', () => {
		expect(cleanPlanName('  a \n  b\t c ')).toBe('a b c');
		expect(text('  Two   words ', '2026-11-14', null)).toContain('two_words "Two words"');
	});

	it('refuses names and values it cannot write', () => {
		expect(() => text('')).toThrow(RangeError);
		expect(() => text('Cost ${x}')).toThrow(RangeError);
		expect(() => text('Plan', '2026-02-30')).toThrow(RangeError);
	});
});

describe('planId', () => {
	it('uses the edit API slug', () => {
		expect(planId('Fedora 20 release')).toBe('fedora_20_release');
		expect(planId('2027 plan')).toBe('_2027_plan');
		expect(planId('Café Müller')).toBe('cafe_muller');
	});
	it('falls back to plan when the name has no letter or digit', () => {
		expect(planId('???')).toBe('plan');
		expect(planId('日本語')).toBe('plan');
		expect(planId('!')).toBe('plan');
		// Underscores alone make no id either: the slug would be empty, and `task` is not a plan's.
		expect(planId('___')).toBe('plan');
		expect(planId('_')).toBe('plan');
		expect(planId('a_')).toBe('a');
	});
});

describe('newPlanProblem', () => {
	const base = { name: 'X', start: '2026-11-14', timezone: null };
	it('names the first problem', () => {
		expect(newPlanProblem(base)).toBeNull();
		expect(newPlanProblem({ ...base, name: '   ' })).toBe('name-empty');
		expect(newPlanProblem({ ...base, name: 'a $(HOME)' })).toBe('name-unsafe');
		expect(newPlanProblem({ ...base, name: 'ends\\' })).toBe('name-backslash');
		expect(newPlanProblem({ ...base, start: '2026-02-30' })).toBe('start');
		expect(newPlanProblem({ ...base, start: '14/11/2026' })).toBe('start');
		expect(newPlanProblem({ ...base, timezone: 'Zone${x}' })).toBe('zone');
	});
	it('limits the start to the years TaskJuggler reads (the engine says time_error after 2035)', () => {
		expect(newPlanProblem({ ...base, start: '2035-12-31' })).toBeNull();
		expect(newPlanProblem({ ...base, start: '1970-01-01' })).toBeNull();
		expect(newPlanProblem({ ...base, start: '2036-01-01' })).toBe('start');
		expect(newPlanProblem({ ...base, start: '1969-12-31' })).toBe('start');
		expect(() => text('Plan', '2036-01-01')).toThrow(RangeError);
	});
	it('accepts leap days', () => {
		expect(newPlanProblem({ ...base, start: '2028-02-29' })).toBeNull();
		expect(newPlanProblem({ ...base, start: '2027-02-29' })).toBe('start');
	});
});

describe('the text in the grammar and the index', () => {
	const zones = createTimeZoneHost();
	const open = (t: string) => {
		const snap = createWorkspace({ entry: 'plan.tjp', files: { 'plan.tjp': t } }).snapshot();
		return { snap, index: buildIndex(snap, undefined, { cache: null, zones }) };
	};

	it.each([
		['Europe/Berlin', 'Website'],
		[null, 'Launch plan'],
		['America/New_York', 'The "big" one'],
		[null, '???'],
	])('parses with no errors (%s, %s)', (zone, name) => {
		const { snap, index } = open(text(name, '2026-11-14', zone));
		expect(localDiagnostics(snap, index)).toEqual([]);
		expect(index.tasks.size).toBe(0);
		expect(index.project).not.toBeNull();
	});

	it('takes the first task from Add task, with or without a block', () => {
		for (const zone of ['Europe/Berlin', null]) {
			const { snap, index } = open(text('Website', '2026-11-14', zone));
			const r = applyIntent(snap, index, {
				type: 'addTask',
				parent: null,
				index: 0,
				name: 'New task',
			});
			expect(r.status).toBe('edit');
			if (r.status === 'edit') {
				expect(textsAfter(snap, r)['plan.tjp']).toContain('\ntask new_task "New task"\n');
			}
		}
	});

	it('takes a timezone from the project sheet when the header has no block', () => {
		const { snap, index } = open(text('Website', '2026-11-14', null));
		const r = applyIntent(snap, index, {
			type: 'setProjectAttr',
			attr: 'timezone',
			value: '"Europe/Berlin"',
		});
		expect(r.status).toBe('edit');
		if (r.status === 'edit') {
			expect(textsAfter(snap, r)['plan.tjp']).toContain('timezone "Europe/Berlin"');
		}
	});
});
