// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { segmentKey, viewKey } from '../workload/prefs';
import { PeopleViewState } from './people-view.svelte';
import type { PrefStorage } from './storage';

function memory(): PrefStorage & { map: Map<string, string> } {
	const map = new Map<string, string>();
	return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

describe('PeopleViewState', () => {
	it('starts on the Gantt and the Load segment', () => {
		const s = new PeopleViewState({ storage: memory() });
		s.use('plan');
		expect(s.view).toBe('gantt');
		expect(s.segment).toBe('load');
	});

	it('remembers the view and the segment per plan, and restores them in a new session', () => {
		const storage = memory();
		const a = new PeopleViewState({ storage });
		a.use('one');
		a.setView('resources');
		a.setSegment('team');
		a.use('two');
		expect([a.view, a.segment]).toEqual(['gantt', 'load']);
		a.setView('calendar');
		a.use('one');
		expect([a.view, a.segment]).toEqual(['resources', 'team']);
		const b = new PeopleViewState({ storage });
		b.use('two');
		expect([b.view, b.segment]).toEqual(['calendar', 'load']);
	});

	it('does not store a choice made before any plan is open', () => {
		const storage = memory();
		const s = new PeopleViewState({ storage });
		s.setView('workload');
		expect(storage.map.size).toBe(0);
	});

	it('uses what is stored only when it names a view or a segment', () => {
		const storage = memory();
		storage.map.set(viewKey('p'), 'timeline');
		storage.map.set(segmentKey('p'), 'workload');
		const s = new PeopleViewState({ storage });
		s.use('p');
		expect([s.view, s.segment]).toEqual(['gantt', 'load']);
	});

	it('lets a linked view win once, for the first plan only, and still remembers later choices', () => {
		const storage = memory();
		storage.map.set(viewKey('one'), 'calendar');
		const s = new PeopleViewState({ storage, linked: 'workload' });
		s.use('one');
		expect(s.view).toBe('workload');
		s.use('one');
		expect(s.view).toBe('calendar');
		const bad = new PeopleViewState({ storage, linked: 'nonsense' });
		bad.use('one');
		expect(bad.view).toBe('calendar');
	});

	it('opens a plan that was just made on the Gantt and Load, whatever its key holds', () => {
		const storage = memory();
		const s = new PeopleViewState({ storage });
		s.use('new');
		s.setView('resources');
		s.setSegment('team');
		s.use('new', true);
		expect([s.view, s.segment]).toEqual(['gantt', 'load']);
		// The next choice is remembered again, and an ordinary open reads it.
		s.setView('calendar');
		s.use('new');
		expect(s.view).toBe('calendar');
	});

	it('works with storage that is missing', () => {
		const s = new PeopleViewState({ storage: null });
		s.use('p');
		s.setView('resources');
		expect(s.view).toBe('resources');
	});
});
