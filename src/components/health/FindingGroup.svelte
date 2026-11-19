<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	One check's findings as a windowed list (phase-3.md 8.2, 10; T18): only the rows near what the
	scroller shows are mounted, with spacers of the height of the rest (lib/health/window.ts), so
	241 findings, or 402 with milestones, do not mount 8,000 nodes at once (905 ms at 4x CPU on a
	Pixel 7 emulation, measured). Rows are keyed by what the finding is about (`findingKey`), so a
	row's open fix editor never lands on another finding after a reschedule.

	Access stays whole:
	- each row says its place in the list (`aria-posinset`, `aria-setsize`), and the spacers are
	  hidden, so a screen reader counts every finding even where it reads a part;
	- the row that has the focus and the few after it stay mounted, so Tab and Shift+Tab always
	  find the next row, and a row that is scrolled to takes the window with it;
	- the headings and the "jump to a check" buttons are outside the windows.
	A list short enough to be mounted whole (the window covers it) behaves as an ordinary list.

	Still while it is measured: a row's height is measured when it mounts (synchronously, so a row that
	comes and goes within a frame is measured too, and not rounded) and kept by its key for good, and
	unmeasured rows have one stable estimate (lib/health/window.ts, anchor.ts). Where the window or a
	height changes above what the scroller shows, the list holds the first row in view itself: WebKit
	has no scroll anchoring, and Chromium's is turned off for the panel (HealthPanel) so that the two do
	not add up. While a finger or a fling is scrolling it does not write `scrollTop` (iOS stops the
	fling): it holds the row with a bias in the before-spacer and puts the bias into `scrollTop` when
	the scrolling stops.
