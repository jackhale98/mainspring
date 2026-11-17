// SPDX-License-Identifier: GPL-2.0-or-later
// What a person's details read (person.ts): fields with their inherited and text-only states,
// managers that accumulate, the tasks booked (a group sums its members), and who can manage whom.
import { describe, expect, it } from 'vitest';
import { at, plan } from '../schedule/testing';
import { booking, indexOf, resourceResult, withPeople } from '../workload/testing';
import {
	bookedMinutes,
	bookedTasks,
	isAllocated,
	managerChoices,
	managersOf,
	personDetails,
} from './person';

const TEXT = `project p "P" 2026-01-05 +8w
resource team "Team" {
  efficiency 0.9
  managers boss
  resource a "Ann" {
    efficiency 0.8
    rate 400
    email "ann@example.com"
    managers lead
  }
  resource b "Bob"
}
resource boss "Boss"
resource lead "Lead"
macro RATE [ 123 ]
resource m "Macro" {
  rate \${RATE}
}
task t1 "Build" { effort 4d  allocate a }
task t2 "Test" { effort 2d  allocate b }
`;
const ix = indexOf(TEXT);

const result = withPeople(
	plan([
		['t1', { start: at(0, 9), end: at(4, 17) }],
		['t2', { start: at(0, 9), end: at(2, 17) }],
	]),
	[
		resourceResult('team', { group: true }),
		resourceResult('a', { parent: 'team' }),
		resourceResult('b', { parent: 'team' }),
		resourceResult('boss'),
		resourceResult('lead'),
		resourceResult('m'),
	],
	[
		booking('a', 't1', [
			[at(0, 9), at(0, 17)],
			[at(1, 9), at(1, 17)],
		]),
		booking('b', 't2', [[at(0, 9), at(0, 12)]]),
		booking('a', 't2', [[at(2, 9), at(2, 11)]]),
	],
);

describe('personDetails', () => {
	it('reads own fields, and the group they belong to', () => {
		const d = personDetails(ix, result, 'a');
		expect(d).toMatchObject({
			id: 'a',
			name: 'Ann',
			isGroup: false,
			group: { id: 'team', name: 'Team' },
			efficiency: { kind: 'own', text: '0.8' },
			rate: { kind: 'own', text: '400' },
			email: { kind: 'own', text: 'ann@example.com' },
			declaration: null,
		});
	});

	it('shows what a group gives, and where from', () => {
		const d = personDetails(ix, result, 'b');
		expect(d?.efficiency).toMatchObject({
			kind: 'inherited',
			text: '0.9',
			from: 'team',
			fromName: 'Team',
		});
		expect(d?.rate).toEqual({ kind: 'unset' });
	});

	it('knows a group from a person', () => {
		expect(personDetails(ix, result, 'team')).toMatchObject({ isGroup: true, group: null });
	});

	it('says a field written with a macro is text only', () => {
		expect(personDetails(ix, result, 'm')?.rate).toMatchObject({
			kind: 'text-only',
			reason: 'macro-call',
		});
	});

	it('is null for a resource the index does not have', () => {
		expect(personDetails(ix, result, 'nobody')).toBeNull();
	});
});

describe('what a group writes after its member does not reach the member', () => {
	const late = indexOf(`project p "P" 2026-01-05 +8w
resource team "Team" {
  resource a "Ann"
  efficiency 0.5
  managers boss
}
resource boss "Boss"
supplement resource team {
  rate 400
}
`);
	it('is shown for the group, and not as inherited on the member', () => {
		expect(personDetails(late, null, 'team')).toMatchObject({
			efficiency: { kind: 'own', text: '0.5' },
			rate: { kind: 'own', text: '400' },
			managers: { own: ['boss'], inherited: [] },
		});
		expect(personDetails(late, null, 'a')).toMatchObject({
			efficiency: { kind: 'unset' },
			rate: { kind: 'unset' },
			managers: { own: [], inherited: [] },
		});
	});
});

describe('managers', () => {
	it('accumulate: the person’s own, and what every group above gives', () => {
		expect(managersOf(ix, ix.resources.get('a')!)).toEqual({
			own: ['lead'],
			inherited: ['boss'],
			textOnly: null,
		});
		expect(managersOf(ix, ix.resources.get('b')!)).toEqual({
			own: [],
			inherited: ['boss'],
			textOnly: null,
		});
	});

	it('a person can be managed by any leaf outside their own subtree', () => {
		expect(managerChoices(ix, 'a').map((c) => c.id)).toEqual(['b', 'boss', 'lead', 'm']);
		// A group cannot be managed by its own members, and a group is not a manager.
		expect(managerChoices(ix, 'team').map((c) => c.id)).toEqual(['boss', 'lead', 'm']);
	});
});

describe('booked time', () => {
	it('sums the first scenario’s bookings per resource, a group over its members', () => {
		const m = bookedMinutes(result);
		expect(m.get('a')).toBe(18 * 60);
		expect(m.get('b')).toBe(3 * 60);
		expect(m.get('team')).toBe((m.get('a') ?? 0) + (m.get('b') ?? 0));
		expect(m.get('boss')).toBeUndefined();
	});

	it('lists a person’s tasks, the most time first, and a group’s over its members', () => {
		expect(bookedTasks(result, 'a')).toEqual([
			{ id: 't1', name: 't1', minutes: 16 * 60 },
			{ id: 't2', name: 't2', minutes: 2 * 60 },
		]);
		expect(bookedTasks(result, 'team').map((t) => [t.id, t.minutes])).toEqual([
			['t1', 16 * 60],
			['t2', 5 * 60],
		]);
		expect(bookedTasks(null, 'a')).toEqual([]);
	});

	it('puts the details’ total in minutes', () => {
		expect(personDetails(ix, result, 'b')).toMatchObject({ bookedMinutes: 3 * 60 });
	});
});

describe('isAllocated', () => {
	it('is true for a resource an allocate names, and false for the rest', () => {
		expect(isAllocated(ix, 'a')).toBe(true);
		expect(isAllocated(ix, 'b')).toBe(true);
		expect(isAllocated(ix, 'boss')).toBe(false);
		expect(isAllocated(ix, 'team')).toBe(false);
	});
});
