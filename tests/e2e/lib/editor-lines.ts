// SPDX-License-Identifier: GPL-2.0-or-later
import type { Locator, Page } from '@playwright/test';

type Step = 'ready' | 'moved' | 'absent' | 'end';
type Mode = 'look' | 'top' | 'down';

/**
 * A line of the text, scrolled to and inside the editor's view. The editor draws only the lines in
 * or near its view, and (WebKit more) replaces the ones it scrolls past. A click that has to scroll
 * to a line is retried by Playwright each time the line is replaced, and can go on for ever, so the
 * line is first brought into view here, by script, and the click finds it where it is.
 *
 * A line that is not drawn can be above or below the view, so the search goes from the top of the
 * text, down. It throws, naming the text, when it never shows up.
 */
export async function lineAt(page: Page, text: string): Promise<Locator> {
	const step = (mode: Mode): Promise<Step> =>
		page.evaluate(
			([t, how]) => {
				const scroller = document.querySelector<HTMLElement>('.cm-scroller');
				if (!scroller) return 'end';
				const drawn = [...document.querySelectorAll('.cm-content .cm-line')].find((l) =>
					l.textContent?.includes(t),
				);
				if (drawn) {
					const at = drawn.getBoundingClientRect();
					const view = scroller.getBoundingClientRect();
					if (at.top >= view.top + 4 && at.bottom <= view.bottom - 4) return 'ready';
					// Drawn but out of view: centre it.
					scroller.scrollTop += at.top - view.top - view.height / 2;
					return 'moved';
				}
				if (how === 'look') return 'absent';
				if (how === 'top') {
					scroller.scrollTop = 0;
					return 'moved';
				}
				const before = scroller.scrollTop;
				scroller.scrollTop += scroller.clientHeight / 2;
				return scroller.scrollTop === before ? 'end' : 'moved';
			},
			[text, mode] as const,
		);
	// Two frames: the editor has drawn what the scroll showed.
	const drawn = (): Promise<unknown> =>
		page.evaluate(
			() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
		);

	let state = await step('look');
	if (state === 'absent') {
		await step('top');
		await drawn();
	}
	// The text may not be laid out or filled in yet (a tab just shown): at the end of the text, go
	// back to the top and look again, until the line is drawn or the tries are used up.
	for (let i = 0; i < 300 && state !== 'ready'; i++) {
		state = await step('look');
		if (state === 'absent') state = await step('down');
		if (state === 'end') await step('top');
		if (state === 'moved' || state === 'end') await drawn();
	}
	if (state !== 'ready')
		throw new Error(`the editor never drew a line with "${text}" in 300 scrolls through the text`);
	return page.locator('.cm-content .cm-line').filter({ hasText: text }).first();
}
