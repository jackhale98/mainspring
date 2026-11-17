// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { GanttFilterState } from './gantt-filter.svelte';

describe('GanttFilterState', () => {
	it('starts with no filter', () => {
		const f = new GanttFilterState();
		expect(f.active).toBe(false);
		expect(f.value).toEqual({ person: null, flag: null });
	});

	it('sets a person and a flag apart, and both are the filter', () => {
		const f = new GanttFilterState();
		f.setPerson('ana');
		expect([f.active, f.value]).toEqual([true, { person: 'ana', flag: null }]);
		f.setFlag('key');
		expect(f.value).toEqual({ person: 'ana', flag: 'key' });
		f.setPerson(null);
		expect(f.value).toEqual({ person: null, flag: 'key' });
		f.setFlag(null);
		expect(f.active).toBe(false);
	});

	it('showPerson is what "Show in Gantt" does: only that person', () => {
		const f = new GanttFilterState();
		f.setFlag('key');
		f.showPerson('ben');
		expect(f.value).toEqual({ person: 'ben', flag: null });
	});

	it('opens everything again when the filter changes, and keeps what a twisty closed until then', () => {
		const f = new GanttFilterState();
		f.setPerson('ana');
		f.toggle('task:app');
		expect(f.collapsed.has('task:app')).toBe(true);
		f.setPerson('ana');
		expect(f.collapsed.has('task:app')).toBe(true);
		f.toggle('task:app');
		expect(f.collapsed.size).toBe(0);
		f.toggle('task:app');
		f.setFlag('key');
		expect(f.collapsed.size).toBe(0);
	});

	it('clear takes the filter off', () => {
		const f = new GanttFilterState();
		f.setPerson('ana');
		f.setFlag('key');
		f.toggle('task:app');
		f.clear();
		expect([f.active, f.collapsed.size]).toEqual([false, 0]);
	});
});
