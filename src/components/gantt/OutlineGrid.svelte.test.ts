// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The Gantt's treegrid (phase-2.md 10.1, 10.2, 13.2): its rows and cells say what the model says,
// its ARIA structure is complete while rows are virtualised, one element is in the tab order, and
// the keys do what the keyboard model says. It only emits intents; nothing here changes a plan.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { COLUMN_ORDER } from '../../lib/gantt/columns';
import { gridCells } from '../../lib/gantt/grid';
import { buildGanttModel, type GanttModel } from '../../lib/gantt/model';
import { at, plan } from '../../lib/schedule/testing';
import { buildIndex } from '../../lib/tjp/index';
import { inline } from '../../lib/tjp/index/testing';
import { buildOutline } from '../../lib/state/outline';
import { strings } from '../../lib/strings';
import OutlineGrid from './OutlineGrid.svelte';

const PLAN = `project p "P" 2026-01-05 +30d
resource dev "Dev"
task app "App" {
  task ui "UI" { effort 2d }
  task api "API" { length 3d }
}
task docs "Docs" { milestone }
task later "Later"
`;

const result = plan([
	['app', { start: at(0, 9), end: at(3, 17) }],
	['app.ui', { parent: 'app', start: at(0, 9), end: at(1, 17) }],
	['app.api', { parent: 'app', start: at(2, 9), end: at(3, 17) }],
	['docs', { start: at(4, 9), end: at(4, 9), milestone: true }],
]);

function built(text: string, collapsed: ReadonlySet<string> = new Set(), res = result) {
	const ws = inline({ 'plan.tjp': text });
	const snap = ws.snapshot();
	const idx = buildIndex(snap);
	const outline = buildOutline(
		idx,
		(r) => snap.files.get(r.file)?.text.sliceString(r.from, r.to) ?? null,
	);
	const model = buildGanttModel({
		nodes: outline.tasks,
		collapsed,
		result: res,
		dimmed: false,
		links: [],
		analysis: null,
		locale: 'en-US',
	});
	return { model, byKey: outline.byKey };
}

function modelOf(collapsed: ReadonlySet<string> = new Set()): GanttModel {
	return built(PLAN, collapsed).model;
}

const index = buildIndex(inline({ 'plan.tjp': PLAN }).snapshot());

beforeAll(() => {
	// jsdom has no CSS.escape.
	(globalThis as { CSS?: unknown }).CSS ??= {
		escape: (s: string) => s.replace(/([^\w-])/g, '\\$1'),
	};
});

const mounted: Array<ReturnType<typeof mount>> = [];
afterEach(() => {
	for (const app of mounted.splice(0)) void unmount(app);
	document.body.innerHTML = '';
});

function setup(over: Record<string, unknown> = {}, model: GanttModel = modelOf()) {
	const handlers = {
		ontoggle: vi.fn(),
		onselect: vi.fn(),
		onopen: vi.fn(),
		onreveal: vi.fn(() => Promise.resolve()),
	};
	const props = $state({
		model,
		analysis: null,
		sizing: () => null,
		shown: COLUMN_ORDER,
		first: 0,
		last: 99,
		rowHeight: 40,
		headerHeight: 64,
		page: 5,
		selectedKey: null as string | null,
		announcement: '',
		...handlers,
		...over,
	});
	const target = document.createElement('div');
	document.body.append(target);
	mounted.push(mount(OutlineGrid, { target, props }));
	flushSync();
	const grid = target.querySelector<HTMLElement>('[role="treegrid"]');
	if (!grid) throw new Error('no treegrid');
	const rows = (): HTMLElement[] => [
		...grid.querySelectorAll<HTMLElement>('[role="row"][data-key]'),
	];
	return { grid, rows, props, target, ...handlers, model };
}

const press = (el: Element, key: string, init: KeyboardEventInit = {}): void => {
	el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
};

