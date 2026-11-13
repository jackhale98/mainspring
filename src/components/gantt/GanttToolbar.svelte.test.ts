// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The Gantt toolbar's Critical path chip and task line (T5): the unavailable chip is reachable and
// says why, and an unchanged task line leaves its live region alone (no re-announcement on a
// reschedule).
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chipOf } from '../../lib/gantt/analysis';
import type { RowLine } from '../../lib/gantt/describe';
import type { DrivingAnalysis } from '../../lib/schedule/critical';
import GanttToolbar from './GanttToolbar.svelte';

const LINE: RowLine = {
	text: 'Code: Mon, Jan 5, 2026 to Wed, Jan 7, 2026',
	note: 'On the critical path (estimate)',
};
const ANALYSIS = {
	critical: new Set(['code']),
	path: new Set(['code']),
} as unknown as DrivingAnalysis;

function setup(over: { analysis?: DrivingAnalysis | null; selected?: RowLine } = {}) {
	const oncritical = vi.fn();
	const props = $state({
		pxPerDay: 18,
		selected: over.selected ?? LINE,
		hover: { text: '', note: null } as RowLine,
		hasMarker: true,
		lines: { today: null, status: null, merged: false },
		dimmed: false,
		critical: chipOf(over.analysis === undefined ? ANALYSIS : over.analysis, true),
		onlevel: () => undefined,
		ontoday: () => undefined,
		oncritical,
	});
	const target = document.createElement('div');
	document.body.append(target);
	const app = mount(GanttToolbar, { target, props });
	flushSync();
	return { props, target, app, oncritical };
}

const mounted: Array<ReturnType<typeof mount>> = [];
afterEach(() => {
	for (const app of mounted.splice(0)) void unmount(app);
	document.body.innerHTML = '';
});

describe('the Critical path chip', () => {
	it('is aria-disabled, focusable and described by its reason while there is no analysis', () => {
		const { target, app, oncritical } = setup({ analysis: null });
		mounted.push(app);
		const chip = target.querySelector<HTMLButtonElement>('button.critical');
		if (!chip) throw new Error('no chip');
		expect(chip.getAttribute('aria-disabled')).toBe('true');
		expect(chip.disabled).toBe(false);
		expect(chip.hasAttribute('aria-pressed')).toBe(false);
		const why = target.querySelector(`#${chip.getAttribute('aria-describedby') ?? ''}`);
		expect(why?.textContent).toBe('The critical path is not computed yet');
		chip.click();
		expect(oncritical).not.toHaveBeenCalled();
	});

	it('is pressed and describes the estimates once the analysis exists', () => {
		const { target, app, oncritical } = setup();
		mounted.push(app);
		const chip = target.querySelector<HTMLButtonElement>('button.critical');
		expect(chip?.getAttribute('aria-pressed')).toBe('true');
		expect(chip?.hasAttribute('aria-disabled')).toBe(false);
		expect(target.querySelector('#critical-why')?.textContent).toMatch(/estimates/);
		chip?.click();
		expect(oncritical).toHaveBeenCalledOnce();
	});
});

describe('the task line', () => {
	it('shows the note apart from the line, and leaves the live region alone when nothing changes', () => {
		const { props, target, app } = setup();
		mounted.push(app);
		const live = target.querySelector('[role="status"]');
		if (!live) throw new Error('no live region');
		expect(live.querySelector('.text')?.textContent).toBe(LINE.text);
		expect(live.querySelector('.note')?.textContent).toBe('. On the critical path (estimate)');

		const observer = new MutationObserver(() => undefined);
		observer.observe(live, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true,
		});
		// A reschedule that leaves the selected task's line as it was: a new, equal object.
		props.selected = { ...LINE };
		props.critical = chipOf({ ...ANALYSIS } as DrivingAnalysis, true);
		flushSync();
		expect(observer.takeRecords()).toEqual([]);

		// The note changes: the region does change.
		props.selected = { ...LINE, note: 'Float about 2 working days (estimate)' };
		flushSync();
		expect(observer.takeRecords().length).toBeGreaterThan(0);
		observer.disconnect();
	});

	it('shows the note on an empty highlight when nothing is selected', () => {
		const done = { critical: new Set(), path: new Set(['a']) } as unknown as DrivingAnalysis;
		const { target, app } = setup({ analysis: done, selected: { text: '', note: null } });
		mounted.push(app);
		const live = target.querySelector('[role="status"]');
		expect(live?.classList.contains('sr-only')).toBe(false);
		expect(live?.textContent?.trim()).toBe(
			'Every task on the critical path ends before the status date',
		);
	});
});
