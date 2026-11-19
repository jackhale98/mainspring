// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// A leave's card in the day details (LeaveCard.svelte, W5; ADR-0018 decision 5): every change goes out
// at once on a reference to its item (range and index version); only while the card's own edit is
// in flight are changes merged, and they go out when its outcome arrives, on the item as the edit
// wrote it. Nothing waits for the index, so a card that is remounted or a lagging index loses nothing.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommitResult, LeaveFields } from '../../lib/calendar/leave-edit';
import type { PaintItem } from '../../lib/calendar/paint-items';
import type { LeaveRef, LeaveType } from '../../lib/tjp/edit/types';
import LeaveCard from './LeaveCard.svelte';

const item = {
	type: 'annual',
	name: 'Trip',
	site: { scope: { kind: 'resource', resource: 'dev' } },
	range: { file: 'plan.tjp', from: 10, to: 40 },
	version: 4,
} as unknown as PaintItem;
const REF: LeaveRef = { item: item.range, basedOn: 4 };
const TYPES: LeaveType[] = ['annual', 'special', 'sick'];
const BASE: LeaveFields = { type: 'annual', name: 'Trip', start: '2026-01-08', end: '2026-01-09' };

type Commit = (ref: LeaveRef, f: LeaveFields) => Promise<CommitResult>;
const mounted: Array<ReturnType<typeof mount>> = [];
afterEach(() => {
	for (const m of mounted.splice(0)) void unmount(m);
	document.body.innerHTML = '';
});