describe('the treegrid mirrors the model', () => {
	it('has a labelled treegrid, a header row of every column, and one row per task', () => {
		const { grid, rows, model } = setup();
		expect(grid.getAttribute('aria-label')).toBe('Tasks');
		expect(grid.getAttribute('aria-rowcount')).toBe(String(model.rows.length + 1));
		expect(grid.getAttribute('aria-colcount')).toBe(String(COLUMN_ORDER.length));
		const heads = [...grid.querySelectorAll('[role="columnheader"]')].map((h) =>
			h.textContent?.trim(),
		);
		expect(heads).toEqual(COLUMN_ORDER.map((c) => strings.grid.columns[c]));
		expect(rows()).toHaveLength(model.rows.length);
	});

	it('writes the level, position, set size, expansion and row index of every row', () => {
		const { rows, model } = setup();
		rows().forEach((el, i) => {
			const r = model.rows[i]!;
			expect(el.getAttribute('aria-level')).toBe(String(r.node.level));
			expect(el.getAttribute('aria-posinset')).toBe(String(r.node.posinset));
			expect(el.getAttribute('aria-setsize')).toBe(String(r.node.setsize));
			expect(el.getAttribute('aria-rowindex')).toBe(String(i + 2));
			expect(el.getAttribute('aria-expanded')).toBe(
				r.expanded === null ? null : String(r.expanded),
			);
		});
		// The tree is what the text says: App has two children, which are 1 and 2 of 2.
		const [app, ui, api] = rows();
		expect(app?.getAttribute('aria-expanded')).toBe('true');
		expect([ui, api].map((e) => e?.getAttribute('aria-level'))).toEqual(['2', '2']);
		expect([ui, api].map((e) => e?.getAttribute('aria-posinset'))).toEqual(['1', '2']);
	});

	it('says in every cell what gridCells says, blank cells as "none" to a screen reader', () => {
		const sizing = (id: string): string | null => {
			const sym = index.tasks.get(id);
			return sym ? (id === 'app.ui' ? '2d effort' : null) : null;
		};
		const { rows, model } = setup({ sizing });
		const input = { model, analysis: null, sizing };
		rows().forEach((el, i) => {
			const want = gridCells(model.rows[i]!, input);
			const cells = [...el.querySelectorAll<HTMLElement>('[data-col]')];
			expect(cells.map((c) => c.dataset['col'])).toEqual(want.map((w) => w.column));
			cells.forEach((c, k) => {
				const w = want[k]!;
				const text = (w.column === 'name' ? c.querySelector('.label') : c)?.textContent?.trim();
				expect(text, `${model.rows[i]?.name} ${w.column}`).toBe(w.text);
				expect(c.getAttribute('aria-label')).toBe(w.blank ? strings.grid.emptyWords : null);
			});
		});
		expect(rows()[1]?.querySelector('[data-col="effort"]')?.textContent?.trim()).toBe('2d effort');
	});

	it('gives each row an accessible name with its dates, and the name cell is the row header', () => {
		const { rows } = setup();
		expect(rows()[1]?.getAttribute('aria-label')).toMatch(
			/^UI: Mon, Jan 5, 2026 to Tue, Jan 6, 2026/,
		);
		expect(rows()[1]?.querySelector('[data-col="name"]')?.getAttribute('role')).toBe('rowheader');
		expect(rows()[1]?.querySelector('[data-col="start"]')?.getAttribute('role')).toBe('gridcell');
	});

	it('hides a column that does not fit from the eye, not from the table', () => {
		const { rows } = setup({ shown: ['name'] });
		const cells = rows()[0]!.querySelectorAll<HTMLElement>('[data-col]');
		expect(cells).toHaveLength(COLUMN_ORDER.length);
		for (const c of cells) {
			const name = c.dataset['col'] === 'name';
			expect(c.classList.contains('hidden')).toBe(!name);
			expect(c.hasAttribute('tabindex')).toBe(name);
		}
	});

	it('speaks the announcement it is given, in a polite status outside the grid', () => {
		const { grid, target, props } = setup();
		props.announcement = 'Rescheduled. Finish Tue, Jan 13, 2 days later. 2 tasks moved.';
		flushSync();
		const live = target.querySelector('[role="status"]');
		expect(live?.textContent).toBe('Rescheduled. Finish Tue, Jan 13, 2 days later. 2 tasks moved.');
		expect(live?.getAttribute('aria-live')).toBe('polite');
		expect(grid.contains(live)).toBe(false);
	});
});

describe('virtualised rows', () => {
	it('mounts only the range it is given, and keeps every row index true', () => {
		const { grid, rows, model } = setup({ first: 1, last: 3 });
		expect(rows()).toHaveLength(2);
		expect(rows().map((r) => r.getAttribute('aria-rowindex'))).toEqual(['3', '4']);
		// The count is the whole plan, not what is mounted.
		expect(grid.getAttribute('aria-rowcount')).toBe(String(model.rows.length + 1));
		expect(rows()[0]?.style.top).toBe('40px');
	});

	it('keeps the focused row mounted when the range moves away from it', async () => {
		const { grid, rows, props } = setup({ first: 0, last: 2 });
		rows()[0]?.focus();
		await tick();
		props.first = 2;
		props.last = 4;
		flushSync();
		expect(rows().map((r) => r.dataset['key'])).toContain('task:app');
		expect(document.activeElement).toBe(grid.querySelector('[data-key="task:app"]'));
	});
});

