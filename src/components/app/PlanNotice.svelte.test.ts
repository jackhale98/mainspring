// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The notice about where the open plan is kept (PlanNotice.svelte): read-only because another tab
// has the plan, with "Open here instead"; and changes this tab could not keep because another tab
// took the plan first (T4 re-check N1), which says so on every layout and offers to copy the open
// file's text before "Open here instead" drops it.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppState } from '../../lib/state/app.svelte';
import { storageError } from '../../lib/storage/types';
import { storageStrings } from '../../lib/strings-storage';
import PlanNotice from './PlanNotice.svelte';

const S = storageStrings.notice;
const TEXT = { 'plan.tjp': 'project p "P" 2026-01-05 +1m\n# mine\n', 'lib/x.tji': 'task x "X"\n' };

const mounted: Array<ReturnType<typeof mount>> = [];
afterEach(() => {
	for (const m of mounted.splice(0)) void unmount(m);
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

function setup(o: { refused: boolean }) {
	const openStored = vi.fn(async () => true);
	const keeping = $state({
		keep: o.refused
			? { kind: 'failed', error: storageError('not-owner', 'taken') }
			: { kind: 'stored', at: 1 },
		unopened: null,
		cleared: false,
	});
	const app = $state({
		keeping,
		readOnly: true,
		heldElsewhere: null,
		storedId: 'w1',
		activeFile: 'plan.tjp',
		workspace: { texts: () => TEXT },
		openStored,
		reloadPage: vi.fn(),
	});
	const target = document.createElement('div');
	document.body.append(target);
	mounted.push(
		mount(PlanNotice, {
			target,
			props: { app: app as unknown as AppState },
		}),
	);
	flushSync();
	const notice = target.querySelector<HTMLElement>('[data-testid="plan-notice"]');
	if (!notice) throw new Error('no notice');
	const button = (name: string): HTMLButtonElement => {
		const b = [...notice.querySelectorAll('button')].find((x) => x.textContent?.trim() === name);
		if (!b) throw new Error(`no ${name} button`);
		return b;
	};
	return { notice, button, app, openStored };
}

describe('the plan notice', () => {
	it('says the plan was taken over, with "Open here instead" and nothing to copy', () => {
		const { notice, openStored, button } = setup({ refused: false });
		expect(notice.dataset['kind']).toBe('taken');
		expect(notice.textContent).toContain(S.taken);
		expect(notice.textContent).not.toContain(S.copyText);
		button(S.openHere).click();
		expect(openStored).toHaveBeenCalledWith('w1', { steal: true });
	});

	it('says the changes in this tab were not kept, with the text to copy (N1)', () => {
		const { notice } = setup({ refused: true });
		expect(notice.dataset['kind']).toBe('refused');
		expect(notice.querySelector('p')?.textContent).toBe(S.refused);
		expect(notice.getAttribute('role')).toBe('status');
	});

	it("copies the open file's text, and says when it could not (N1)", async () => {
		const writeText = vi.fn(async (_t: string) => undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		const { button, app } = setup({ refused: true });
		button(S.copyText).click();
		await vi.waitFor(() => expect(button(S.copied)).toBeTruthy());
		expect(writeText).toHaveBeenCalledWith(TEXT['plan.tjp']);
		// Another file is open: its text is the one to copy.
		app.activeFile = 'lib/x.tji';
		flushSync();
		writeText.mockRejectedValueOnce(new Error('denied'));
		button(S.copyText).click();
		await vi.waitFor(() => expect(button(S.copyFailed)).toBeTruthy());
		expect(writeText).toHaveBeenLastCalledWith(TEXT['lib/x.tji']);
	});

	it('offers "Open here instead", which asks the app (the app asks before dropping the changes)', () => {
		const { button, openStored } = setup({ refused: true });
		button(S.openHere).click();
		expect(openStored).toHaveBeenCalledWith('w1', { steal: true });
	});
});
