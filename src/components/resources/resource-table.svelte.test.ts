// SPDX-License-Identifier: GPL-2.0-or-later
// The resource table's commands (resource-table.svelte.ts): select and the sheet layouts' second tap,
// W6 regroup through the planner (an intent, a refusal as a toast), W7 add (the name first), rename and
// delete, with a fake dispatcher that records what is sent.
import { describe, expect, it, vi } from 'vitest';
import type { AppState } from '../../lib/state/app.svelte';
import type { DispatchOutcome } from '../../lib/state/edits.svelte';
import { InspectorState } from '../../lib/state/inspector.svelte';
import { buildOutline } from '../../lib/state/outline';
import { SelectionState } from '../../lib/state/selection.svelte';
import type { EditIntent, TjpEdit } from '../../lib/tjp/edit/types';
import { indexOf } from '../../lib/workload/testing';
import { ResourceTable } from './resource-table.svelte';

const TEXT = `project p "P" 2026-01-05 +8w
resource dev "Developers" {
  resource jack "Jack"
  resource ana "Ana"
}
resource rev "Reviewer"
task t1 "Build" { effort 2d  allocate jack }
task t2 "Test" { effort 2d  allocate rev }
`;

function fake(over: Partial<{ outcome: DispatchOutcome }> = {}) {
	const index = indexOf(TEXT);
	const sent: Array<{ intent: EditIntent; label: string }> = [];
	const refused: Array<{ message: string }> = [];
	const selection = new SelectionState();
	const inspector = new InspectorState(selection);
	const edit = { select: { file: 'plan.tjp', from: 0, to: 0 } } as unknown as TjpEdit;
	const outcome = over.outcome ?? ({ status: 'applied', edit } as unknown as DispatchOutcome);
	const app = {
		index,
		outline: buildOutline(index),
		run: null,
		selection,
		inspector,
		workspace: {
			snapshot: () => ({
				version: index.version,
				files: new Map([['plan.tjp', { text: { sliceString: () => 'resource cy "Cy"' } }]]),
			}),
		},
		edits: {
			dispatch: vi.fn(async (intent: EditIntent, o: { label: { text: string } }) => {
				sent.push({ intent, label: o.label.text });
				return outcome;
			}),
			refuse: (message: string) => void refused.push({ message }),
		},
	} as unknown as AppState;
	return { app, sent, refused, selection, inspector, table: new ResourceTable(app, () => true) };
}

describe('rows', () => {
	it('are the visible rows of the outline, with a closed group’s members out', () => {
		const { table } = fake();
		expect(table.rows.map((r) => r.node.id)).toEqual(['dev', 'jack', 'ana', 'rev']);
		table.toggle('resource:dev');
		expect(table.rows.map((r) => r.node.id)).toEqual(['dev', 'rev']);
		table.open('resource:dev');
		expect(table.rows).toHaveLength(4);
	});
});

describe('select', () => {
	it('selects the person, and a sheet layout opens the details on the second tap only', () => {
		const { table, selection, inspector } = fake();
		inspector.secondTapOpens = true;
		table.select('resource:ana');
		expect(selection.current).toMatchObject({ kind: 'resource', id: 'ana', origin: 'visual' });
		expect(table.selectedKey).toBe('resource:ana');
		expect(table.focusKey).toBe('resource:ana');
		expect(inspector.sheet).toBe(false);
		table.select('resource:ana');
		expect(inspector.sheet).toBe(true);
	});

	it('Enter selects and moves the keyboard into the details', () => {
		const { table, selection, inspector } = fake();
		table.openDetails('resource:jack');
		expect(selection.current).toMatchObject({ id: 'jack' });
		expect(inspector.focusNonce).toBe(1);
		expect(inspector.explicit).toBe(true);
	});

	it('ignores a key the outline does not have', () => {
		const { table, selection } = fake();
		table.select('resource:ghost');
		expect(selection.current).toBeNull();
	});
});

