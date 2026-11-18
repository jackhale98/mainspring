// SPDX-License-Identifier: GPL-2.0-or-later
import type { Page } from '@playwright/test';

/**
 * The modifier a person with a hardware keyboard uses for "go to the end of the document" on the
 * page's device. Playwright's `ControlOrMeta` follows the machine that runs the test (Control on
 * Linux). The iPhone 14 emulation is an iPhone by its user agent, whose keyboard shortcut is Cmd
 * (Meta), and WebKit there does not take Control+End to the end of the editor. Use this for a key
 * the editor handles (the app's own undo hotkeys take either).
 */
export async function modKey(page: Page): Promise<'Meta' | 'Control'> {
	const apple = await page.evaluate(() =>
		/Mac|iPhone|iPad|iPod/.test(navigator.platform + navigator.userAgent),
	);
	return apple ? 'Meta' : 'Control';
}
