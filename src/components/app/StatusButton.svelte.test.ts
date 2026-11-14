// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The phone's status button: its name and shape say the combined state, a pip says a new build is
// out, and the popover holds the controls the footer strip used to (next problem, Try again,
// Reload) above the engine details.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppState } from '../../lib/state/app.svelte';
import type { StatusView } from '../../lib/state/status';
import type { AppUpdates } from '../../lib/state/updates.svelte';
import StatusButton from './StatusButton.svelte';

const view = (over: Partial<StatusView> = {}): StatusView => ({
	kind: 'ok',
	label: 'Scheduled',
	finish: 'Jan 9',
	zone: 'UTC',
	delta: '2 days later',
	outdated: false,
	errors: 0,
	warnings: 0,
	counts: 'No problems',
	unlocated: [],
	failure: null,
	engine: null,
	...over,
});

const mounted: Array<ReturnType<typeof mount>> = [];
afterEach(() => {
	for (const m of mounted.splice(0)) void unmount(m);
	document.body.innerHTML = '';
});

function setup(status: StatusView | null, update: 'available' | 'current' | 'unknown' = 'current') {
	const goToNextProblem = vi.fn(() => true);
	const retry = vi.fn();
	const reloadAsking = vi.fn(async () => true);
	const app = $state({ status, run: null, engine: 'idle', dirty: false, goToNextProblem, retry });
	const updates = $state({
		status: update,
		checking: false,
		build: { id: 'a-1', builtAt: '2026-11-13T14:00:00Z' },
		checkNow: async () => update,
		reloadAsking,
	});
	const target = document.createElement('div');
	document.body.append(target);
	mounted.push(
		mount(StatusButton, {
			target,
			props: { app: app as unknown as AppState, updates: updates as unknown as AppUpdates },
		}),
	);
	flushSync();
	const button = target.querySelector<HTMLButtonElement>('[data-testid="status-button"]');
	if (!button) throw new Error('no status button');
	return { target, button, app, updates, goToNextProblem, retry, reloadAsking };
}

describe('the phone status button', () => {
	it('names the state and what it opens, with a circle when all is well', () => {
		const { button } = setup(view());
		expect(button.getAttribute('aria-label')).toBe(
			'Plan status: Scheduled. Engine and scheduler details',
		);
		expect(button.dataset['glyph']).toBe('ok');
		expect(button.querySelector('.glyph.ok')).not.toBeNull();
		expect(button.querySelector('[data-testid="update-pip"]')).toBeNull();
	});

	it('says the warnings in the name and wears the triangle', () => {
		const { button } = setup(view({ warnings: 3, counts: '3 warnings' }));
		expect(button.getAttribute('aria-label')).toBe(
			'Plan status: Scheduled, 3 warnings. Engine and scheduler details',
		);
		expect(button.querySelector('.glyph.warning')).not.toBeNull();
	});

	it('wears the diamond for errors and for a failed scheduler', () => {
		expect(
			setup(view({ kind: 'errors', errors: 1, counts: '1 error' })).button.dataset['glyph'],
		).toBe('error');
		const failed = setup(
			view({ kind: 'failed', label: 'Scheduler failed', failure: 'It stopped.' }),
		);
		expect(failed.button.dataset['glyph']).toBe('error');
		expect(failed.button.querySelector('.glyph.error')).not.toBeNull();
	});

	it('ticks the mark while the scheduler works', () => {
		const { button } = setup(view({ kind: 'scheduling', label: 'Scheduling…' }));
		expect(button.dataset['glyph']).toBe('busy');
		expect(button.querySelector('svg.mark.busy')).not.toBeNull();
	});

	it('shows a pip, and says so in the name, when a newer build is available', () => {
		const { button } = setup(view(), 'available');
		expect(button.querySelector('[data-testid="update-pip"]')).not.toBeNull();
		expect(button.getAttribute('aria-label')).toBe(
			'Plan status: Scheduled. A new version is available. Engine and scheduler details',
		);
	});

	it('is a 44 px popover trigger that exists before there is a plan', () => {
		const { button, target } = setup(null);
		expect(button.getAttribute('popovertarget')).toBe(
			target.querySelector('[popover]')?.getAttribute('id'),
		);
		expect(button.getAttribute('aria-label')).toMatch(/^Plan status: Starting the scheduler/);
	});
});

describe('the popover', () => {
	it('goes to the next problem from the counts button', () => {
		const { target, goToNextProblem } = setup(view({ warnings: 2, counts: '2 warnings' }));
		// jsdom has no popover API; the card closes itself when the jump happens.
		const hide = vi.fn();
		HTMLElement.prototype.hidePopover = hide;
		const counts = target.querySelector<HTMLButtonElement>('[data-testid="next-problem"]');
		expect(counts?.textContent).toContain('2 warnings');
		counts?.click();
		expect(goToNextProblem).toHaveBeenCalledOnce();
		expect(hide).toHaveBeenCalledOnce();
	});

	it('shows no problems as plain text, not a button', () => {
		const { target } = setup(view());
		expect(target.querySelector('[data-testid="next-problem"]')).toBeNull();
		expect(target.querySelector('[popover]')?.textContent).toContain('No problems');
	});

	it('gives a failure its reason and Try again', () => {
		const { target, retry } = setup(
			view({ kind: 'failed', label: 'Scheduler failed', failure: 'The scheduler stopped.' }),
		);
		const pop = target.querySelector('[popover]');
		expect(pop?.textContent).toContain('The scheduler stopped.');
		const again = [...(pop?.querySelectorAll('button') ?? [])].find(
			(b) => b.textContent?.trim() === 'Try again',
		);
		again?.click();
		expect(retry).toHaveBeenCalledOnce();
	});

	it('lists the messages without a place, and offers New version · Reload only when one is out', () => {
		const { target, reloadAsking } = setup(
			view({
				unlocated: [{ severity: 'warning', message: 'No tasks.', precision: 'none' } as never],
			}),
			'available',
		);
		const pop = target.querySelector('[popover]');
		expect(pop?.querySelector('details summary')?.textContent).toBe('1 message without a place');
		expect(pop?.querySelector('details')?.textContent).toContain('No tasks.');
		const reload = pop?.querySelector<HTMLButtonElement>('[data-testid="update-reload"]');
		expect(reload?.textContent?.replace(/\s+/g, ' ').trim()).toBe('New version · Reload');
		reload?.click();
		expect(reloadAsking).toHaveBeenCalledWith(false);
		expect(
			setup(view(), 'current').target.querySelector('[data-testid="update-reload"]'),
		).toBeNull();
	});

	it('holds the same engine details the desktop popover has, below the status', () => {
		const { target } = setup(
			view({
				engine: {
					version: 'TaskJuggler 3.8.4',
					last: '182 ms',
					timings: [{ label: 'Scheduler total', value: '182 ms' }],
					note: 'A note.',
					versions: [{ label: 'TaskJuggler', value: '3.8.4' }],
				},
			}),
		);
		const text = target.querySelector('[popover]')?.textContent ?? '';
		for (const part of ['Scheduler total', 'A note.', 'Check for updates', 'Build', 'Versions']) {
			expect(text).toContain(part);
		}
		expect(text.indexOf('Scheduled')).toBeLessThan(text.indexOf('Scheduler total'));
	});
});
