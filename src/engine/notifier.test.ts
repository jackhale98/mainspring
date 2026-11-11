// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { StateNotifier } from './notifier';

function setup(initial: string): { notifier: StateNotifier<string>; set: (s: string) => void } {
	let state = initial;
	const notifier = new StateNotifier(() => state);
	return {
		notifier,
		set: (s) => {
			state = s;
			notifier.notify();
		},
	};
}

describe('StateNotifier', () => {
	it('delivers changes only, never the initial state', () => {
		const { notifier, set } = setup('a');
		const seen: string[] = [];
		notifier.subscribe((s) => seen.push(s));
		notifier.notify();
		set('a');
		set('b');
		set('b');
		set('c');
		expect(seen).toEqual(['b', 'c']);
	});

	it('stops delivering after unsubscribe and clear', () => {
		const { notifier, set } = setup('a');
		const one: string[] = [];
		const two: string[] = [];
		const off = notifier.subscribe((s) => one.push(s));
		notifier.subscribe((s) => two.push(s));
		set('b');
		off();
		set('c');
		notifier.clear();
		set('d');
		expect([one, two]).toEqual([['b'], ['b', 'c']]);
	});

	it('restarts the round when a listener changes the state, so everyone ends current', () => {
		const { notifier, set } = setup('idle');
		const first: string[] = [];
		const last: string[] = [];
		notifier.subscribe((s) => first.push(s));
		notifier.subscribe((s) => {
			if (s === 'idle') set('busy');
		});
		notifier.subscribe((s) => last.push(s));
		set('booting');
		set('idle');
		expect(first).toEqual(['booting', 'idle', 'busy']);
		expect(last).toEqual(['booting', 'busy']);
	});

	it('never delivers a state twice in a row when listeners flip it back', () => {
		const { notifier, set } = setup('a');
		let flipped1 = false;
		let flipped2 = false;
		const last: string[] = [];
		notifier.subscribe((s) => {
			if (s !== 'b' || flipped1) return;
			flipped1 = true;
			set('c');
		});
		notifier.subscribe((s) => {
			if (s !== 'c' || flipped2) return;
			flipped2 = true;
			set('b');
		});
		notifier.subscribe((s) => last.push(s));
		set('b');
		expect(last).toEqual(['b']);
	});

	it('skips a listener removed by an earlier one in the same round', () => {
		const { notifier, set } = setup('a');
		const seen: string[] = [];
		let off = (): void => undefined;
		notifier.subscribe(() => off());
		off = notifier.subscribe((s) => seen.push(s));
		set('b');
		expect(seen).toEqual([]);
	});

	it('keeps delivering when a listener throws', async () => {
		const { notifier, set } = setup('a');
		const seen: string[] = [];
		const errors: unknown[] = [];
		const onError = (error: unknown): void => void errors.push(error);
		process.on('uncaughtException', onError);
		try {
			notifier.subscribe(() => {
				throw new Error('listener bug');
			});
			notifier.subscribe((s) => seen.push(s));
			set('b');
			await new Promise((resolve) => setImmediate(resolve));
		} finally {
			process.off('uncaughtException', onError);
		}
		expect(seen).toEqual(['b']);
		expect(errors).toHaveLength(1);
	});
});
