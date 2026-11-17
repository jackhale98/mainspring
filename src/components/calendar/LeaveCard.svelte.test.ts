// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// A leave's card in the day details (LeaveCard.svelte, W5): a change commits at once; a second change
// made while the first waits to be read back is queued, shown as waiting, and sent on the new text
// rather than dropped (T16 review).
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LeaveFields } from '../../lib/calendar/leave-edit';
import type { PaintItem } from '../../lib/calendar/paint-items';
import type { LeaveType } from '../../lib/tjp/edit/types';
import LeaveCard, { type CommitResult } from './LeaveCard.svelte';

const item = {
	type: 'annual',
	name: 'Trip',
	site: { scope: { kind: 'resource', resource: 'dev' } },
	range: { file: 'plan.tjp', from: 10, to: 40 },
} as unknown as PaintItem;
const TYPES: LeaveType[] = ['annual', 'special', 'sick'];
const BASE: LeaveFields = { type: 'annual', name: 'Trip', start: '2026-01-08', end: '2026-01-09' };

const mounted: Array<ReturnType<typeof mount>> = [];
afterEach(() => {
	for (const m of mounted.splice(0)) void unmount(m);
	document.body.innerHTML = '';
});

function open(oncommit: (i: PaintItem, f: LeaveFields) => Promise<CommitResult>) {
	const props = $state({
		item,
		fields: BASE as LeaveFields | null,
		types: TYPES,
		oncommit,
		onremove: () => {},
	});
	mounted.push(mount(LeaveCard, { target: document.body, props }));
	flushSync();
	return props;
}
const q = <T extends Element>(sel: string): T => {
	const el = document.querySelector<T>(sel);
	if (!el) throw new Error(sel);
	return el;
};
const choose = (value: string): void => {
	const s = q<HTMLSelectElement>('[data-testid="cal-leave-type"]');
	s.value = value;
	s.dispatchEvent(new Event('change', { bubbles: true }));
};
const rename = (value: string): void => {
	const i = q<HTMLInputElement>('[data-testid="cal-leave-name"]');
	i.value = value;
	i.dispatchEvent(new FocusEvent('blur'));
};

describe('LeaveCard', () => {
	it('commits a change at once, with the fields as they now are', async () => {
		const oncommit = vi.fn(async (_i: PaintItem, _f: LeaveFields): Promise<CommitResult> => ({
			applied: true,
		}));
		open(oncommit);
		choose('sick');
		await tick();
		expect(oncommit).toHaveBeenCalledTimes(1);
		expect(oncommit.mock.calls[0]?.[1]).toEqual({ ...BASE, type: 'sick' });
	});

	it('queues a second change while the first is read back, shows it, and sends it after', async () => {
		const oncommit = vi.fn(async (_i: PaintItem, _f: LeaveFields) => ({ applied: true }));
		const props = open(oncommit);
		choose('sick');
		await tick();
		await tick();
		rename('Beach');
		await tick();
		// Not sent yet, and said to be waiting; the card is busy.
		expect(oncommit).toHaveBeenCalledTimes(1);
		expect(document.querySelector('[data-testid="cal-leave-waiting"]')).not.toBeNull();
		expect(q('[data-testid="cal-leave"]').getAttribute('aria-busy')).toBe('true');
		// The text is read again: the new fields arrive and the queued change goes out on them.
		props.fields = { ...BASE, type: 'sick' };
		await tick();
		await tick();
		expect(oncommit).toHaveBeenCalledTimes(2);
		expect(oncommit.mock.calls[1]?.[1]).toEqual({ ...BASE, type: 'sick', name: 'Beach' });
		expect(document.querySelector('[data-testid="cal-leave-waiting"]')).toBeNull();
	});

	it('does not hold a change that was not applied (a refused field)', async () => {
		const oncommit = vi.fn(async (_i: PaintItem, _f: LeaveFields): Promise<CommitResult> => ({
			error: 'dates',
		}));
		open(oncommit);
		choose('special');
		await tick();
		await tick();
		expect(q('[data-testid="cal-leave"]').getAttribute('aria-busy')).toBe('false');
		rename('Beach');
		await tick();
		expect(oncommit).toHaveBeenCalledTimes(2);
	});
});