-->
<script lang="ts">
	import { flushSync, onMount, untrack } from 'svelte';
	import {
		MEASURE_EPSILON,
		anchorShift,
		nextBias,
		pickAnchor,
		remember,
		resizeShift,
		spacerOf,
		type Anchor,
		type RowBox,
		type RowResize,
	} from '../../lib/health/anchor';
	import { findingKey } from '../../lib/health/panel-model';
	import type { FixEnv } from '../../lib/health/run-fix';
	import type { TextContext } from '../../lib/health/text';
	import type { Finding } from '../../lib/health/types';
	import { estimateOf, sameWindow, windowOf, type Windowed } from '../../lib/health/window';
	import type { ResourceId } from '../../lib/tjp/index';
	import FindingRow from './FindingRow.svelte';
	import { scrollerOf } from './scroller';

	interface Props {
		findings: readonly Finding[];
		text: TextContext;
		env: FixEnv;
		people: ReadonlyArray<{ readonly id: ResourceId; readonly name: string }>;
		selected: string | null;
		onselect: (task: string) => void;
		onshowgantt: (task: string, person: ResourceId) => void;
	}
	let { findings, text, env, people, selected, onselect, onshowgantt }: Props = $props();

	/** Scrolling counts as going on for this long after the last scroll event, in ms. */
	const IDLE_MS = 150;

	/** Unique per finding: what it is about, and a count for the rare repeat. */
	const keys = $derived.by(() => {
		const seen = new Map<string, number>();
		return findings.map((f) => {
			const base = findingKey(f);
			const n = seen.get(base) ?? 0;
			seen.set(base, n + 1);
			return n === 0 ? base : `${base}#${n}`;
		});
	});

	let list: HTMLElement | undefined = $state();
	/** Measured heights (with the gap below), by key. */
	let measured = $state.raw<ReadonlyMap<string, number>>(new Map());
	let view = $state({ from: 0, to: typeof innerHeight === 'number' ? innerHeight : 800 });
	let focused = $state<number | null>(null);
	/** What an unmeasured row is taken to be: stable once enough rows are measured. */
	let estimate = $state(estimateOf([], null).estimate);
	let frozen: number | null = null;
	/** Px added to the before-spacer to hold the view while the scroller is being scrolled. */
	let bias = $state(0);

	const heights = $derived(keys.map((k) => measured.get(k)));
	// The same object while nothing in the window changed, so a scroll that stays within it runs nothing.
	let last: Windowed | null = null;
	const win = $derived.by(() => {
		const next = windowOf(heights, view.from - bias, view.to - bias, focused, estimate);
		if (last !== null && sameWindow(last, next)) return last;
		last = next;
		return next;
	});
	const before = $derived(spacerOf(win.before, bias));

	/** Takes new measurements in, and moves the estimate with them until it is stable. */
	function learn(updates: Iterable<readonly [string, number]>): void {
		const next = remember(measured, updates);
		if (next === measured) return;
		measured = next;
		const e = estimateOf([...next.values()], frozen);
		if (e.frozen) frozen = e.estimate;
		estimate = e.estimate;
	}

	let width = 0;
	function look(): void {
		if (!list) return;
		const scroller = scrollerOf(list);
		const top = scroller ? scroller.getBoundingClientRect().top : 0;
		const height = scroller ? scroller.clientHeight : innerHeight;
		const offset = list.getBoundingClientRect().top - top;
		const from = Math.max(0, -offset);
		const to = Math.max(from, height - offset);
		if (Math.abs(from - view.from) > 1 || Math.abs(to - view.to) > 1) view = { from, to };
		// Rows wrap differently at another width (a rotated phone): what was measured is stale.
		const now = list.clientWidth;
		if (now > 0 && width > 0 && Math.abs(now - width) > 1) {
			measured = new Map();
			frozen = null;
			estimate = estimateOf([], null).estimate;
		}
		if (now > 0) width = now;
	}

	let frame = 0;
	function soon(): void {
		if (frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			look();
		});
	}

	// Is the scroller being scrolled: a finger is down, or it scrolled a moment ago.
	let touching = false;
	let lastScroll = -Infinity;
	const scrolling = (): boolean => touching || performance.now() - lastScroll < IDLE_MS;
	let release = 0;

	/**
	 * The scrolling stopped: the bias goes. The spacer grows back in a render like any other, and the
	 * list holds the row in view through it as it does through a window change, now by scrolling.
	 */
	function settle(): void {
		release = 0;
		if (bias === 0) return;
		if (scrolling()) return again();
		owed = 0;
		flushSync(() => {
			bias = 0;
		});
	}
	function again(): void {
		if (release) clearTimeout(release);
		release = window.setTimeout(settle, IDLE_MS + 20);
	}

	onMount(() => {
		if (!list) return;
		const scroller = scrollerOf(list);
		const target: EventTarget = scroller ?? window;
		const scrolled = (): void => {
			lastScroll = performance.now();
			soon();
		};
		const down = (): void => {
			touching = true;
		};
		const up = (): void => {
			touching = false;
			if (bias !== 0) again();
		};
		target.addEventListener('scroll', scrolled, { passive: true });
		target.addEventListener('touchstart', down, { passive: true });
		target.addEventListener('touchend', up, { passive: true });
		target.addEventListener('touchcancel', up, { passive: true });
		const ro = new ResizeObserver(soon);
		ro.observe(scroller ?? document.documentElement);
		look();
		return () => {
			target.removeEventListener('scroll', scrolled);
			target.removeEventListener('touchstart', down);
			target.removeEventListener('touchend', up);
			target.removeEventListener('touchcancel', up);
			ro.disconnect();
			if (frame) cancelAnimationFrame(frame);
			if (release) clearTimeout(release);
		};
	});

	/** Scrolls the scroller (or the page, when nothing else scrolls) by `by` px. */
	function scrollBy(by: number): void {
		if (Math.abs(by) < MEASURE_EPSILON || !list) return;
		const scroller = scrollerOf(list);
		if (scroller) scroller.scrollTop += by;
		else window.scrollBy(0, by);
	}

	/** What is shown moved down by `moved` px: hold it, by the bias while scrolling, else by scrolling. */
	function hold(moved: number): void {
		if (Math.abs(moved) < 0.5) return;
		if (!scrolling()) return scrollBy(moved);
		const next = nextBias(bias, moved, win.before);
		if (next.bias !== bias) {
			bias = next.bias;
			owed += next.owed;
		}
		again();
	}

	const mounted = (ul: HTMLElement): HTMLElement[] => [
		...ul.querySelectorAll<HTMLElement>(':scope > li[data-key]'),
	];
	/** The gap below a row, which its height is counted with. */
	const gapOf = (el: HTMLElement): number => parseFloat(getComputedStyle(el).marginBlockEnd) || 0;

	/** The mounted rows and the list, in px from the list's top, and where the scroller's view is. */
	function boxes(ul: HTMLElement): { rows: RowBox[]; height: number; from: number; to: number } {
		const at = ul.getBoundingClientRect();
		const scroller = scrollerOf(ul);
		const rows = mounted(ul).map((li) => {
			const r = li.getBoundingClientRect();
			return { key: li.dataset['key'] ?? '', top: r.top - at.top, bottom: r.bottom - at.top };
		});
		const v = scroller?.getBoundingClientRect();
		return {
			rows,
			height: at.height,
			from: (v?.top ?? 0) - at.top,
			to: (v?.bottom ?? innerHeight) - at.top,
		};
	}

	// Before the window is laid out again, note what the scroller shows; after, hold it where it was.
	// `owed` is what a bias that was just changed will still move it when it is rendered.
	let anchor: Anchor | null = null;
	let owed = 0;
	let rendering = 0;
	$effect.pre(() => {
		void win;
		void bias;
		if (!list) return;
		rendering = owed;
		owed = 0;
		const b = boxes(list);
		anchor = pickAnchor(b.rows, b.height, b.from, b.to);
	});

	// Row heights: each mounted row is measured as soon as it is laid out, and again when it changes
	// (an editor opens, the panel is resized).
	let rows: ResizeObserver | null = null;
	onMount(() => {
		rows = new ResizeObserver((entries) => {
			const scroller = list ? scrollerOf(list) : null;
			const viewTop = scroller ? scroller.getBoundingClientRect().top : 0;
			const updates: Array<[string, number]> = [];
			const resized: RowResize[] = [];
			for (const e of entries) {
				const el = e.target as HTMLElement;
				const key = el.dataset['key'];
				if (key === undefined || !el.isConnected) continue;
				const gap = gapOf(el);
				const at = el.getBoundingClientRect();
				if (at.height <= 0) continue;
				updates.push([key, at.height + gap]);
				const was = measured.get(key);
				if (was !== undefined && Math.abs(was - gap - at.height) >= MEASURE_EPSILON)
					resized.push({ top: at.top, was: was - gap, now: at.height });
			}
			learn(updates);
			hold(resizeShift(resized, viewTop));
		});
		return () => rows?.disconnect();
	});
	$effect(() => {
		void win;
		void bias;
		const ul = list;
		if (!ul) return;
		untrack(() => {
			if (anchor) {
				const b = boxes(ul);
				hold(anchorShift(anchor, b.rows, b.height, rendering));
				anchor = null;
			}
			rendering = 0;
			const lis = mounted(ul);
			const gap = lis[0] ? gapOf(lis[0]) : 0;
			learn(
				lis.flatMap((li): Array<[string, number]> => {
					const h = li.getBoundingClientRect().height;
					return h > 0 ? [[li.dataset['key'] ?? '', h + gap]] : [];
				}),
			);
			if (rows) for (const li of lis) rows.observe(li);
		});
	});
	// The list moves when what is above it changes size (a group above, a filter): look again.
	$effect(() => {
		void win.before;
		void win.after;
		soon();
	});

	function focusin(e: FocusEvent): void {
		const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-i]');
		focused = li ? Number(li.dataset['i']) : null;
	}
	function focusout(e: FocusEvent): void {
		if (!(e.relatedTarget instanceof Node && list?.contains(e.relatedTarget))) focused = null;
	}
</script>

<!-- Focus moves are the rows' own: the list only tells the window where the focus is. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<ul class="findings" bind:this={list} onfocusin={focusin} onfocusout={focusout} data-windowed>
	{#if before > 0}
		<li class="spacer" role="presentation" aria-hidden="true" style:height="{before}px"></li>
	{/if}
	{#each findings.slice(win.start, win.end) as finding, k (keys[win.start + k])}
		{@const i = win.start + k}
		<FindingRow
			{finding}
			{text}
			{env}
			{people}
			itemKey={keys[i] ?? ''}
			pos={i}
			size={findings.length}
			current={selected !== null &&
				finding.subject.kind === 'task' &&
				finding.subject.id === selected}
			{onselect}
			{onshowgantt}
		/>
	{/each}
	{#if win.after > 0}
		<li class="spacer" role="presentation" aria-hidden="true" style:height="{win.after}px"></li>
	{/if}
</ul>

<style>
	.findings {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.spacer {
		margin: 0;
		padding: 0;
		list-style: none;
	}
</style>
