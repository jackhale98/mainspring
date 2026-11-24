// SPDX-License-Identifier: GPL-2.0-or-later
// The two things the notice and the Sync panel share (plan-actions.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyOpenText, openHere } from './plan-actions';

afterEach(() => vi.unstubAllGlobals());

const app = (text: string) => ({
	activeFile: 'plan.tjp',
	workspace: { texts: () => ({ 'plan.tjp': text }) },
});

describe('copyOpenText', () => {
	it('puts the open file on the clipboard', async () => {
		const writeText = vi.fn(async () => undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		expect(await copyOpenText(app('# mine\n') as never)).toEqual({ path: 'plan.tjp', ok: true });
		expect(writeText).toHaveBeenCalledWith('# mine\n');
	});

	it('says when the clipboard refuses', async () => {
		vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('no')) } });
		expect(await copyOpenText(app('x') as never)).toEqual({ path: 'plan.tjp', ok: false });
	});
});

describe('openHere', () => {
	it('takes the stored plan from the other tab', async () => {
		const openStored = vi.fn(async () => true);
		expect(await openHere({ storedId: 'w1', openStored })).toBe(true);
		expect(openStored).toHaveBeenCalledWith('w1', { steal: true });
	});

	it('does nothing when no plan is stored', async () => {
		const openStored = vi.fn(async () => true);
		expect(await openHere({ storedId: null, openStored })).toBe(false);
		expect(openStored).not.toHaveBeenCalled();
	});
});