describe('W6 regroup', () => {
	it('sends moveResource as one intent, and opens the group', async () => {
		const { table, sent } = fake();
		table.toggle('resource:dev');
		expect(await table.regroup('resource:rev', 'resource:dev', 2)).toBe(true);
		expect(sent).toEqual([
			{
				intent: { type: 'moveResource', resource: 'rev', parent: 'dev', index: 2 },
				label: 'Reviewer moved into Developers',
			},
		]);
		expect(table.collapsed.has('resource:dev')).toBe(false);
		expect(table.announcement).toBe('Reviewer moved into Developers');
	});

	it('refuses a drop on a person that tasks are allocated to, with its sentence, and sends nothing', async () => {
		const { table, sent, refused } = fake();
		expect(await table.regroup('resource:ana', 'resource:jack', 0)).toBe(false);
		expect(sent).toEqual([]);
		expect(refused[0]?.message).toBe(
			'Jack has tasks, so people cannot join it. Make a group for them instead.',
		);
		expect(table.announcement).toBe(refused[0]?.message);
	});

	it('steps along the tree: indent into the group above, up, and outdent', async () => {
		const { table, sent } = fake();
		expect(await table.step('resource:rev', 'indent')).toBe(true);
		expect(sent.at(-1)?.intent).toEqual({
			type: 'moveResource',
			resource: 'rev',
			parent: 'dev',
			index: 2,
		});
		expect(await table.step('resource:ana', 'up')).toBe(true);
		expect(sent.at(-1)?.intent).toMatchObject({ resource: 'ana', parent: 'dev', index: 0 });
		expect(await table.step('resource:jack', 'outdent')).toBe(true);
		expect(sent.at(-1)?.intent).toMatchObject({ resource: 'jack', parent: null, index: 1 });
	});

	it('reads the place from the fresh tree: a step waits for the outline to catch up with the text', async () => {
		// After a Redo the text has Reviewer inside Developers, but the index (and the outline built
		// from it) still shows the old text for 60 ms. Up must swap Reviewer with Ana, not take it out.
		const { app, sent, table } = fake();
		const old = { index: app.index, outline: app.outline };
		const next = indexOf(
			TEXT.replace('resource rev "Reviewer"\n', '').replace(
				'  resource ana "Ana"\n',
				'  resource ana "Ana"\n  resource rev "Reviewer"\n',
			),
		);
		Object.defineProperty(next, 'version', {
			value: (old.index as { version: number }).version + 1,
		});
		let caughtUp = false;
		Object.defineProperty(app, 'index', { get: () => (caughtUp ? next : old.index) });
		Object.defineProperty(app, 'outline', {
			get: () => (caughtUp ? buildOutline(next) : old.outline),
		});
		const ws = app.workspace as unknown as { snapshot: () => { version: number } };
		ws.snapshot = () => ({ version: next.version });
		setTimeout(() => (caughtUp = true), 60);
		expect(await table.step('resource:rev', 'up')).toBe(true);
		expect(sent.at(-1)?.intent).toEqual({
			type: 'moveResource',
			resource: 'rev',
			parent: 'dev',
			index: 1,
		});
	});

	it('refuses a drop whose tree is older than the text, and sends nothing', async () => {
		const { app, table, sent, refused } = fake();
		const shown = (app.index as { version: number }).version - 1;
		expect(await table.regroup('resource:rev', 'resource:dev', 2, shown)).toBe(false);
		expect(sent).toEqual([]);
		expect(refused[0]?.message).toBe(
			'The plan changed while you were moving. Nothing was moved; try again.',
		);
		expect(table.announcement).toBe(refused[0]?.message);
		// The same drop from the tree of the current version goes through.
		const now = (app.index as { version: number }).version;
		expect(await table.regroup('resource:rev', 'resource:dev', 2, now)).toBe(true);
	});

	it('says there is nowhere to go, without sending', async () => {
		const { table, sent } = fake();
		expect(await table.step('resource:dev', 'up')).toBe(false);
		expect(table.announcement).toBe('Already the first in its group.');
		expect(await table.step('resource:dev', 'outdent')).toBe(false);
		expect(table.announcement).toBe('Already at the top level.');
		expect(sent).toEqual([]);
	});
});

describe('W7 add, rename, delete', () => {
	it('adds a person named first at the end of the selected group, and selects them', async () => {
		const { table, sent, selection } = fake();
		table.select('resource:dev');
		table.startAdd('person');
		expect(table.adding).toBe('person');
		expect(await table.commitAdd(' Cy ')).toBe(true);
		expect(sent).toEqual([
			{
				intent: { type: 'addResource', parent: 'dev', index: 2, name: 'Cy' },
				label: 'Added Cy',
			},
		]);
		expect(table.adding).toBeNull();
		expect(selection.current).toMatchObject({ id: 'cy' });
		expect(table.focusKey).toBe('resource:cy');
	});

	it('adds a group after the selected row, and nothing for an empty name', async () => {
		const { table, sent } = fake();
		table.select('resource:jack');
		table.startAdd('group');
		expect(await table.commitAdd('   ')).toBe(false);
		expect(sent).toEqual([]);
		expect(table.adding).toBe('group');
		await table.commitAdd('Crew');
		expect(sent[0]?.intent).toEqual({ type: 'addResource', parent: 'dev', index: 1, name: 'Crew' });
		expect(sent[0]?.label).toBe('Added group Crew');
		table.cancelAdd();
		expect(table.adding).toBeNull();
	});

	it('renames by the name only, and ignores an empty or unchanged name', async () => {
		const { table, sent } = fake();
		table.renaming = 'resource:jack';
		expect(await table.rename('resource:jack', 'Jack B')).toBe(true);
		expect(table.renaming).toBeNull();
		expect(sent[0]).toEqual({
			intent: { type: 'renameResource', resource: 'jack', name: 'Jack B' },
			label: 'Jack renamed Jack B',
		});
		expect(await table.rename('resource:jack', '  ')).toBe(false);
		expect(await table.rename('resource:jack', 'Jack')).toBe(false);
		expect(sent).toHaveLength(1);
	});

	it('deletes, then focuses the next row and clears the selection', async () => {
		const { table, sent, selection } = fake();
		table.select('resource:ana');
		expect(await table.remove('resource:ana')).toBe(true);
		expect(sent[0]).toEqual({
			intent: { type: 'deleteResource', resource: 'ana' },
			label: 'Deleted Ana',
		});
		expect(table.focusKey).toBe('resource:rev');
		expect(selection.current).toBeNull();
		expect(table.announcement).toBe('Ana deleted');
	});

	it('keeps the selection when the delete is refused', async () => {
		const { table, selection } = fake({
			outcome: { status: 'refused' } as unknown as DispatchOutcome,
		});
		table.select('resource:jack');
		expect(await table.remove('resource:jack')).toBe(false);
		expect(selection.current).toMatchObject({ id: 'jack' });
	});
});
