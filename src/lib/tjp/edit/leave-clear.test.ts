// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { createTimeZoneHost } from '../../../engine/timezone';
import { createWorkspace } from '../../workspace/workspace';
import { buildIndex } from '../index';
import { labelOf } from '../../workspace/history-steps';
import { applyIntent } from './apply';
import { setup, textsAfter } from './testing';
import type { EditResult, IntentOf } from './types';

const PLAN = `project p "P" 2026-01-05 - 2026-04-27 {
  now 2026-02-02
}

leaves holiday "Founders day" 2026-02-09, holiday "Spring" 2026-03-30 - 2026-04-03
vacation "Closure" 2026-02-23 - 2026-02-28, 2026-03-10

resource team "Team" {
  leaves special "Offsite" 2026-03-16 - 2026-03-18
  resource ann "Ann" {
    leaves annual 2026-01-19 - 2026-01-24, sick 2026-02-04 +3d
    leaves unpaid 2026-03-02
  }
}
resource bob "Bob"

task t "T" {
  effort 3d
  allocate ann, bob
}
`;

type Scope = IntentOf<'clearLeave'>['scope'];
const ANN: Scope = { kind: 'resource', resource: 'ann' };
const ALL: Scope = { kind: 'global' };

const clear = (scope: Scope, start: string, end: string): IntentOf<'clearLeave'> => ({
	type: 'clearLeave',
	scope,
	start,
	end,
});

function run(intent: IntentOf<'clearLeave'>, text = PLAN) {
	const s = setup(text);
	const r = applyIntent(s.snap, s.index, intent);
	return { r, text: r.status === 'edit' ? textsAfter(s.snap, r)['plan.tjp'] : undefined };
}

const status = (r: EditResult): string =>
	r.status === 'edit' ? 'edit' : `${r.status}:${r.reason}`;

/** The text after the edit, which must change only `before` into `after` (one occurrence). */
function expectPatch(intent: IntentOf<'clearLeave'>, before: string, after: string, text = PLAN) {
	expect(text.split(before)).toHaveLength(2);
	expect(run(intent, text).text).toBe(text.replace(before, after));
}

