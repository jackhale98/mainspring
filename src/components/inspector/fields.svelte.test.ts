// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The inspector's field behaviour (phase-2.md 9.3 "Field rules"): a text field commits once on
// Enter or blur, Escape takes the draft back, a refused edit shows the plan's value again, and a
// stepper sends cumulative totals and ends its burst on Enter, on blur or after a pause.
import { flushSync, mount, tick, unmount, type Component } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CommitInput from './CommitInput.svelte';
import Stepper from './Stepper.svelte';

const mounted: Array<ReturnType<typeof mount>> = [];
afterEach(() => {
	for (const m of mounted.splice(0)) void unmount(m);
	document.body.innerHTML = '';
	vi.useRealTimers();
});

function put<P extends Record<string, unknown>>(C: Component<P>, props: P): HTMLElement {
	const target = document.createElement('div');
	document.body.append(target);
	mounted.push(mount(C, { target, props }));
	flushSync();
	return target;
}
const type = (el: HTMLInputElement, v: string) => {
	el.value = v;
	el.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
};
const key = (el: HTMLElement, k: string) =>
	el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

describe('CommitInput', () => {
	it('commits once on Enter, then not again on blur', async () => {
		const oncommit = vi.fn().mockResolvedValue(true);
		const t = put(CommitInput, { id: 'x', value: '3d', oncommit });
		const input = t.querySelector('input') as HTMLInputElement;
		type(input, '5d');
		key(input, 'Enter');
		input.dispatchEvent(new FocusEvent('blur'));
		await tick();
		expect(oncommit).toHaveBeenCalledTimes(1);
		expect(oncommit).toHaveBeenCalledWith('5d');
		// The committed text stays until the plan's value changes.
		expect(input.value).toBe('5d');
	});

	it('commits on blur, and not when nothing changed', async () => {
		const oncommit = vi.fn().mockResolvedValue(true);
		const t = put(CommitInput, { id: 'x', value: '3d', oncommit });
		const input = t.querySelector('input') as HTMLInputElement;
		input.dispatchEvent(new FocusEvent('blur'));
		type(input, '4d');
		input.dispatchEvent(new FocusEvent('blur'));
		await tick();
		expect(oncommit).toHaveBeenCalledTimes(1);
		expect(oncommit).toHaveBeenCalledWith('4d');
	});

	it('shows the plan’s value again after a refused edit', async () => {
		const oncommit = vi.fn().mockResolvedValue(false);
		const t = put(CommitInput, { id: 'x', value: '3d', oncommit });
		const input = t.querySelector('input') as HTMLInputElement;
		type(input, 'nonsense');
		key(input, 'Enter');
		await tick();
		await tick();
		expect(input.value).toBe('3d');
	});

	it('takes the draft back on Escape, and leaves Escape alone when there is none', () => {
		const oncommit = vi.fn();
		const t = put(CommitInput, { id: 'x', value: '3d', oncommit });
		const input = t.querySelector('input') as HTMLInputElement;
		type(input, '9d');
		const e1 = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		input.dispatchEvent(e1);
		flushSync();
		expect(e1.defaultPrevented).toBe(true);
		expect(input.value).toBe('3d');
		const e2 = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		input.dispatchEvent(e2);
		expect(e2.defaultPrevented).toBe(false);
		expect(oncommit).not.toHaveBeenCalled();
	});

	it('a note commits on blur, and Enter is a new line', () => {
		const oncommit = vi.fn().mockResolvedValue(true);
		const t = put(CommitInput, { id: 'x', value: '', oncommit, multiline: true });
		const area = t.querySelector('textarea') as HTMLTextAreaElement;
		area.value = 'hello';
		area.dispatchEvent(new Event('input', { bubbles: true }));
		const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
		area.dispatchEvent(enter);
		expect(enter.defaultPrevented).toBe(false);
		expect(oncommit).not.toHaveBeenCalled();
		area.dispatchEvent(new FocusEvent('blur'));
		expect(oncommit).toHaveBeenCalledWith('hello');
	});
});

