// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The status strip's live region while the Gantt is on screen (`quiet`): the Gantt says what a
// reschedule moved, so a plain ok run after an ok run is not said twice; a problem, a warning and
// the confirmation after a problem always are.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppState } from '../lib/state/app.svelte';
import { announcesRun, type StatusView } from '../lib/state/status';
import StatusStrip from './StatusStrip.svelte';

const view = (over: Partial<StatusView> = {}): StatusView => ({
	kind: 'ok',
	label: 'Scheduled',
	finish: 'Jan 9',
	zone: 'UTC',
	delta: null,
	outdated: false,
	errors: 0,
	warnings: 0,
	counts: 'No problems',
	unlocated: [],
	failure: null,
	engine: null,
	...over,
});
const OK = view();
const ERROR = view({
	kind: 'errors',
	label: 'Scheduled with problems',
	errors: 1,
	counts: '1 error',
});
const WARNING = view({ warnings: 1, counts: '1 warning' });
const SCHEDULING = view({ kind: 'scheduling', label: 'Scheduling…' });

const mounted: Array<ReturnType<typeof mount>> = [];
afterEach(() => {
	for (const m of mounted.splice(0)) void unmount(m);
	document.body.innerHTML = '';
});

function setup(quiet: boolean) {
	const app = $state({
		status: null as StatusView | null,
		run: null,
		goToNextProblem: () => false,
		retry: () => undefined,
	});
	const target = document.createElement('div');
	document.body.append(target);
	mounted.push(
		mount(StatusStrip, {
			target,
			props: { app: app as unknown as AppState, compact: false, quiet },
		}),
	);
	flushSync();
	const live = (): string => target.querySelector('[role="status"]')?.textContent?.trim() ?? '';
	/** A run settles: the strip sees "scheduling", then the result. */
	const settle = (v: StatusView): string => {
		app.status = SCHEDULING;
		flushSync();
		app.status = v;
		flushSync();
		return live();
	};
	return { settle, live };
}

describe('announcesRun', () => {
	it('stays quiet only for a plain ok run after an ok run, and only with the Gantt shown', () => {
		expect(announcesRun(OK, 'ok', true)).toBe(false);
		expect(announcesRun(OK, 'ok', false)).toBe(true);
		expect(announcesRun(OK, null, true)).toBe(true);
		expect(announcesRun(OK, 'errors', true)).toBe(true);
		expect(announcesRun(WARNING, 'ok', true)).toBe(true);
		expect(announcesRun(ERROR, 'ok', true)).toBe(true);
		expect(announcesRun(ERROR, 'errors', true)).toBe(true);
		expect(announcesRun(view({ kind: 'failed' }), 'ok', true)).toBe(true);
	});
});

describe('the strip with the Gantt shown', () => {
	it('says an error every time it comes back, because the fix in between was said too', () => {
		const { settle } = setup(true);
		expect(settle(OK)).toBe('Scheduled. Finish Jan 9. No problems');
		const first = settle(ERROR);
		expect(first).toBe('Scheduled with problems. Finish Jan 9. 1 error');
		// Fixed: the confirmation is said, so the region changes...
		expect(settle(OK)).toBe('Scheduled. Finish Jan 9. No problems');
		// ...and the same error again is a change in it, and is said again.
		expect(settle(ERROR)).toBe(first);
	});

	it('says a warning', () => {
		const { settle } = setup(true);
		settle(OK);
		expect(settle(WARNING)).toBe('Scheduled. Finish Jan 9. 1 warning');
	});

	it('is silent, and empties the region, for a plain ok run after an ok run', () => {
		const { settle, live } = setup(true);
		settle(OK);
		expect(live()).not.toBe('');
		expect(settle(OK)).toBe('');
		expect(settle(OK)).toBe('');
	});

	it('says every run when the Gantt is not shown', () => {
		const { settle } = setup(false);
		settle(OK);
		expect(settle(OK)).toBe('Scheduled. Finish Jan 9. No problems');
	});
});
