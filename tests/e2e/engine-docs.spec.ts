// SPDX-License-Identifier: GPL-2.0-or-later
// The first edit is not delayed (ADR-0017): the app never asks the engine for its keyword docs (they
// come from the engine build's static asset), so an edit made as soon as the plan shows "Scheduled"
// runs on a free worker. An init script wraps `Worker.prototype.postMessage` to record the type of
// every message the page posts to the engine. The spec opens a small plan with the edit hook, waits
// for "Scheduled" (not "Engine: Ready"), dispatches an edit through `__mainspringEdits.action`, waits
// for its settlement and checks that no `syntax` message was ever posted. Behaviour, not timing.
// All three projects.
import { expect, test, type Page } from '@playwright/test';
import type { GanttAction } from '../../src/lib/gantt/intents';

const WAIT_MS = 120_000;

interface Win {
	__engineMessages: string[];
	__mainspringEdits: {
		action(a: GanttAction): Promise<{ status: string }>;
		settled: { status: string } | null;
		revision(): number | null;
	};
}

/** Runs in the page before its scripts: records the type of each message posted to a worker. */
function recordEngineMessages(): void {
	const w = window as unknown as Win;
	w.__engineMessages = [];
	const post = Worker.prototype.postMessage as (this: Worker, ...a: unknown[]) => void;
	Worker.prototype.postMessage = function (this: Worker, ...a: unknown[]): void {
		const type = (a[0] as { type?: unknown } | null)?.type;
		w.__engineMessages.push(typeof type === 'string' ? type : String(type));
		post.apply(this, a);
	} as typeof Worker.prototype.postMessage;
}

const posted = (page: Page): Promise<string[]> =>
	page.evaluate(() => (window as unknown as Win).__engineMessages);
const revision = (page: Page): Promise<number | null> =>
	page.evaluate(() => (window as unknown as Win).__mainspringEdits.revision());

test('the first edit is not delayed: the app never asks the engine for keyword docs', async ({
	page,
}) => {
	// A boot, two runs and the edit's settlement, each bounded by WAIT_MS on a slow runner.
	test.setTimeout(3 * WAIT_MS);
	await page.addInitScript(recordEngineMessages);
	await page.goto('/app?sample=ui-basic&mode=visual&hooks=edits');
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: WAIT_MS,
	});
	expect(await posted(page)).toContain('schedule');
	expect(await posted(page)).not.toContain('syntax');
	const before = (await revision(page)) ?? 0;

	const edit: GanttAction = { type: 'size-step', task: 'design.sketch', steps: 1 };
	const outcome = await page.evaluate(
		(a) => (window as unknown as Win).__mainspringEdits.action(a),
		edit,
	);
	expect(outcome.status).toBe('applied');
	await expect
		.poll(() => page.evaluate(() => (window as unknown as Win).__mainspringEdits.settled), {
			timeout: WAIT_MS,
		})
		.toEqual({ status: 'scheduled' });
	expect(await revision(page)).toBeGreaterThan(before);
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', { timeout: WAIT_MS });

	const types = await posted(page);
	expect(types.filter((t) => t === 'schedule').length).toBeGreaterThanOrEqual(2);
	expect(types).not.toContain('syntax');
});
