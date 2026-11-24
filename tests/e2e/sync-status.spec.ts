// SPDX-License-Identifier: GPL-2.0-or-later
// The sync status control and its panel (phase-4.md 11.1, 12.3, 13.2; T14), on every project.
// On a small plan: the control says where the plan is as it goes from a sample to kept in this
// browser; the panel opens and closes by keyboard and the focus returns; axe in light and dark with
// the panel open; a 44 px target on a phone; the state when this browser refuses the changes; and
// read-only in a second page, with "Open here instead". On /dev/sync-status (no engine) every state
// of the control, the ones T7 will reach included, with its panel and axe.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { storageStrings } from '../../src/lib/strings-storage';
import { syncStrings } from '../../src/lib/strings-sync';
import { isTouch } from './lib/gantt-rig';
import { READY_TIMEOUT_MS, editor, openApp } from './lib/text-mode';
import { modKey } from './lib/keys';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const SAMPLE = 'ui-basic';
const control = (page: Page) => page.getByTestId('sync-status');
const panel = (page: Page) => page.getByTestId('sync-panel');

test.setTimeout(READY_TIMEOUT_MS * 2 + 60_000);

async function typeAtStart(page: Page, line: string): Promise<void> {
	await editor(page).click();
	await page.keyboard.press(`${await modKey(page)}+Home`);
	await page.keyboard.insertText(line);
}

/** Opens the panel with the keyboard, as a person without a pointer does. */
async function openByKeyboard(page: Page): Promise<void> {
	await control(page).focus();
	await page.keyboard.press('Enter');
	await expect(panel(page)).toBeVisible();
}

async function axeOpen(page: Page, what: string): Promise<void> {
	const r = await new AxeBuilder({ page })
		.include('[data-testid="sync-status"]')
		.include('[data-testid="sync-panel"]')
		.withTags(TAGS)
		.analyze();
	expect(
		r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
		what,
	).toEqual([]);
}

/** A touch target on a coarse pointer is at least 44 x 44 px (phase-4.md 12.3). */
async function expectTapSize(loc: ReturnType<typeof control>, info: TestInfo): Promise<void> {
	if (!isTouch(info)) return;
	const b = await loc.boundingBox();
	expect(b?.width ?? 0).toBeGreaterThanOrEqual(43.5);
	expect(b?.height ?? 0).toBeGreaterThanOrEqual(43.5);
}

test('a sample is a sample, a change keeps a copy, and the control says where it is (the panel, by keyboard)', async ({
	page,
}, info) => {
	await openApp(page, SAMPLE);
	await expect(control(page)).toHaveAttribute('data-kind', 'sample');
	await expectTapSize(control(page), info);

	await typeAtStart(page, '# kept in this browser\n');
	await expect(control(page)).toHaveAttribute('data-kind', 'browser-only', { timeout: 10_000 });
	await expect(control(page)).toHaveAccessibleName(/^Sync status: Only in this browser$/);
	await expectTapSize(control(page), info);

	// The panel opens by keyboard, says where the plan is and when it was kept, and closes with Escape.
	await expect(control(page)).toHaveAttribute('aria-expanded', 'false');
	await openByKeyboard(page);
	await expect(control(page)).toHaveAttribute('aria-expanded', 'true');
	await expect(panel(page).getByRole('heading', { name: syncStrings.title })).toBeVisible();
	await expect(panel(page).getByTestId('sync-location')).toHaveText('Only in this browser');
	await expect(panel(page).getByText(syncStrings.lastKept)).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(panel(page)).toBeHidden();
	await expect(control(page)).toBeFocused();
	await expect(control(page)).toHaveAttribute('aria-expanded', 'false');

	// Again, now that the panel's chunk is loaded.
	await openByKeyboard(page);
	await page.keyboard.press('Escape');
	await expect(panel(page)).toBeHidden();
	await expect(control(page)).toBeFocused();
});

for (const scheme of ['light', 'dark'] as const) {
	test(`axe finds nothing with the panel open (${scheme})`, async ({ page }) => {
		await page.emulateMedia({ colorScheme: scheme });
		await openApp(page, SAMPLE);
		await typeAtStart(page, '# kept\n');
		await expect(control(page)).toHaveAttribute('data-kind', 'browser-only', { timeout: 10_000 });
		await axeOpen(page, 'the control');
		await openByKeyboard(page);
		await axeOpen(page, 'the control and the panel');
	});
}

