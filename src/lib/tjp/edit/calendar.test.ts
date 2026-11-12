// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../../../../tests/grammar/corpus';
import { applyIntent } from './apply';
import { setWorkingHours } from './settings';
import { setup, textsAfter } from './testing';
import type { EditIntent, EditResult, Weekday } from './types';

const PLAN = `project p "P" 2026-01-05 - 2026-03-27 {
  now 2026-02-02
  workinghours mon - fri 9:00 - 17:00
  workinghours fri 9:00 - 13:00
}

leaves holiday "Founders day" 2026-02-09
vacation "Closure" 2026-02-23, 2026-02-25

resource ann "Ann" {
  workinghours sat, sun off
  leaves annual 2026-01-19 - 2026-01-23
}
resource bob "Bob"

task t "T" {
  effort 3d
  allocate ann, bob
}
`;

function run(intent: EditIntent, text = PLAN) {
	const s = setup(text);
	const r = applyIntent(s.snap, s.index, intent);
	return { s, r, text: r.status === 'edit' ? textsAfter(s.snap, r)['plan.tjp'] : undefined };
}

const status = (r: EditResult): string =>
	r.status === 'edit' ? 'edit' : `${r.status}:${r.reason}`;
const WEEK: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];

describe('setWorkingHours', () => {
	it('rewrites the statement with the same days when nothing later overrides it', () => {
		const r = run({
			type: 'setWorkingHours',
			scope: { kind: 'project' },
			days: ['fri'],
			hours: [['8:00', '12:00']],
		});
		expect(r.text).toContain(
			'  workinghours mon - fri 9:00 - 17:00\n  workinghours fri 8:00 - 12:00\n',
		);
		const same = run({
			type: 'setWorkingHours',
			scope: { kind: 'project' },
			days: ['fri'],
			hours: [['9:00', '13:00']],
		});
		expect(status(same.r)).toBe('noop:already-set');
	});

	it('appends after the last statement when a later one sets some of the days', () => {
		const r = run({
			type: 'setWorkingHours',
			scope: { kind: 'project' },
			days: WEEK,
			hours: [
				['9:00', '12:00'],
				['13:00', '18:00'],
			],
		});
		expect(r.text).toContain(
			'  workinghours fri 9:00 - 13:00\n  workinghours mon - fri 9:00 - 12:00, 13:00 - 18:00\n}',
		);
	});

	it('places project hours after a timezone or timingresolution that resets them (case whtz)', () => {
		const tz =
			'project p "P" 2026-01-05 - 2026-03-27 {\n  workinghours mon 10:00 - 12:00\n' +
			'  timezone "UTC"\n}\nresource a "A"\ntask t "T" { effort 2d allocate a }\n';
		const tue: EditIntent = {
			type: 'setWorkingHours',
			scope: { kind: 'project' },
			days: ['tue'],
			hours: 'off',
		};
		expect(run(tue, tz).text).toContain(
			'  workinghours mon 10:00 - 12:00\n  timezone "UTC"\n  workinghours tue off\n}',
		);
		// The statement before the reset no longer counts: a new one is written after it.
		const mon: EditIntent = { ...tue, days: ['mon'], hours: [['8:00', '9:00']] };
		expect(run(mon, tz).text).toContain('  timezone "UTC"\n  workinghours mon 8:00 - 9:00\n}');
		const res = tz.replace('  timezone "UTC"\n', '  timingresolution 30min\n  now 2026-02-02\n');
		expect(run(tue, res).text).toContain(
			'  timingresolution 30min\n  workinghours tue off\n  now 2026-02-02\n}',
		);
		// A statement after the reset is rewritten as before.
		const after = tz.replace('  timezone "UTC"\n', '').replace('{\n', '{\n  timezone "UTC"\n');
		expect(run(mon, after).text).toContain('  timezone "UTC"\n  workinghours mon 8:00 - 9:00\n}');
	});

	it('inserts a resource statement by 7.2 order, opening a body', () => {
		expect(
			run({
				type: 'setWorkingHours',
				scope: { kind: 'resource', resource: 'bob' },
				days: ['mon'],
				hours: 'off',
			}).text,
		).toContain('resource bob "Bob" {\n  workinghours mon off\n}');
		expect(
			run({
				type: 'setWorkingHours',
				scope: { kind: 'resource', resource: 'ann' },
				days: ['sat', 'sun'],
				hours: [['10:00', '14:00']],
			}).text,
		).toContain('  workinghours sat, sun 10:00 - 14:00\n  leaves annual');
	});

	it('goes before another scenario prefixed statement', () => {
		const sc = PLAN.replace(
			'  now 2026-02-02\n',
			'  now 2026-02-02\n  scenario plan "Plan" { scenario b "B" }\n',
		).replace('resource bob "Bob"', 'resource bob "Bob" {\n  b:workinghours mon off\n}');
		expect(
			run(
				{
					type: 'setWorkingHours',
					scope: { kind: 'resource', resource: 'bob' },
					days: ['tue'],
					hours: 'off',
				},
				sc,
			).text,
		).toContain('resource bob "Bob" {\n  workinghours tue off\n  b:workinghours mon off\n}');
	});

	it('refuses invalid hours and days', () => {
		const set = (days: Weekday[], hours: Array<[string, string]> | 'off'): string =>
			status(run({ type: 'setWorkingHours', scope: { kind: 'project' }, days, hours }).r);
		expect(set([], 'off')).toBe('refused:invalid-value');
		expect(set(['mon'], [['12:00', '9:00']])).toBe('refused:invalid-value');
		expect(set(['mon'], [['9:00', '25:00']])).toBe('refused:invalid-value');
		expect(set(['mon'], [['9', '10']])).toBe('refused:invalid-value');
		expect(
			status(
				run({
					type: 'setWorkingHours',
					scope: { kind: 'resource', resource: 'zz' },
					days: ['mon'],
					hours: 'off',
				}).r,
			),
		).toBe('refused:unknown-target');
	});

	it('refuses statements written with macros and body macros', () => {
		const m =
			'project p "P" 2026-01-05 +1m\nmacro h [ workinghours mon off ]\nresource a "A" {\n  ${h}\n}\n';
		expect(
			status(
				run(
					{
						type: 'setWorkingHours',
						scope: { kind: 'resource', resource: 'a' },
						days: ['mon'],
						hours: 'off',
					},
					m,
				).r,
			),
		).toBe('refused:macro-in-body');
		const v =
			'project p "P" 2026-01-05 +1m\nmacro d [mon]\nresource a "A" {\n  workinghours ${d} off\n}\n';
		expect(
			status(
				run(
					{
						type: 'setWorkingHours',
						scope: { kind: 'resource', resource: 'a' },
						days: ['tue'],
						hours: 'off',
					},
					v,
				).r,
			),
		).toBe('refused:text-only');
	});

	it('edits statements in a supplement resource body', () => {
		const sup = readFileSync(path.join(ROOT, 'tests/fixtures/tjp/supplement/plan.tjp'), 'utf8');
		// Resource ids are global: `bo` is declared inside `grp`.
		const scope = { kind: 'resource' as const, resource: 'bo' };
		expect(
			run({ type: 'setWorkingHours', scope, days: ['fri'], hours: [['9:00', '12:00']] }, sup).text,
		).toContain('  workinghours mon-thu 9:00-17:00\n  workinghours fri 9:00 - 12:00\n}');
		expect(run({ type: 'setWorkingHours', scope, days: WEEK, hours: 'off' }, sup).text).toContain(
			'  workinghours fri off\n  workinghours mon - fri off\n}',
		);
	});

	it('keeps CRLF and tabs', () => {
		const crlf = 'project p "P" 2026-01-05 +1m {\r\n\tnow 2026-01-06\r\n}\r\n';
		expect(
			run(
				{
					type: 'setWorkingHours',
					scope: { kind: 'project' },
					days: ['sat'],
					hours: [['9:00', '12:00']],
				},
				crlf,
			).text,
		).toBe(
			'project p "P" 2026-01-05 +1m {\r\n\tnow 2026-01-06\r\n\tworkinghours sat 9:00 - 12:00\r\n}\r\n',
		);
	});

	it('the wrapper builds the intent', () => {
		const s = setup(PLAN);
		expect(
			setWorkingHours(s.snap, s.index, { kind: 'project' }, ['fri'], [['9:00', '13:00']]).status,
		).toBe('noop');
	});
});
