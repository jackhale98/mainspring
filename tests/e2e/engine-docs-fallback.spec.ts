// SPDX-License-Identifier: GPL-2.0-or-later
// Keyword docs before and without the docs asset (ADR-0017, "Before the docs arrive"), on desktop,
// Pixel 7 and iPhone 14. Hover and the Docs sheet wait at most 300 ms for the engine build's
// `tj-docs.*` asset, then show the committed table's syntax line and summary:
// - with the asset blocked (`page.route` aborts it), the summary shows with no loading note, and
//   the plan still schedules, before and after an edit;
// - with the asset held back (the plan opened in Visual, then Text, so the load starts when the
//   editor mounts), the first look shows the summary with "Loading the full documentation…" last;
//   once the asset is let through and its request has finished, a look shows the full doc.
// A mouse gets the hover popup; a phone (touch, where hover is off) gets the Docs sheet, which
// shows the same content. With SCREENSHOTS=1 the held-back test saves the loading note and the full
// doc to docs/phases/screenshots/phase-3/t26-*.png.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { editorStrings } from '../../src/lib/strings';
import { SUMMARIES } from '../../src/lib/tjp/syntax/summaries.generated';
import { boxStable, engineIdle, panelSettled, resultAfter, resultRevision } from './lib/settle';
import {
	MULTI_FILE_SAMPLE,
	READY_TIMEOUT_MS,
	cursorAtEndOf,
	engineKeyword,
	generatedKeyword,
	openApp,
	settled,
	strip,
	wordBox,
} from './lib/text-mode';

const DOCS_ASSET = '**/tj-docs.*';
const LOADING = editorStrings.hover.docsLoading;
const DIR = path.join(process.cwd(), 'docs/phases/screenshots/phase-3');

const effortLine = (page: Page): Locator =>
	page.locator('.cm-line', { hasText: /^\s*effort 2d$/ }).first();

/** What the page shows for `effort`: the hover popup for a mouse, the Docs sheet on touch. */
interface Shown {
	root: Locator;
	body: Locator;
	notes: Locator;
}

/** Shows the docs for `effort` the way this device does, and gives what holds them. */
async function showEffortDocs(page: Page, touch: boolean): Promise<Shown> {
	const line = effortLine(page);
	if (touch) {
		await cursorAtEndOf(page, line);
		await page.getByRole('button', { name: 'Docs' }).click();
		const sheet = page.getByRole('dialog', { name: 'Documentation' });
		await expect(sheet).toBeVisible();
		await panelSettled(sheet);
		return { root: sheet, body: sheet.locator('.body'), notes: sheet.locator('.note') };
	}
	// Under the status strip otherwise: the mouse would hit the strip, not the editor.
	await line.scrollIntoViewIfNeeded();
	const box = await wordBox(line, 'effort');
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	const tip = page.locator('.cm-tjp-hover');
	await expect(tip).toBeVisible();
	await boxStable(tip);
	return {
		root: tip,
		body: tip.locator('.cm-tjp-hover-body'),
		notes: tip.locator('.cm-tjp-hover-note'),
	};
}

/** Closes what `showEffortDocs` opened. */
async function hideEffortDocs(page: Page, shown: Shown, touch: boolean): Promise<void> {
	if (touch) await page.keyboard.press('Escape');
	else await page.mouse.move(0, 0);
	await expect(shown.root).toBeHidden();
}

/** Opens the plan in Visual, waits for its schedule, then shows the text (the editor mounts). */
async function openVisualThenText(page: Page, touch: boolean): Promise<void> {
	await page.goto(`/app?sample=${MULTI_FILE_SAMPLE}&mode=visual`);
	await engineIdle(page, READY_TIMEOUT_MS);
	if (touch) await page.getByRole('tab', { name: 'Text', exact: true }).click();
	else
		await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Text' }).click();
	await expect(effortLine(page)).toBeVisible({ timeout: READY_TIMEOUT_MS });
}

const summary = (): string => generatedKeyword('effort').summary ?? SUMMARIES['effort'] ?? '';

test.describe('keyword docs without the docs asset', () => {
	test.setTimeout(READY_TIMEOUT_MS + 60_000);

	test('with the asset blocked, the docs show the summary and the plan still schedules', async ({
		page,
		hasTouch,
	}) => {
		const asked: string[] = [];
		await page.route(DOCS_ASSET, (route) => {
			asked.push(route.request().url());
			return route.abort();
		});
		await openApp(page, MULTI_FILE_SAMPLE, true);
		expect(summary()).not.toBe('');

		const shown = await showEffortDocs(page, hasTouch);
		await expect(shown.body).toHaveText(summary());
		await expect(shown.notes.filter({ hasText: LOADING })).toHaveCount(0);
		expect(asked.length).toBeGreaterThan(0);
		await hideEffortDocs(page, shown, hasTouch);

		// The editor still edits and the engine still schedules.
		await cursorAtEndOf(page, effortLine(page));
		const rev = await resultRevision(page);
		await page.keyboard.press('Backspace');
		await page.keyboard.press('Backspace');
		await page.keyboard.insertText('3d');
		await expect(page.locator('.cm-activeLine')).toHaveText(/^\s*effort 3d$/);
		await settled(page);
		await resultAfter(page, rev, READY_TIMEOUT_MS);
		await expect(strip(page)).toContainText('No engine errors or warnings');
		await expect(strip(page)).toContainText('Scheduled');
		await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready');
	});

	test('while the asset is held back the summary shows with the loading note, then the full doc', async ({
		page,
		hasTouch,
	}, info) => {
		let release = (): void => undefined;
		const gate = new Promise<void>((resolve) => (release = resolve));
		await page.route(DOCS_ASSET, async (route) => {
			await gate;
			await route.continue();
		});
		const engine = await engineKeyword('effort');
		// Visual first, so the docs load starts only when Text mode mounts the editor: the loader
		// gives up on a load after 20 s (docs-asset.ts), and a slow open must not use that up.
		await openVisualThenText(page, hasTouch);
		const shoot = async (name: string): Promise<void> => {
			if (!process.env['SCREENSHOTS']) return;
			fs.mkdirSync(DIR, { recursive: true });
			await page.screenshot({ path: path.join(DIR, `t26-${name}-${info.project.name}-light.png`) });
		};

		const loading = await showEffortDocs(page, hasTouch);
		await expect(loading.body).toHaveText(summary());
		await expect(loading.notes.filter({ hasText: LOADING })).toHaveCount(1);
		await expect(loading.notes.last()).toHaveText(LOADING);
		await shoot('loading-note');
		await hideEffortDocs(page, loading, hasTouch);

		const finished = page.waitForEvent('requestfinished', (r) => r.url().includes('/tj-docs.'));
		release();
		await finished;
		// The body is read, gunzipped and parsed after the request ends: look again until the
		// full doc shows (the look after the docs arrive is the behaviour under test).
		await expect(async () => {
			const full = await showEffortDocs(page, hasTouch);
			try {
				await expect(full.body).toHaveText(engine.doc, { timeout: 1_000 });
			} catch (e) {
				await hideEffortDocs(page, full, hasTouch);
				throw e;
			}
		}).toPass({ timeout: 15_000 });
		await expect(
			page.locator('.cm-tjp-hover-note, [role="dialog"] .note').filter({ hasText: LOADING }),
		).toHaveCount(0);
		await shoot('full-doc');
	});
});
