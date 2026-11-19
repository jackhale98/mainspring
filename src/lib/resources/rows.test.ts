// SPDX-License-Identifier: GPL-2.0-or-later
// The resource table's data (rows.ts): the rows with the engine's efficiency and booked hours, the
// drop rows a drag offers, where a new person or group goes, and the window of a long table.
import { describe, expect, it } from 'vitest';
import { rootsOf } from '../gantt/reorder';
import { at, plan } from '../schedule/testing';
import { buildOutline, visibleRows } from '../state/outline';
import { booking, indexOf, resourceResult, withPeople } from '../workload/testing';
import {
	addSpot,
	dropRows,
	hoursText,
	openRows,
	TABLE_WINDOW_THRESHOLD,
	tableRows,
	tableWindow,
	treeOf,
} from './rows';

const TEXT = `project p "P" 2026-01-05 +8w
resource team "Team" {
  resource a "Ann" { efficiency 0.8 }
  resource b "Bob"
}
resource c "Cy"
resource crew "Crew"
task t1 "Build" { effort 4d  allocate a }
task t2 "Test" { effort 2d  allocate c }
`;
const ix = indexOf(TEXT);
const nodes = buildOutline(ix).resources;
const result = withPeople(
	plan([['t1', { start: at(0, 9), end: at(1, 17) }]]),
	[
		resourceResult('team', { group: true }),
		resourceResult('a', { parent: 'team', efficiency: 0.8 }),
		resourceResult('b', { parent: 'team' }),
		resourceResult('c'),
		resourceResult('crew'),
	],
	[
		booking('a', 't1', [
			[at(0, 9), at(0, 17)],
			[at(1, 9), at(1, 13)],
		]),
		booking('c', 't2', [[at(0, 9), at(0, 11)]]),
	],
);

describe('tableRows', () => {
	const rows = tableRows(visibleRows(nodes, new Set()), ix, result);
	const row = (id: string) => rows.find((r) => r.node.id === id)!;

	it('has one row per resource in plan order, with its group', () => {
		expect(rows.map((r) => r.node.id)).toEqual(['team', 'a', 'b', 'c', 'crew']);
		expect(row('a').groupName).toBe('Team');
		expect(row('team').groupName).toBeNull();
		expect(row('team')).toMatchObject({ expandable: true, expanded: true });
	});

	it('shows the engine’s efficiency and the exact hours booked, a group the sum of its members', () => {
		expect(row('a')).toMatchObject({ efficiency: '0.8', booked: 12 * 60 });
		expect(row('b')).toMatchObject({ efficiency: '1', booked: 0 });
		expect(row('team').booked).toBe(12 * 60);
		expect(row('c').booked).toBe(2 * 60);
	});

	it('knows who is allocated, and has no numbers before the first result', () => {
		expect(row('a').allocated).toBe(true);
		expect(row('b').allocated).toBe(false);
		const none = tableRows(visibleRows(nodes, new Set()), ix, null);
		expect(none.every((r) => r.efficiency === null && r.booked === null)).toBe(true);
	});

	it('leaves the members of a closed group out', () => {
		const shut = tableRows(visibleRows(nodes, new Set(['resource:team'])), ix, result);
		expect(shut.map((r) => r.node.id)).toEqual(['team', 'c', 'crew']);
		expect(shut[0]).toMatchObject({ expandable: true, expanded: false });
	});
});

describe('openRows', () => {
	it('is the outline’s own rule for the rows that show', () => {
		for (const shut of [[], ['resource:team'], ['resource:team', 'resource:c']]) {
			expect(openRows(nodes, new Set(shut))).toEqual(visibleRows(nodes, new Set(shut)));
		}
	});
});

describe('hoursText', () => {
	it('is hours without a trailing zero', () => {
		expect(hoursText(2280)).toBe('38 h');
		expect(hoursText(2265)).toBe('37.75 h');
		expect(hoursText(0)).toBe('0 h');
	});
});

describe('dropRows', () => {
	it('marks what can take people as a container: a group, or an unallocated resource', () => {
		const rows = dropRows(tableRows(visibleRows(nodes, new Set()), ix, result), ix);
		expect(rows.map((r) => [r.key, r.kind, r.depth, r.expanded])).toEqual([
			['resource:team', 'container', 0, true],
			['resource:a', 'task', 1, null],
			['resource:b', 'container', 1, null],
			['resource:c', 'task', 0, null],
			['resource:crew', 'container', 0, null],
		]);
	});
});

describe('addSpot', () => {
	it('puts a person at the end of the selected group, else after the selected person', () => {
		expect(addSpot(nodes, 'resource:team', 'person', ix)).toEqual({ parent: 'team', index: 2 });
		expect(addSpot(nodes, 'resource:a', 'person', ix)).toEqual({ parent: 'team', index: 1 });
		expect(addSpot(nodes, 'resource:c', 'person', ix)).toEqual({ parent: null, index: 2 });
	});

	it('puts a group after the selected row, as a sibling', () => {
		expect(addSpot(nodes, 'resource:team', 'group', ix)).toEqual({ parent: null, index: 1 });
		expect(addSpot(nodes, 'resource:a', 'group', ix)).toEqual({ parent: 'team', index: 1 });
	});

	it('is the end of the top level with nothing selected, or a selection the outline lacks', () => {
		expect(addSpot(nodes, null, 'person', ix)).toEqual({ parent: null, index: 3 });
		expect(addSpot(nodes, 'resource:ghost', 'group', ix)).toEqual({ parent: null, index: 3 });
		expect(addSpot([], null, 'person', ix)).toEqual({ parent: null, index: 0 });
	});

	it('has no place for a selection under a parent the index cannot name (never the end)', () => {
		// The outline as it would be if Team were declared by a macro: a node with no id.
		const hidden = nodes.map((n) => (n.key === 'resource:team' ? { ...n, id: null } : n));
		expect(addSpot(hidden, 'resource:a', 'group', ix)).toBeNull();
		expect(addSpot(hidden, 'resource:c', 'group', ix)).toEqual({ parent: null, index: 1 });
	});

	it('does not count the roots it cannot name', () => {
		const tree = treeOf(nodes);
		expect(
			rootsOf(
				tree,
				nodes.map((n) => n.key),
			),
		).toEqual(['resource:team', 'resource:c', 'resource:crew']);
	});
});

describe('tableWindow', () => {
	it('mounts everything up to the threshold', () => {
		expect(tableWindow(TABLE_WINDOW_THRESHOLD, 500, 400, 40)).toEqual({
			start: 0,
			end: TABLE_WINDOW_THRESHOLD,
			before: 0,
			after: 0,
		});
	});

	it('mounts the rows in view and an overscan, with spacers for the rest', () => {
		const w = tableWindow(1000, 4000, 400, 40, 5);
		expect(w).toEqual({ start: 95, end: 115, before: 95 * 40, after: 885 * 40 });
		expect(tableWindow(1000, 0, 400, 40, 5)).toMatchObject({ start: 0, end: 15, before: 0 });
		expect(tableWindow(1000, 999_999, 400, 40, 5)).toMatchObject({ end: 1000, after: 0 });
	});

	it('mounts everything until the view is measured', () => {
		expect(tableWindow(1000, 0, 0, 40)).toMatchObject({ start: 0, end: 1000 });
	});
});
