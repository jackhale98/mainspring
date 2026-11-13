// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The outline tree keeps where the person was across an unmount (a phone drops the Plan tab's tree
// while another tab shows): its scroll and its selected row go to the owner's `view` and come back.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildOutline, newOutlineView } from '../lib/state/outline';
import { buildIndex } from '../lib/tjp/index';
import { inline } from '../lib/tjp/index/testing';
import OutlineTree from './OutlineTree.svelte';

const PLAN = `project p "P" 2026-01-05 +30d
task a "A"
task b "B"
task c "C"
`;

function nodes() {
	const ws = inline({ 'plan.tjp': PLAN });
	const snap = ws.snapshot();
	const outline = buildOutline(
		buildIndex(snap),
		(r) => snap.files.get(r.file)?.text.sliceString(r.from, r.to) ?? null,
	);
	return outline.tasks;
}

beforeAll(() => {
	// jsdom has no CSS.escape and no ResizeObserver (the size bindings use one).
	(globalThis as { CSS?: unknown }).CSS ??= {
		escape: (s: string) => s.replace(/([^\w-])/g, '\\$1'),
	};
	// ...and no layout: a row is 36 px high.
	Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
		configurable: true,
		get: () => 36,
	});
	(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	};
});

const mounted: Array<ReturnType<typeof mount>> = [];
afterEach(() => {
	for (const m of mounted.splice(0)) void unmount(m);
	document.body.innerHTML = '';
});

function show(view = newOutlineView(), onselect = vi.fn()) {
	const target = document.createElement('div');
	document.body.append(target);
	mounted.push(
		mount(OutlineTree, {
			target,
			props: {
				label: 'Tasks',
				nodes: nodes(),
				collapsed: new Set(),
				errors: new Map(),
				emptyText: 'none',
				ontoggle: () => undefined,
				onselect,
				view,
			},
		}),
	);
	flushSync();
	return { target, view, onselect };
}

describe('OutlineTree view', () => {
	it('puts back the scroll and the selected row it was left with', async () => {
		const { target } = show({ top: 90, selected: 'task:b', focus: 'task:b' });
		await tick();
		expect(target.querySelector<HTMLElement>('.scroller')?.scrollTop).toBe(90);
		const selected = target.querySelectorAll('[role="treeitem"][aria-selected="true"]');
		expect(selected).toHaveLength(1);
		expect(selected[0]?.getAttribute('data-key')).toBe('task:b');
	});

	it('writes what the person does to the view, for the next mount', async () => {
		const { target, view, onselect } = show();
		const scroller = target.querySelector<HTMLElement>('.scroller');
		if (scroller) {
			scroller.scrollTop = 40;
			scroller.dispatchEvent(new Event('scroll'));
		}
		target.querySelector<HTMLElement>('[data-key="task:c"]')?.click();
		await tick();
		expect(view).toEqual({ top: 40, selected: 'task:c', focus: 'task:c' });
		expect(onselect).toHaveBeenCalledOnce();
	});

	it('starts at the top with nothing selected when it has no view', () => {
		const { target } = show();
		expect(target.querySelector<HTMLElement>('.scroller')?.scrollTop).toBe(0);
		expect(target.querySelectorAll('[aria-selected="true"]')).toHaveLength(0);
	});
});