describe('Stepper', () => {
	function setup(over: Record<string, unknown> = {}) {
		vi.useFakeTimers();
		const onpress = vi.fn();
		const onend = vi.fn().mockResolvedValue(true);
		const props = $state({
			id: 's',
			text: '3d',
			value: 3,
			format: (n: number) => `${n}d`,
			min: 1,
			what: 'Effort',
			onpress,
			onend,
			oncommit: vi.fn().mockResolvedValue(true),
			...over,
		});
		const t = put(Stepper, props);
		const btn = (name: string) =>
			t.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`) as HTMLButtonElement;
		const input = t.querySelector('input') as HTMLInputElement;
		return { t, props, onpress, onend, btn, input };
	}

	it('sends the total since the burst began and shows base plus total', () => {
		const s = setup();
		s.btn('Increase Effort').click();
		s.btn('Increase Effort').click();
		s.btn('Increase Effort').click();
		flushSync();
		expect(s.onpress.mock.calls).toEqual([
			[1, 3],
			[2, 3],
			[3, 3],
		]);
		expect(s.input.value).toBe('6d');
		// The plan's text catches up mid-burst: the display is not doubled.
		s.props.text = '5d';
		s.props.value = 5;
		flushSync();
		expect(s.input.value).toBe('6d');
		s.btn('Decrease Effort').click();
		flushSync();
		expect(s.onpress).toHaveBeenLastCalledWith(2, 3);
		expect(s.input.value).toBe('5d');
	});

	it('ends the burst after a pause, then follows the plan again once its text changes', async () => {
		const s = setup();
		s.btn('Increase Effort').click();
		expect(s.onend).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1300);
		expect(s.onend).toHaveBeenCalledTimes(1);
		expect(s.input.value).toBe('4d');
		s.props.text = '4d';
		s.props.value = 4;
		flushSync();
		// A new burst starts from the new text.
		s.btn('Increase Effort').click();
		expect(s.onpress).toHaveBeenLastCalledWith(1, 4);
	});

	it('takes the next press at once when the plan already showed the value before the pause ended it', async () => {
		const s = setup();
		s.btn('Increase Effort').click();
		// The dispatcher applied after 300 ms: the text is already the burst's value.
		await vi.advanceTimersByTimeAsync(400);
		s.props.text = '4d';
		s.props.value = 4;
		flushSync();
		await vi.advanceTimersByTimeAsync(1000);
		expect(s.onend).toHaveBeenCalledTimes(1);
		// The burst ended and the plan shows its value: the stepper follows the plan again...
		expect(s.input.value).toBe('4d');
		// ...and a press right away counts from it (+1 to +2 in all, not ignored).
		s.btn('Increase Effort').click();
		flushSync();
		expect(s.onpress).toHaveBeenLastCalledWith(1, 4);
		expect(s.input.value).toBe('5d');
	});

	it('starts the next burst from the value shown when the plan has not caught up', async () => {
		const s = setup();
		s.btn('Increase Effort').click();
		await vi.advanceTimersByTimeAsync(1300);
		expect(s.input.value).toBe('4d');
		// The text still says 3d (the index lags): the press counts from what is shown.
		s.btn('Increase Effort').click();
		flushSync();
		expect(s.onpress).toHaveBeenLastCalledWith(1, 4);
		expect(s.input.value).toBe('5d');
	});

	it('ends on Enter and when the focus leaves, and not twice', async () => {
		const s = setup();
		s.btn('Increase Effort').click();
		key(s.input, 'Enter');
		await vi.advanceTimersByTimeAsync(0);
		s.t
			.querySelector('[role="group"]')
			?.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }));
		await vi.advanceTimersByTimeAsync(0);
		expect(s.onend).toHaveBeenCalledTimes(1);
	});

	it('goes back to the plan’s value when the burst did not apply', async () => {
		const s = setup({ onend: vi.fn().mockResolvedValue(false) });
		s.btn('Increase Effort').click();
		await vi.advanceTimersByTimeAsync(1300);
		flushSync();
		expect(s.input.value).toBe('3d');
	});

	it('stops at its limit and cannot step a value it cannot read', () => {
		const s = setup({ value: 1, text: '1d' });
		expect(s.btn('Decrease Effort').disabled).toBe(true);
		const m = setup({ value: null, text: 'See the text' });
		expect(m.btn('Increase Effort').disabled).toBe(true);
	});
});
