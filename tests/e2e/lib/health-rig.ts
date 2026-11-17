// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A rig for the plan health specs (phase-3.md 9.7, 13.2; T18) on `fedora-res`: opens the plan in
 * Visual mode (the phone's Gantt tab), opens the Health panel the way the layout does (a desktop's
 * Health button and right panel, a phone's status card row and full-height sheet), finds findings
 * by check and task, and reads and compares the plan's text. The oracle for counts is
 * `checkPlan` over the committed golden (src/lib/health), which the live result equals on this plan
 * (the golden parity job proves that; here it is the number the panel must show).
 */
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { checkPlan } from '../../../src/lib/health/report';
import { goldenInput } from '../../../src/lib/health/testing';
import type { CheckId, HealthSettings } from '../../../src/lib/health/types';
import { READY_TIMEOUT_MS, Rig, isTouch } from './gantt-rig';

export const PLAN = 'fedora-res';
export const SETTINGS_KEY = `mainspring.health.${PLAN}`;
export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

export const phoneOf = isTouch;

/** The report the panel must show, from the golden input with the settings. */
export const expected = (settings?: HealthSettings) => checkPlan(goldenInput(PLAN, settings));

type Hooks = { __mainspringEdits: { text(p?: string): string | null; selection(): unknown } };

/** The entry file and the generated people file, where the plan's allocations are written. */
export const textOf = (page: Page): Promise<string> =>
	page.evaluate(() => {
		const e = (window as unknown as Hooks).__mainspringEdits;
		return `${e.text() ?? ''}\n--\n${e.text('mainspring-load.tji') ?? ''}`;
	});

export const selectionOf = (page: Page): Promise<{ kind: string; id?: string } | null> =>
	page.evaluate(
		() =>
			(window as unknown as Hooks).__mainspringEdits.selection() as {
				kind: string;
				id?: string;
			} | null,
	);

/** Opens the plan on the Gantt, ready and scheduled. */
export async function openPlan(
	page: Page,
	info: TestInfo,
	scheme?: 'light' | 'dark',
): Promise<Rig> {
	if (scheme) await page.emulateMedia({ colorScheme: scheme });
	return Rig.open(page, info, undefined, 'visual', PLAN);
}

/** The health panel: the right panel on a desktop, the sheet on a phone. */
export const panelOf = (page: Page, info: TestInfo): Locator =>
	isTouch(info)
		? page.getByRole('dialog', { name: 'Plan health' })
		: page.getByRole('complementary', { name: 'Plan health' });

/** Opens the panel as the layout does and waits for the report. */
export async function openHealth(page: Page, info: TestInfo): Promise<Locator> {
	if (isTouch(info)) {
		await page.getByTestId('status-button').tap();
		await page.getByTestId('open-health').tap();
	} else {
		await page.getByTestId('health-button').click();
	}
	const panel = panelOf(page, info);
	await expect(panel).toBeVisible();
	await expect(panel.getByTestId('health-summary')).toContainText('problem', {
		timeout: READY_TIMEOUT_MS,
	});
	return panel;
}

/** The findings of a check, or the one for a task. */
export const findings = (panel: Locator, check: CheckId, task?: string): Locator =>
	panel.locator(
		`[data-testid="finding"][data-check="${check}"]${task === undefined ? '' : `[data-task="${task}"]`}`,
	);

/** A check's heading with its count: "No predecessor, 26". */
export const heading = (panel: Locator, text: string | RegExp): Locator =>
	panel.getByRole('heading', { level: 3, name: text });

/** The stored settings of the plan, or null. */
export const storedSettings = (page: Page): Promise<string | null> =>
	page.evaluate((k) => localStorage.getItem(k), SETTINGS_KEY);

/** The panel says how many problems there are, and the Health button's name says it too. */
export async function expectTotal(page: Page, info: TestInfo, panel: Locator, n: number) {
	await expect(panel.getByTestId('health-summary')).toContainText(`${n} problem`, {
		timeout: 60_000,
	});
	if (!isTouch(info)) {
		await expect(page.getByTestId('health-button')).toHaveAttribute(
			'aria-label',
			`Plan health: ${n} problems`,
		);
	}
}

/** Lines of `after` that differ from `before` (same number of lines), as [was, now] pairs. */
export function changedLines(before: string, after: string): Array<[string, string]> {
	const a = before.split('\n');
	const b = after.split('\n');
	if (a.length !== b.length) throw new Error(`line counts differ: ${a.length} and ${b.length}`);
	return a.flatMap((line, i) =>
		line === b[i] ? [] : [[line, b[i] as string] as [string, string]],
	);
}

/** Waits for the newest edit's toast to settle, as the plan's text and its schedule agree. */
export async function settled(page: Page): Promise<void> {
	const toast = page.locator('[data-testid="toast"], [data-testid="toast-quiet"]').last();
	await expect(toast).toHaveAttribute('data-status', 'scheduled', { timeout: READY_TIMEOUT_MS });
}

/** Undo of the newest edit: the toast's button, or the top bar's on a phone. */
export async function undo(page: Page, info: TestInfo): Promise<void> {
	if (isTouch(info)) await page.getByTestId('undo').tap();
	else await page.getByTestId('toast').last().getByRole('button', { name: 'Undo' }).click();
}