describe('roving tabindex and the keys', () => {
	const tabbable = (grid: HTMLElement): Element[] => [...grid.querySelectorAll('[tabindex="0"]')];

	it('puts exactly one element in the tab order: the selected row, else the first', () => {
		const a = setup();
		expect(tabbable(a.grid)).toEqual([a.rows()[0]]);
		const b = setup({ selectedKey: 'task:app.api' });
		expect(tabbable(b.grid)).toEqual([b.grid.querySelector('[data-key="task:app.api"]')]);
	});

	it('moves focus with the arrows and does not select', async () => {
		const { rows, onselect, onreveal } = setup();
		rows()[0]?.focus();
		press(rows()[0]!, 'ArrowDown');
		await tick();
		await tick();
		expect(onreveal).toHaveBeenCalledWith(1);
		expect(document.activeElement).toBe(rows()[1]);
		expect(onselect).not.toHaveBeenCalled();
		press(rows()[1]!, 'End');
		await tick();
		await tick();
		expect(document.activeElement).toBe(rows().at(-1));
		// The focused row is the one in the tab order now.
		expect(rows().filter((r) => r.getAttribute('tabindex') === '0')).toEqual([rows().at(-1)]);
	});

	it('collapses an expanded row with Left and expands a collapsed one with Right', () => {
		const open = setup();
		press(open.rows()[0]!, 'ArrowLeft');
		expect(open.ontoggle).toHaveBeenCalledWith('task:app');
		const closed = setup({}, modelOf(new Set(['task:app'])));
		press(closed.rows()[0]!, 'ArrowRight');
		expect(closed.ontoggle).toHaveBeenCalledWith('task:app');
	});

	it('goes into the cells with Right and back to the row with Left', async () => {
		const { rows } = setup();
		const [, ui] = rows();
		ui?.focus();
		press(ui!, 'ArrowRight');
		await tick();
		await tick();
		const name = ui!.querySelector('[data-col="name"]');
		expect(document.activeElement).toBe(name);
		press(name!, 'ArrowRight');
		await tick();
		await tick();
		expect(document.activeElement).toBe(ui!.querySelector('[data-col="start"]'));
		press(document.activeElement!, 'Home');
		await tick();
		await tick();
		expect(document.activeElement).toBe(name);
		press(name!, 'ArrowLeft');
		await tick();
		await tick();
		expect(document.activeElement).toBe(ui);
	});

	it('skips a column that is not drawn', async () => {
		const { rows } = setup({ shown: ['name', 'start'] });
		const [, ui] = rows();
		ui?.focus();
		press(ui!, 'ArrowRight');
		await tick();
		press(ui!.querySelector('[data-col="name"]')!, 'End');
		await tick();
		await tick();
		expect(document.activeElement).toBe(ui!.querySelector('[data-col="start"]'));
	});

	it('opens on Enter, selects on Space, and leaves F2 alone without a rename handler', () => {
		const { rows, onselect, onopen } = setup();
		const e = new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true });
		rows()[1]!.dispatchEvent(e);
		expect(e.defaultPrevented).toBe(false);
		press(rows()[1]!, 'Enter');
		expect(onselect).toHaveBeenLastCalledWith('task:app.ui');
		expect(onopen).toHaveBeenCalledWith('task:app.ui');
		press(rows()[2]!, ' ');
		expect(onselect).toHaveBeenLastCalledWith('task:app.api');
		expect(onopen).toHaveBeenCalledTimes(1);
	});

	it('renames on F2 when the Gantt can', () => {
		const onrename = vi.fn();
		const { rows } = setup({ onrename });
		press(rows()[1]!, 'F2');
		expect(onrename).toHaveBeenCalledWith('task:app.ui');
	});

	it('toggles a container from its twisty, and selects from any other cell', () => {
		const { rows, ontoggle, onselect } = setup();
		rows()[0]?.querySelector<HTMLElement>('.twisty')?.click();
		expect(ontoggle).toHaveBeenCalledWith('task:app');
		expect(onselect).not.toHaveBeenCalled();
		rows()[2]?.querySelector<HTMLElement>('[data-col="end"]')?.click();
		expect(onselect).toHaveBeenCalledWith('task:app.api');
	});
});