describe('clearLeave', () => {
	it('trims an item over one edge, rewriting only the bound it moves', () => {
		// The end moves: `- 2026-01-24` becomes `- 2026-01-21`.
		expectPatch(
			clear(ANN, '2026-01-21', '2026-01-26'),
			'annual 2026-01-19 - 2026-01-24',
			'annual 2026-01-19 - 2026-01-21',
		);
		// The start moves; the end stays as written.
		expectPatch(
			clear(ANN, '2026-01-15', '2026-01-21'),
			'annual 2026-01-19 - 2026-01-24',
			'annual 2026-01-21 - 2026-01-24',
		);
		// `+3d` counts from the start, so a moved start writes the end as a date (18.5 form).
		expectPatch(
			clear(ANN, '2026-02-01', '2026-02-05'),
			'sick 2026-02-04 +3d',
			'sick 2026-02-05 - 2026-02-07',
		);
		// The one-day form gets an end when its tail is cut.
		expectPatch(
			clear(ANN, '2026-03-02-12:00', '2026-03-04'),
			'unpaid 2026-03-02',
			'unpaid 2026-03-02 - 2026-03-02-12:00',
		);
	});

	it('splits an item that spans the range, keeping its type and name', () => {
		expectPatch(
			clear(ANN, '2026-01-21', '2026-01-22'),
			'annual 2026-01-19 - 2026-01-24',
			'annual 2026-01-19 - 2026-01-21, annual 2026-01-22 - 2026-01-24',
		);
		expectPatch(
			clear(ALL, '2026-04-01', '2026-04-02'),
			'holiday "Spring" 2026-03-30 - 2026-04-03',
			'holiday "Spring" 2026-03-30 - 2026-04-01, holiday "Spring" 2026-04-02 - 2026-04-03',
		);
		// A `+3d` item: the second part ends where the duration did.
		expectPatch(
			clear(ANN, '2026-02-05', '2026-02-06'),
			'sick 2026-02-04 +3d',
			'sick 2026-02-04 - 2026-02-05, sick 2026-02-06 - 2026-02-07',
		);
	});

	it('removes items inside the range with one comma, or the statement', () => {
		expectPatch(
			clear(ANN, '2026-01-19', '2026-01-24'),
			'annual 2026-01-19 - 2026-01-24, sick',
			'sick',
		);
		expectPatch(clear(ANN, '2026-03-01', '2026-03-05'), '    leaves unpaid 2026-03-02\n', '');
		expectPatch(clear(ALL, '2026-02-09', '2026-02-10'), 'holiday "Founders day" 2026-02-09, ', '');
	});

	it('edits every overlapping item of the scope in one edit', () => {
		const r = run(clear(ANN, '2026-01-22', '2026-03-03'));
		expect(r.text).toContain('    leaves annual 2026-01-19 - 2026-01-22\n  }');
		expect(r.text).not.toContain('sick');
		expect(r.text).not.toContain('unpaid');
		expect(r.r.status === 'edit' && r.r.edit.intent.type).toBe('clearLeave');
		// The project scope is the global one.
		expect(run(clear({ kind: 'project' }, '2026-02-09', '2026-02-10')).text).toBe(
			run(clear(ALL, '2026-02-09', '2026-02-10')).text,
		);
	});

	it('trims and removes vacation intervals, but does not split one', () => {
		expectPatch(
			clear(ALL, '2026-02-26', '2026-03-11'),
			'vacation "Closure" 2026-02-23 - 2026-02-28, 2026-03-10',
			'vacation "Closure" 2026-02-23 - 2026-02-26',
		);
		expectPatch(
			clear(ALL, '2026-02-20', '2026-02-24'),
			'2026-02-23 - 2026-02-28,',
			'2026-02-24 - 2026-02-28,',
		);
		const split = run(clear(ALL, '2026-02-24', '2026-02-26')).r;
		expect(status(split)).toBe('refused:unsupported-form');
		expect(split.status === 'refused' && PLAN.slice(split.at[0]?.from, split.at[0]?.to)).toBe(
			'2026-02-23 - 2026-02-28',
		);
	});

	it('is a no-op when nothing overlaps, and refuses leave only inherited', () => {
		expect(status(run(clear(ANN, '2026-01-24', '2026-02-04')).r)).toBe('noop:not-present');
		expect(
			status(run(clear({ kind: 'resource', resource: 'bob' }, '2026-03-20', '2026-03-27')).r),
		).toBe('noop:not-present');
		// Team's offsite and the global holiday are on Ann's calendar, but not hers to clear.
		const team = run(clear(ANN, '2026-03-16', '2026-03-17')).r;
		expect(status(team)).toBe('refused:inherited');
		expect(team.status === 'refused' && PLAN.slice(team.at[0]?.from, team.at[0]?.to)).toBe(
			'special "Offsite" 2026-03-16 - 2026-03-18',
		);
		expect(
			status(run(clear({ kind: 'resource', resource: 'bob' }, '2026-02-09', '2026-02-10')).r),
		).toBe('refused:inherited');
	});

	it('refuses ranges TaskJuggler would not read', () => {
		expect(status(run(clear(ANN, '2026-02-31x', '2026-03-02')).r)).toBe('refused:invalid-value');
		expect(status(run(clear(ANN, '2026-01-22', '2026-01-22')).r)).toBe('refused:invalid-value');
		expect(status(run(clear(ANN, '2026-01-23', '2026-01-21')).r)).toBe('refused:invalid-value');
		// Misaligned with the default 60 min resolution.
		expect(status(run(clear(ANN, '2026-01-21-10:30', '2026-01-22')).r)).toBe(
			'refused:invalid-value',
		);
		expect(
			status(run(clear({ kind: 'resource', resource: 'zed' }, '2026-01-21', '2026-01-22')).r),
		).toBe('refused:unknown-target');
	});

	it('refuses leave written with macros, and body macros that may write leave', () => {
		const written = PLAN.replace(
			'    leaves unpaid 2026-03-02\n',
			'    leaves unpaid ${day}\n',
		).replace('resource team', 'macro day [2026-03-02]\nresource team');
		expect(run(clear(ANN, '2026-01-21', '2026-01-22'), written).r).toMatchObject({
			status: 'refused',
			reason: 'text-only',
		});
		const body = PLAN.replace('    leaves unpaid 2026-03-02\n', '    ${away}\n').replace(
			'resource team',
			'macro away [leaves sick 2026-03-03]\nresource team',
		);
		expect(status(run(clear(ANN, '2026-01-21', '2026-01-22'), body).r)).toBe(
			'refused:macro-in-body',
		);
	});

	it('clears supplement bodies, and only the top scenario', () => {
		const text = `project p "P" 2026-01-05 +3m {
  scenario plan "Plan" { scenario late "Late" }
}
resource ann "Ann" {
  late:leaves annual 2026-02-02 - 2026-02-07
}
supplement resource ann {
  leaves annual 2026-02-02 - 2026-02-07
}
`;
		expect(run(clear(ANN, '2026-02-05', '2026-02-09'), text).text).toBe(
			text.replace(
				'  leaves annual 2026-02-02 - 2026-02-07',
				'  leaves annual 2026-02-02 - 2026-02-05',
			),
		);
	});

	it('compares instants in the plan zone, across a DST change', () => {
		const text = `project p "P" 2026-03-02 +2m {
  timezone "Europe/Berlin"
}
resource ann "Ann" {
  leaves sick 2026-03-28 +2d
}
`;
		const ws = createWorkspace({ entry: 'plan.tjp', files: { 'plan.tjp': text } });
		const snap = ws.snapshot();
		const index = buildIndex(snap, undefined, { zones: createTimeZoneHost(), cache: null });
		// `+2d` is 48 hours: Berlin springs forward on 29 March, so it ends at 01:00 on the 30th.
		const r = applyIntent(snap, index, clear(ANN, '2026-03-27', '2026-03-29'));
		expect(textsAfter(snap, r)['plan.tjp']).toBe(
			text.replace('sick 2026-03-28 +2d', 'sick 2026-03-29 - 2026-03-30-01:00'),
		);
		// Without zone data the instants are unknown, so the edit stops (it could be wrong).
		const blind = buildIndex(snap, undefined, { cache: null });
		expect(status(applyIntent(snap, blind, clear(ANN, '2026-03-27', '2026-03-29')))).toBe(
			'refused:unsupported-form',
		);
	});

	it('has a history label', () => {
		expect(labelOf(clear(ANN, '2026-01-21', '2026-01-22'))).toBe('clear leave');
	});
});
