// SPDX-License-Identifier: GPL-2.0-or-later
// Helpers for the Text mode end-to-end specs (phase-1.md 9.4): opening a sample, waiting for a
// run, and the engine's own keyword documentation, read in Node from the built engine, which is
// the source `npm run gen:keywords` builds src/lib/tjp/syntax/keywords.generated.ts from.
import { expect, type Locator, type Page } from '@playwright/test';
import { bootNodeEngine } from '../../../engine/golden/run-wasm.mjs';
import type { KeywordDoc } from '../../../src/engine/protocol';
import { KEYWORDS } from '../../../src/lib/tjp/syntax/keywords';

export const READY_TIMEOUT_MS = 120_000;
/** Plan 18: three files, an include from a subfolder, a macro and a supplement. */
export const MULTI_FILE_SAMPLE = 'syn-18-structure-include-macro';

export async function openApp(page: Page, sample = MULTI_FILE_SAMPLE): Promise<void> {
	await page.goto(`/app?sample=${sample}&mode=text`);
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
}

export const editor = (page: Page) => page.getByRole('textbox', { name: /^Editor for / });
export const strip = (page: Page) => page.getByRole('group', { name: 'Plan status' });
export const finish = (page: Page) => strip(page).locator('time');

/** The Plan panel on a phone, where the outline lives; a no-op on wider layouts. */
export async function showOutline(page: Page): Promise<void> {
	const tab = page.getByRole('tab', { name: 'Plan', exact: true });
	if (await tab.isVisible()) await tab.click();
}

/**
 * Waits for the run that follows an edit. An edit puts the strip in 'scheduling' (the debounce
 * counts), so normally that state is seen and then left. A run too quick to observe is fine: the
 * strip is then already settled, and the caller's next assertion polls for the result it expects.
 */
export async function settled(page: Page): Promise<void> {
	const state = strip(page).locator('.state');
	await expect(state)
		.toHaveAttribute('data-kind', 'scheduling', { timeout: 3_000 })
		.catch(() => undefined);
	await expect(state).not.toHaveAttribute('data-kind', 'scheduling', { timeout: READY_TIMEOUT_MS });
}

/** Puts the cursor at the end of an editor line, ready to type. */
export async function cursorAtEndOf(page: Page, line: Locator): Promise<void> {
	await line.click();
	await page.keyboard.press('End');
}

/** The page box of the first occurrence of `word` in `line`, for a mouse move. */
export async function wordBox(
	line: Locator,
	word: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
	const box = await line.evaluate((el, w) => {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			const at = (n.textContent ?? '').indexOf(w);
			if (at < 0) continue;
			const range = document.createRange();
			range.setStart(n, at);
			range.setEnd(n, at + w.length);
			const r = range.getBoundingClientRect();
			return { x: r.x, y: r.y, width: r.width, height: r.height };
		}
		return null;
	}, word);
	if (!box) throw new Error(`'${word}' is not in the line`);
	return box;
}

/** The engine's docs for one keyword (TaskJuggler's SyntaxReference), from a Node boot. */
let docs: Promise<readonly KeywordDoc[]> | undefined;
export async function engineKeyword(keyword: string): Promise<KeywordDoc> {
	docs ??= bootNodeEngine({ log: () => undefined }).then((e) => e.syntax().keywords);
	const found = (await docs).find((k) => k.keyword === keyword);
	if (!found) throw new Error(`the engine has no keyword '${keyword}'`);
	return found;
}

/** The committed generated table's entry for a scoped keyword id. */
export function generatedKeyword(keyword: string) {
	const entry = KEYWORDS.find((k) => k.keyword === keyword);
	if (!entry) throw new Error(`keywords.generated.ts has no '${keyword}'`);
	return entry;
}
