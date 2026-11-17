// SPDX-License-Identifier: GPL-2.0-or-later
// Add person and Add group (add.ts, W7): the name is typed first, so one addResource edit gives
// the id from it; the new resource is selected from the applied edit's header.
import { describe, expect, it, vi } from 'vitest';
import type { DispatchOutcome } from '../state/edits.svelte';
import type { TjpEdit } from '../tjp/edit/types';
import { addResourceFlow, usableName, type AddResourceEnv } from './add';

const edit = {} as TjpEdit;
const applied = { status: 'applied', edit } as unknown as DispatchOutcome;

function env(over: Partial<AddResourceEnv> = {}): AddResourceEnv & {
	selected: string[];
	sent: unknown[];
} {
	const plan = {};
	const selected: string[] = [];
	const sent: unknown[] = [];
	return {
		plan: () => plan,
		dispatch: vi.fn(async (intent, o) => {
			sent.push({ intent, label: o.label.text });
			return applied;
		}),
		headerOf: () => 'resource cy_twombly "Cy Twombly"',
		select: (id) => void selected.push(id),
		...over,
		selected,
		sent,
	};
}

describe('usableName', () => {
	it('is the trimmed name, or null when there is nothing to write', () => {
		expect(usableName('  Cy  ')).toBe('Cy');
		expect(usableName('   ')).toBeNull();
		expect(usableName('')).toBeNull();
	});
});

describe('addResourceFlow', () => {
	it('sends one addResource at the spot with the typed name, then selects the new id', async () => {
		const e = env();
		const id = await addResourceFlow(e, { parent: 'team', index: 2 }, ' Cy Twombly ', 'person');
		expect(id).toBe('cy_twombly');
		expect(e.selected).toEqual(['cy_twombly']);
		expect(e.sent).toEqual([
			{
				intent: { type: 'addResource', parent: 'team', index: 2, name: 'Cy Twombly' },
				label: 'Added Cy Twombly',
			},
		]);
	});

	it('labels a group as one', async () => {
		const e = env({ headerOf: () => 'resource crew "Crew"' });
		await addResourceFlow(e, { parent: null, index: 0 }, 'Crew', 'group');
		expect(e.sent[0]).toMatchObject({ label: 'Added group Crew' });
	});

	it('sends nothing for an empty name', async () => {
		const e = env();
		expect(await addResourceFlow(e, { parent: null, index: 0 }, '  ', 'person')).toBeNull();
		expect(e.sent).toEqual([]);
	});

	it('selects nobody when the edit was refused, or the plan changed meanwhile', async () => {
		const refused = env({
			dispatch: async () => ({ status: 'refused' }) as unknown as DispatchOutcome,
		});
		expect(await addResourceFlow(refused, { parent: null, index: 0 }, 'X', 'person')).toBeNull();
		expect(refused.selected).toEqual([]);
		let plan: object = {};
		const swapped = env({ plan: () => plan, dispatch: async () => ((plan = {}), applied) });
		expect(await addResourceFlow(swapped, { parent: null, index: 0 }, 'X', 'person')).toBeNull();
		expect(swapped.selected).toEqual([]);
	});

	it('selects nobody when the header cannot be read', async () => {
		const e = env({ headerOf: () => null });
		expect(await addResourceFlow(e, { parent: null, index: 0 }, 'X', 'person')).toBeNull();
		const odd = env({ headerOf: () => 'task t "T"' });
		expect(await addResourceFlow(odd, { parent: null, index: 0 }, 'X', 'person')).toBeNull();
	});
});
