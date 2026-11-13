// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The phone sheet's status chip (SheetStatus.svelte): the run's state, the count of problems as a
// button that goes to the next one, and nothing before there is a run.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppState } from '../../lib/state/app.svelte';
import type { StatusView } from '../../lib/state/status';
import SheetStatus from './SheetStatus.svelte';

const mounted: Array<ReturnType<typeof mount>> = [];
afterEach(() => {
	for (const m of mounted.splice(0)) void unmount(m);
	document.body.innerHTML = '';
});

const view = (over: Partial<StatusView>): StatusView =>
	({
		kind: 'ok',
		label: 'Scheduled',
		errors: 0,
		warnings: 0,
		counts: 'No problems',
		...over,
	}) as StatusView;

function put(status: StatusView | null) {
	const goToNextProblem = vi.fn().mockReturnValue(true);
	const app = { status, goToNextProblem } as unknown as AppState;
	const target = document.createElement('div');
	document.body.append(target);
	mounted.push(mount(SheetStatus, { target, props: { app } }));
	flushSync();
	return { target, goToNextProblem };
}

describe('SheetStatus', () => {
	it('says the state as plain text when the plan has no problems', () => {
		const { target } = put(view({}));
		expect(target.textContent?.trim()).toBe('Scheduled');
		expect(target.querySelector('button')).toBeNull();
	});

	it('shows the problems as a button that goes to the next one', () => {
		const { target, goToNextProblem } = put(
			view({
				kind: 'errors',
				label: 'Not scheduled: fix the errors',
				errors: 2,
				counts: '2 errors',
			}),
		);
		const b = target.querySelector('button');
		expect(b?.textContent?.trim()).toBe('2 errors');
		b?.click();
		expect(goToNextProblem).toHaveBeenCalledTimes(1);
	});

	it('says when the scheduler failed, and draws nothing before a run', () => {
		expect(put(view({ kind: 'failed', label: 'x' })).target.textContent?.trim()).toBe(
			'Scheduler failed',
		);
		expect(put(null).target.textContent?.trim()).toBe('');
	});
});