test('changes this browser refuses are said not kept, in the control and the panel, with the text to copy', async ({
	page,
}, info) => {
	// The browser's storage refuses to open (a private window, blocked site data); the clipboard records.
	await page.addInitScript(() => {
		// On the prototype: a property set on `indexedDB` itself can be lost in WebKit (persist.spec.ts).
		IDBFactory.prototype.open = function (): IDBOpenDBRequest {
			throw new DOMException('blocked', 'SecurityError');
		};
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: {
				writeText: (t: string) => {
					(window as unknown as { copied: string }).copied = t;
					return Promise.resolve();
				},
			},
		});
	});
	await openApp(page, SAMPLE);
	await typeAtStart(page, '# not kept\n');
	await expect(control(page)).toHaveAttribute('data-kind', 'failed', { timeout: 10_000 });
	await expect(control(page)).toHaveAccessibleName(/^Sync status: Changes not kept$/);
	await expectTapSize(control(page), info);
	// Said once, in a polite live region.
	await expect(page.getByRole('status').filter({ hasText: 'Changes not kept' })).toHaveCount(1);

	await openByKeyboard(page);
	await expect(panel(page)).toContainText(/only in this tab/i);
	await axeOpen(page, 'not kept');
	const copy = panel(page).getByRole('button', { name: storageStrings.notice.copyText });
	await copy.focus();
	await page.keyboard.press('Enter');
	await expect(
		panel(page).getByRole('button', { name: storageStrings.notice.copied }),
	).toBeVisible();
	expect(await page.evaluate(() => (window as unknown as { copied?: string }).copied)).toContain(
		'# not kept\n',
	);
	// Escape from inside the panel: the focus returns to the control.
	await page.keyboard.press('Escape');
	await expect(panel(page)).toBeHidden();
	await expect(control(page)).toBeFocused();
});

test('a second page on the plan is read-only, says so, and can take the plan from the panel', async ({
	page,
	context,
}) => {
	await openApp(page, SAMPLE);
	await typeAtStart(page, '# first page\n');
	await expect(control(page)).toHaveAttribute('data-kind', 'browser-only', { timeout: 10_000 });

	const second = await context.newPage();
	await second.goto('/app?mode=text');
	await expect(control(second)).toHaveAttribute('data-kind', 'read-only', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(control(second)).toHaveAccessibleName(/^Sync status: Read-only$/);
	await openByKeyboard(second);
	await axeOpen(second, 'read-only');
	await panel(second).getByRole('button', { name: storageStrings.notice.openHere }).click();
	await expect(control(second)).toHaveAttribute('data-kind', 'browser-only', { timeout: 10_000 });
	// The first page lost the plan.
	await expect(control(page)).toHaveAttribute('data-kind', 'read-only', { timeout: 10_000 });
});

test.describe('every state, on the dev page', () => {
	const ROWS = [
		'sample',
		'browser-only',
		'browser-only-new',
		'saved',
		'changes',
		'working',
		'checking',
		'queued-offline',
		'queued-access',
		'queued-retrying',
		'conflict',
		'blocked',
		'needs-access',
		'sign-in',
		'failed-provider',
		'failed-store',
		'read-only',
	];
	const open = async (page: Page, info: TestInfo, scheme: 'light' | 'dark') => {
		await page.emulateMedia({ colorScheme: scheme });
		await page.goto(`/dev/sync-status${isTouch(info) ? '?phone=1' : ''}`);
		await expect(page.getByTestId('sync-demo')).toBeVisible();
	};

	for (const scheme of ['light', 'dark'] as const) {
		test(`each state draws, names itself, has a panel, and passes axe (${scheme})`, async ({
			page,
		}, info) => {
			await open(page, info, scheme);
			for (const id of ROWS) {
				const row = page.locator(`[data-row="${id}"]`);
				const button = row.getByTestId('sync-status');
				await expect(button, id).toHaveAccessibleName(/^Sync status: \S/);
				await expect(button.locator('svg, .mark').first(), id).toBeVisible();
				await expectTapSize(button, info);
				await button.click();
				const card = row.getByTestId('sync-panel');
				await expect(card, id).toBeVisible();
				await expect(card.getByTestId('sync-panel-body'), id).toHaveAttribute(
					'data-kind',
					await button.getAttribute('data-kind').then((k) => k ?? ''),
				);
				const r = await new AxeBuilder({ page })
					.include(`[data-row="${id}"]`)
					.withTags(TAGS)
					.analyze();
				expect(
					r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
					id,
				).toEqual([]);
				await page.keyboard.press('Escape');
				await expect(card, id).toBeHidden();
			}
		});
	}

	test('the locations of a folder and of GitHub read as the spec words them', async ({
		page,
	}, info) => {
		await open(page, info, 'light');
		const saved = page.locator('[data-row="saved"]');
		await saved.getByTestId('sync-status').click();
		await expect(saved.getByTestId('sync-location')).toContainText('Plans');
		await expect(saved.getByTestId('sync-location')).toContainText('on this computer');
		await page.keyboard.press('Escape');
		const changes = page.locator('[data-row="changes"]');
		await changes.getByTestId('sync-status').click();
		await expect(changes.getByTestId('sync-location')).toHaveText('GitHub: acme/plans, main, q4/');
	});
});