function open(oncommit: Commit, onremove: (r: LeaveRef) => Promise<void> | void = () => {}) {
	const props = $state({
		item,
		fields: BASE as LeaveFields | null,
		types: TYPES,
		oncommit,
		onremove,
	});
	const m = mount(LeaveCard, { target: document.body, props });
	mounted.push(m);
	flushSync();
	return { props, unmount: () => void unmount(m) };
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
const setEnd = (value: string): void => {
	const i = q<HTMLInputElement>('[data-testid="cal-leave-end"]');
	i.value = value;
	i.dispatchEvent(new Event('change', { bubbles: true }));
};
const rename = (value: string): void => {
	const i = q<HTMLInputElement>('[data-testid="cal-leave-name"]');
	i.value = value;
	i.dispatchEvent(new FocusEvent('blur'));
};
/** A commit the test settles itself. */
function pending() {
	const calls: Array<{ ref: LeaveRef; f: LeaveFields }> = [];
	const settle: Array<(r: CommitResult) => void> = [];
	const oncommit: Commit = (ref, f) => {
		calls.push({ ref, f });
		return new Promise((res) => settle.push(res));
	};
	return { calls, settle, oncommit };
}
const wrote = (from: number, basedOn: number): LeaveRef => ({
	item: { file: 'plan.tjp', from, to: from + 32 },
	basedOn,
});

describe('LeaveCard', () => {
	it('commits a change at once, on the item as the index read it, with the fields as they now are', async () => {
		const oncommit = vi.fn<Commit>(async () => ({ applied: true }));
		open(oncommit);
		choose('sick');
		await tick();
		expect(oncommit).toHaveBeenCalledTimes(1);
		expect(oncommit.mock.calls[0]?.[0]).toEqual(REF);
		expect(oncommit.mock.calls[0]?.[1]).toEqual({ ...BASE, type: 'sick' });
	});

	it('merges a change made while its own edit is in flight, and sends it on the item the edit wrote', async () => {
		const p = pending();
		open(p.oncommit);
		choose('sick');
		await tick();
		rename('Beach');
		setEnd('2026-01-10');
		await tick();
		// Nothing more goes out while the first is in flight; there is no "waiting" note.
		expect(p.calls).toHaveLength(1);
		expect(document.querySelector('[data-testid="cal-leave-waiting"]')).toBeNull();
		expect(q('[data-testid="cal-leave"]').getAttribute('aria-busy')).toBe('true');
		// The edit is applied: the merged change goes out on the rewritten item, at the edit's version.
		p.settle[0]?.({ applied: true, ref: wrote(10, 5) });
		await tick();
		await tick();
		expect(p.calls).toHaveLength(2);
		expect(p.calls[1]?.ref).toEqual(wrote(10, 5));
		expect(p.calls[1]?.f).toEqual({ ...BASE, type: 'sick', name: 'Beach', end: '2026-01-10' });
		p.settle[1]?.({ applied: true, ref: wrote(10, 6) });
		await tick();
		await tick();
		expect(q('[data-testid="cal-leave"]').getAttribute('aria-busy')).toBe('false');
	});

	it('sends a merged change on the card’s own item when its edit was not applied', async () => {
		const p = pending();
		open(p.oncommit);
		choose('sick');
		await tick();
		rename('Beach');
		await tick();
		p.settle[0]?.({});
		await tick();
		await tick();
		expect(p.calls[1]?.ref).toEqual(REF);
		expect(p.calls[1]?.f).toEqual({ ...BASE, type: 'sick', name: 'Beach' });
	});

	it('sends no merged change after a refusal: one action gives one message', async () => {
		const p = pending();
		open(p.oncommit);
		choose('sick');
		await tick();
		rename('Beach');
		await tick();
		p.settle[0]?.({ refused: true });
		await tick();
		await tick();
		expect(p.calls).toHaveLength(1);
		expect(q('[data-testid="cal-leave"]').getAttribute('aria-busy')).toBe('false');
	});

	it('goes on from the item its last edit wrote while the index has not read it', async () => {
		// The edit is in the text; the owner still gives the card the old item (the index lags).
		const oncommit = vi.fn<Commit>(async () => ({ applied: true, ref: wrote(10, 5) }));
		open(oncommit);
		choose('sick');
		await tick();
		await tick();
		setEnd('2026-01-10');
		await tick();
		await tick();
		expect(oncommit.mock.calls[0]?.[0]).toEqual(REF);
		expect(oncommit.mock.calls[1]?.[0]).toEqual(wrote(10, 5));
		// The index catches up past the edit: the card names its own item again.
	});

	it('names its own item again once the index has read what the card wrote', async () => {
		const oncommit = vi.fn<Commit>(async () => ({ applied: true, ref: wrote(10, 5) }));
		const { props } = open(oncommit);
		choose('sick');
		await tick();
		await tick();
		const moved = {
			...item,
			range: { file: 'plan.tjp', from: 10, to: 42 },
			version: 5,
		} as unknown as PaintItem;
		props.item = moved;
		props.fields = { ...BASE, type: 'sick' };
		await tick();
		setEnd('2026-01-10');
		await tick();
		await tick();
		expect(oncommit.mock.calls[1]?.[0]).toEqual({ item: moved.range, basedOn: 5 });
		expect(oncommit.mock.calls[1]?.[1]).toEqual({ ...BASE, type: 'sick', end: '2026-01-10' });
	});

	it('does not send a field that is what the card already has', async () => {
		const oncommit = vi.fn<Commit>(async () => ({ applied: true }));
		open(oncommit);
		rename('Trip');
		setEnd(BASE.end);
		await tick();
		expect(oncommit).not.toHaveBeenCalled();
		// An applied change is then the card's fields: sending it again is nothing.
		choose('sick');
		await tick();
		await tick();
		choose('sick');
		await tick();
		expect(oncommit).toHaveBeenCalledTimes(1);
	});

	it('does not drop a merged change when the card is removed from the page meanwhile', async () => {
		const p = pending();
		const { unmount: gone } = open(p.oncommit);
		choose('sick');
		await tick();
		rename('Beach');
		await tick();
		// The list was rebuilt (another item changed length, so this card's key moved): a new card.
		gone();
		p.settle[0]?.({ applied: true, ref: wrote(10, 5) });
		await tick();
		await tick();
		expect(p.calls).toHaveLength(2);
		expect(p.calls[1]?.ref).toEqual(wrote(10, 5));
		expect(p.calls[1]?.f).toEqual({ ...BASE, type: 'sick', name: 'Beach' });
	});

	it('shows why a field cannot be written, and goes on after it', async () => {
		const oncommit = vi.fn<Commit>(async () => ({ error: 'dates' }));
		open(oncommit);
		choose('special');
		await tick();
		await tick();
		expect(q('[data-testid="cal-leave"]').getAttribute('aria-busy')).toBe('false');
		expect(document.querySelector('[role="alert"]')).not.toBeNull();
		rename('Beach');
		await tick();
		expect(oncommit).toHaveBeenCalledTimes(2);
	});

	describe('Remove', () => {
		it('works while the index lags: it names the item as the index read it', async () => {
			const onremove = vi.fn<(r: LeaveRef) => Promise<void>>(async () => {});
			open(async () => ({ applied: true }), onremove);
			const remove = q<HTMLButtonElement>('[data-testid="cal-leave-remove"]');
			expect(remove.disabled).toBe(false);
			remove.click();
			await tick();
			expect(onremove).toHaveBeenCalledWith(REF);
		});

		it('is disabled only while a dispatch of the card is in flight, and then names what the edit wrote', async () => {
			const p = pending();
			const onremove = vi.fn<(r: LeaveRef) => Promise<void>>(async () => {});
			open(p.oncommit, onremove);
			choose('sick');
			await tick();
			const remove = q<HTMLButtonElement>('[data-testid="cal-leave-remove"]');
			expect(remove.disabled).toBe(true);
			remove.click();
			expect(onremove).not.toHaveBeenCalled();
			p.settle[0]?.({ applied: true, ref: wrote(10, 5) });
			await tick();
			await tick();
			expect(remove.disabled).toBe(false);
			remove.click();
			await tick();
			expect(onremove).toHaveBeenCalledWith(wrote(10, 5));
		});
	});
});
