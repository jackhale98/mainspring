// SPDX-License-Identifier: GPL-2.0-or-later
// The heatmap's state (heat-state.svelte.ts, phase-3.md 8.3, 18.3): the model is built in an idle
// task, never in the call that offers the result; zoom, unit, thresholds and collapsed groups are
// stored per plan; a plan switch never builds the previous plan's result with the new plan's
// preferences; a bad threshold pair is refused; dimming re-wraps the model without a rebuild.
import { describe, expect, it } from 'vitest';
import type { ScheduleResult } from '../../engine/protocol';
import { at, plan } from '../../lib/schedule/testing';
import type { PrefStorage } from '../../lib/state/storage';
import { booking, indexOf, resourceResult, withPeople } from '../../lib/workload/testing';
import { HeatState } from './heat-state.svelte';

const TEXT = `project p "P" 2026-01-05 - 2026-03-02 {
}
resource team "Team" {
  resource dev1 "Dev 1"
}
resource solo "Solo"
task a "A" { effort 2d allocate dev1 }
`;
const index = indexOf(TEXT);
const result = (): ScheduleResult =>
	withPeople(
		plan([['a', { start: at(0, 9), end: at(1, 17) }]]),
		[
			resourceResult('team', { group: true }),
			resourceResult('dev1', { parent: 'team' }),
			resourceResult('solo'),
		],
		[booking('dev1', 'a', [[at(0, 9), at(0, 17)]])],
	);

function memory(): PrefStorage & { map: Map<string, string> } {
	const map = new Map<string, string>();
	return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}
const idle = () => new Promise((r) => setTimeout(r, 30));

describe('HeatState', () => {
	it('builds the model in an idle task, not in the call that offers the result', async () => {
		const s = new HeatState(memory());
		s.use('one');
		s.offer(result(), index);
		expect(s.built).toBeNull();
		await idle();
		expect(s.built?.model.rows.map((r) => r.id)).toEqual(['team', 'dev1', 'solo']);
		expect(s.built?.model.axis.kind).toBe('week');
		s.dispose();
	});

	it('builds again for a new result and not for the same one', async () => {
		const s = new HeatState(memory());
		s.use('one');
		const r = result();
		s.offer(r, index);
		await idle();
		const first = s.built;
		s.offer(r, index);
		await idle();
		expect(s.built).toBe(first);
		s.offer(result(), index);
		await idle();
		expect(s.built).not.toBe(first);
		s.dispose();
	});

	it('stores zoom, unit, thresholds and collapsed groups per plan and rebuilds for zoom and collapse', async () => {
		const store = memory();
		const s = new HeatState(store);
		s.use('one');
		s.offer(result(), index);
		await idle();
		s.setZoom('day');
		expect(s.built?.model.axis.kind).toBe('day');
		s.toggleGroup('team');
		expect(s.built?.model.rows.map((r) => r.id)).toEqual(['team', 'solo']);
		s.setUnit('percent');
		expect(s.setThresholds({ spareBelow: 50, overAbove: 90 })).toBe(true);
		const saved = JSON.parse(store.map.get('mainspring.workload.one') ?? '{}');
		expect(saved).toEqual({
			zoom: 'day',
			unit: 'percent',
			thresholds: { spareBelow: 50, overAbove: 90 },
			collapsed: ['team'],
		});
		// Another HeatState on the same storage starts from them.
		const again = new HeatState(store);
		again.use('one');
		expect(again.prefs).toMatchObject({ zoom: 'day', unit: 'percent' });
		s.dispose();
	});

	it('refuses a bad threshold pair and keeps the old one', () => {
		const s = new HeatState(memory());
		s.use('one');
		expect(s.setThresholds({ spareBelow: 120, overAbove: 100 })).toBe(false);
		expect(s.prefs.thresholds).toEqual({ spareBelow: 80, overAbove: 100 });
	});

	it("does not build the previous plan's result with the next plan's preferences", async () => {
		const store = memory();
		store.setItem('mainspring.workload.two', JSON.stringify({ zoom: 'month' }));
		const s = new HeatState(store);
		s.use('one');
		s.offer(result(), index);
		await idle();
		expect(s.built).not.toBeNull();
		// The plan id changes while the old plan's result is still the runner's.
		s.use('two');
		expect(s.prefs.zoom).toBe('month');
		expect(s.built).toBeNull();
		await idle();
		expect(s.built).toBeNull();
		// The new plan's result arrives and is built with its own preferences.
		s.offer(result(), index);
		await idle();
		expect(s.built?.model.axis.kind).toBe('month');
		s.dispose();
	});

	it('dims by re-wrapping the model, with no rebuild', async () => {
		const s = new HeatState(memory());
		s.use('one');
		s.offer(result(), index);
		await idle();
		const built = s.built;
		const dim = s.shown(true);
		expect(dim?.dimmed).toBe(true);
		expect(dim?.booked).toEqual(built?.model.booked);
		expect(s.built).toBe(built);
		expect(s.shown(false)?.dimmed).toBe(false);
		s.dispose();
	});

	it('shows nothing without a result or an index', async () => {
		const s = new HeatState(memory());
		s.use('one');
		s.offer(result(), index);
		await idle();
		s.offer(null, index);
		expect(s.built).toBeNull();
		expect(s.shown(false)).toBeNull();
	});
});

describe('HeatState as the lanes use it (a zoom of its own)', () => {
	const lanes = (store: PrefStorage) =>
		new HeatState(store, { zoomKey: (plan) => `mainspring.lanes.zoom.${plan}` });

	it("keeps its zoom under its own key and leaves the heatmap's zoom alone", async () => {
		const store = memory();
		const heat = new HeatState(store);
		heat.use('one');
		heat.setZoom('month');
		const s = lanes(store);
		s.use('one');
		// The lanes start on the week, whatever the heatmap shows.
		expect(s.prefs.zoom).toBe('week');
		s.offer(result(), index);
		await idle();
		s.setZoom('day');
		expect(s.built?.model.axis.kind).toBe('day');
		expect(store.map.get('mainspring.lanes.zoom.one')).toBe('day');
		expect(JSON.parse(store.map.get('mainspring.workload.one') ?? '{}').zoom).toBe('month');
		// Another change of the lanes (an open group) does not move the heatmap's zoom either.
		s.toggleGroup('team');
		expect(JSON.parse(store.map.get('mainspring.workload.one') ?? '{}')).toMatchObject({
			zoom: 'month',
			collapsed: ['team'],
		});
		// A new instance reads the lanes' zoom back.
		const again = lanes(store);
		again.use('one');
		expect(again.prefs.zoom).toBe('day');
		s.dispose();
	});

	it("takes up the other view's thresholds and open groups when shown again, rebuilding for groups", async () => {
		const store = memory();
		const s = lanes(store);
		s.use('one');
		s.offer(result(), index);
		await idle();
		expect(s.built?.model.rows.map((r) => r.id)).toEqual(['team', 'dev1', 'solo']);
		const heat = new HeatState(store);
		heat.use('one');
		heat.toggleGroup('team');
		heat.setThresholds({ spareBelow: 40, overAbove: 70 });
		s.refresh();
		expect(s.prefs.thresholds).toEqual({ spareBelow: 40, overAbove: 70 });
		expect(s.built?.model.rows.map((r) => r.id)).toEqual(['team', 'solo']);
		// Nothing new: nothing rebuilt.
		const built = s.built;
		s.refresh();
		expect(s.built).toBe(built);
		s.dispose();
	});

	it('refreshes nothing before a plan is open', () => {
		const s = lanes(memory());
		expect(() => s.refresh()).not.toThrow();
	});
});