describe('focus survives the rows around it changing', () => {
	const MANY =
		'project p "P" 2026-01-05 +30d\n' +
		Array.from({ length: 60 }, (_, i) => `task t${i} "T${i}"`).join('\n') +
		'\n';

	it('keeps the focused row when the window moves past it, whichever side it falls on', async () => {
		const many = built(MANY, new Set(), plan([])).model;
		const { rows, props } = setup({ first: 0, last: 30 }, many);
		const el = rows().find((r) => r.dataset['key'] === 'task:t5')!;
		el.focus();
		await tick();
		expect(document.activeElement).toBe(el);

		// Scrolled down: the row is now above the window.
		props.first = 10;
		props.last = 40;
		flushSync();
		await tick();
		expect(el.isConnected).toBe(true);
		expect(document.activeElement).toBe(el);
		// The mounted rows stay in row order, the pinned one first.
		const keys = rows().map((r) => r.dataset['key']);
		expect(keys[0]).toBe('task:t5');
		expect(keys.slice(1)).toEqual(Array.from({ length: 30 }, (_, i) => `task:t${i + 10}`));

		// And back, then past it on the other side: the row is below the window.
		props.first = 0;
		props.last = 4;
		flushSync();
		await tick();
		expect(document.activeElement).toBe(el);
		props.first = 0;
		props.last = 3;
		flushSync();
		await tick();
		expect(document.activeElement).toBe(el);
		expect(rows().map((r) => r.dataset['key'])).toEqual([
			'task:t0',
			'task:t1',
			'task:t2',
			'task:t5',
		]);
	});

	it('moves the focus to the collapsed ancestor when the focused row is hidden', async () => {
		const open = built(PLAN);
		const { rows, props } = setup({ outline: open.byKey }, open.model);
		const ui = rows().find((r) => r.dataset['key'] === 'task:app.ui')!;
		ui.focus();
		await tick();
		const closed = built(PLAN, new Set(['task:app']));
		props.model = closed.model;
		flushSync();
		await tick();
		await tick();
		expect(ui.isConnected).toBe(false);
		expect(document.activeElement).toBe(rows().find((r) => r.dataset['key'] === 'task:app'));
	});

	it('finds a visible ancestor when the direct parent is hidden too', async () => {
		const deep = `project p "P" 2026-01-05 +30d
task a "A" {
  task b "B" {
    task c "C"
  }
}
task z "Z"
`;
		const open = built(deep, new Set(), plan([]));
		const { rows, props } = setup({ outline: open.byKey }, open.model);
		const c = rows().find((r) => r.dataset['key'] === 'task:a.b.c')!;
		c.focus();
		await tick();
		// A collapses: B is hidden as well as C, so the nearest ancestor that is a row is A.
		props.model = built(deep, new Set(['task:a']), plan([])).model;
		flushSync();
		await tick();
		await tick();
		expect(document.activeElement).toBe(rows().find((r) => r.dataset['key'] === 'task:a'));
	});

	it('moves the focus to the parent when the focused row is deleted', async () => {
		const first = built(PLAN);
		const { rows, props } = setup({ outline: first.byKey }, first.model);
		const api = rows().find((r) => r.dataset['key'] === 'task:app.api')!;
		api.focus();
		await tick();
		props.model = built(PLAN.replace('  task api "API" { length 3d }\n', '')).model;
		flushSync();
		await tick();
		await tick();
		expect(api.isConnected).toBe(false);
		expect(document.activeElement).toBe(rows().find((r) => r.dataset['key'] === 'task:app'));
	});

	it('moves the focus to the nearest row when a top-level row is deleted', async () => {
		const first = built(PLAN);
		const { rows, props } = setup({ outline: first.byKey }, first.model);
		const docs = rows().find((r) => r.dataset['key'] === 'task:docs')!;
		docs.focus();
		await tick();
		props.model = built(PLAN.replace('task docs "Docs" { milestone }\n', '')).model;
		flushSync();
		await tick();
		await tick();
		expect(docs.isConnected).toBe(false);
		// Later took its place in the list.
		expect(document.activeElement).toBe(rows().find((r) => r.dataset['key'] === 'task:later'));
	});

	it('does not take the focus when it was not in the grid', async () => {
		const open = built(PLAN);
		const { rows, props } = setup({ outline: open.byKey }, open.model);
		const outside = document.createElement('button');
		document.body.append(outside);
		rows()[1]?.focus();
		await tick();
		outside.focus();
		await tick();
		props.model = built(PLAN, new Set(['task:app'])).model;
		flushSync();
		await tick();
		await tick();
		expect(document.activeElement).toBe(outside);
	});
});
