// SPDX-License-Identifier: GPL-2.0-or-later
// Add person and Add group (add.ts, W7): the name is typed first, so one addResource edit gives
// the id from it; the new resource is selected from the applied edit's header, and the parent it
// went into is the applied edit's own (the dispatcher placed it on the text now).
import { describe, expect, it, vi } from 'vitest';
import type { DispatchOutcome } from '../state/edits.svelte';
import type { TjpEdit } from '../tjp/edit/types';
import { addResourceFlow, usableName, type AddResourceEnv } from './add';

const appliedIn = (parent: string | null): DispatchOutcome =>
	({
		status: 'applied',
		edit: { intent: { type: 'addResource', parent, index: 0, name: 'X' } } as unknown as TjpEdit,
	}) as unknown as DispatchOutcome;

function env(over: Partial<AddResourceEnv> = {}): AddResourceEnv & {
	selected: string[];
	sent: unknown[];
} {
	const plan = {};
	const selected: string[] = [];
	const sent: unknown[] = [];
	return {
		plan: () => plan,
		add: vi.fn(async (name, kind) => {
			sent.push({ name, kind });
			return appliedIn('team');
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
	it('sends the typed name, selects the new id and names the parent the edit used', async () => {
		const e = env();
		const added = await addResourceFlow(e, ' Cy Twombly ', 'person');
		expect(added).toEqual({ id: 'cy_twombly', parent: 'team' });
		expect(e.selected).toEqual(['cy_twombly']);
		expect(e.sent).toEqual([{ name: 'Cy Twombly', kind: 'person' }]);
	});

	it('passes the kind on, so a group is added as one', async () => {
		const e = env({ headerOf: () => 'resource crew "Crew"' });
		await addResourceFlow(e, 'Crew', 'group');
		expect(e.sent[0]).toEqual({ name: 'Crew', kind: 'group' });
	});

	it('sends nothing for an empty name', async () => {
		const e = env();
		expect(await addResourceFlow(e, '  ', 'person')).toBeNull();
		expect(e.sent).toEqual([]);
	});

	it('selects nobody when the edit was refused, or the plan changed meanwhile', async () => {
		const refused = env({
			add: async () => ({ status: 'refused' }) as unknown as DispatchOutcome,
		});
		expect(await addResourceFlow(refused, 'X', 'person')).toBeNull();
		expect(refused.selected).toEqual([]);
		let plan: object = {};
		const swapped = env({ plan: () => plan, add: async () => ((plan = {}), appliedIn(null)) });
		expect(await addResourceFlow(swapped, 'X', 'person')).toBeNull();
		expect(swapped.selected).toEqual([]);
	});

	it('selects nobody when the header cannot be read', async () => {
		const e = env({ headerOf: () => null });
		expect(await addResourceFlow(e, 'X', 'person')).toBeNull();
		const odd = env({ headerOf: () => 'task t "T"' });
		expect(await addResourceFlow(odd, 'X', 'person')).toBeNull();
	});
});
