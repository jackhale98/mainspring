<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The Calendar view (phase-3.md 9.5, 7.1 W3 to W5, 10; T16): holidays, a person's leaves, non-working
	days and milestones by month, and leave painting. A desktop (the view is 1000 px wide or more) shows
	the months as a vertical list, a block of 6 rows each, of which only the ones in view are in the
	DOM (lib/calendar/window.ts); a tablet and a phone show one month with buttons for the next.

	The calendar never changes the schedule or the text. It reads the newest good result and the
	symbol index (lib/calendar/facts.ts) and sends intents: a stroke of Paint or Erase (a drag, or a
	tap on a day), the type picker's Enter, Delete, and the details' fields become a `LeavePaint`
	for T12's planner or a `planLeaveEdit` for the edit API, through run.ts to the dispatcher. So each
	is one undo step with a toast, and a resource in a shared `.tji` asks first. While a newer
	schedule runs the days dim.

	- Pointer: gestures (calendar-gestures.svelte.ts, the shared machine): a click or tap selects
	  (a click and a second tap open the details), a drag covers a run of days, a touch long-press
	  lifts a day first. Paint and Erase apply the drop.
	- Keyboard: the grid pattern on days (lib/calendar/nav.ts). Selection follows focus; Shift with
	  the arrows extends it. L opens the type picker (Enter adds that leave), Delete clears the leave
	  on the selected days, Enter opens the details, Escape closes the picker or the details.
	- Selection is the app's (`app.selection`, kind `days`), so a person's details can follow it.

	Over 400 lines on purpose: this one component owns the scroll container, the selection, the
	focus and the dispatch, which only work together (as Workload.svelte does); the rules are in
	lib/calendar.
-->
<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { createTimeZoneHost } from '../../engine/timezone';
	import { detailsOf } from '../../lib/calendar/details';
	import { monthTitle, rangeLabel, dateLabel, typeName } from '../../lib/calendar/describe';
	import { prepareFacts } from '../../lib/calendar/facts';
	import { buildGrid } from '../../lib/calendar/grid';
	import {
		itemFields,
		planLeaveEdit,
		planLeaveRemove,
		typesFor,
		type LeaveFields,
	} from '../../lib/calendar/leave-edit';
	import { moveDay } from '../../lib/calendar/nav';
	import type { LeavePaint, PaintScope } from '../../lib/calendar/paint';
	import type { PaintItem } from '../../lib/calendar/paint-items';
	import { runIntent, runStroke } from '../../lib/calendar/run';
	import { monthWindow, offsetOfMonth, visibleMonths } from '../../lib/calendar/window';
	import type { AppState } from '../../lib/state/app.svelte';
	import { calendarStrings as C, leavePaintStrings as L } from '../../lib/strings';
	import type { LeaveType } from '../../lib/tjp/edit/types';
	import Mark from '../app/Mark.svelte';
	import CalendarBar from './CalendarBar.svelte';
	import { sameScope, type CalendarMode, type CalendarState } from './calendar-state.svelte';
	import { CalendarGestures } from './calendar-gestures.svelte';
	import DayDetails from './DayDetails.svelte';
	import type { CommitResult } from './LeaveCard.svelte';
	import MonthView from './MonthView.svelte';
	import TypePicker from './TypePicker.svelte';

	interface Props {
		app: AppState;
		/** A phone: the bar is above the tab bar, and there is one month. */
		phone: boolean;
		state: CalendarState;
		/** Goes to the Gantt (the details' "Show in Gantt"). */
		showGantt: () => void;
	}
	let { app, phone, state: cal, showGantt }: Props = $props();

	const zones = createTimeZoneHost();
	let root: HTMLDivElement | undefined = $state();
	let scroller: HTMLDivElement | undefined = $state();
	let details: DayDetails | undefined = $state();
	let rootW = $state(0);
	let listH = $state(0);
	let monthH = $state(0);
	let sheetH = $state(0);
	let scrollTop = $state(0);
	let detailsOpen = $state(false);
	let picker = $state.raw<{ lo: number; hi: number } | null>(null);
	let note = $state('');
	let now = $state(Date.now());
	onMount(() => {
		const clock = setInterval(() => (now = Date.now()), 60_000);
		return () => clearInterval(clock);
	});

	const result = $derived(app.run?.lastGood?.result ?? null);
	const project = $derived(result?.project ?? null);
	const dimmed = $derived(app.run?.outdated ?? false);
	const grid = $derived(buildGrid(project, zones));
	const facts = $derived(
		result && app.index ? prepareFacts({ result, index: app.index, scope: cal.scope, grid }) : null,
	);
	const people = $derived(
		app.outline.resources.flatMap((n) =>
			n.id === null ? [] : [{ id: n.id, name: n.name ?? n.id, level: n.level }],
		),
	);
	const who = $derived(
		cal.scope.kind === 'global'
			? L.everyone
			: (people.find((p) => p.id === (cal.scope as { resource: string }).resource)?.name ??
					(cal.scope as { resource: string }).resource),
	);

	const listMode = $derived(!phone && rootW >= 1000);
	const nMonths = $derived(grid.months.length);
	const todayDay = $derived.by(() => {
		if (!project) return null;
		const d = grid.dayAt(Math.round((now - Date.parse(project.start)) / 60_000));
		return d < 0 ? null : d;
	});

	// The month in view: the one shown (single), or the one at the top of the list.
	const topMonth = $derived(
		listMode
			? visibleMonths(scrollTop, listH, monthH, nMonths)[0]
			: Math.max(0, Math.min(nMonths - 1, cal.month)),
	);
	const shownTitle = $derived.by(() => {
		const m = grid.months[topMonth];
		return m ? monthTitle(m.year, m.month) : '';
	});
	// --- Selection (the app's `days`), the focus and the tab stop
	const sel = $derived(app.selection.current);
	const selected = $derived.by<readonly [number, number] | null>(() => {
		const d = gestures.drag;
		if (d) return [d.lo, d.hi];
		if (sel?.kind !== 'days' || !sameScope(sel.scope, cal.scope)) return null;
		const lo = grid.dayAt(Math.max(0, sel.from));
		const hi = grid.dayAt(Math.max(0, sel.to - 1));
		return lo >= 0 && hi >= lo ? [lo, hi] : null;
	});
	const firstOfMonth = (m: number): number | null => {
		const b = grid.months[m];
		return b ? Math.max(0, b.base) : null;
	};
	const tabDay = $derived.by<number | null>(() => {
		const n = grid.days.length;
		if (n === 0) return null;
		const want = cal.focus ?? selected?.[0] ?? null;
		if (want !== null && want < n) {
			// Single month: the tab stop must be in the month on screen.
			if (listMode || grid.monthOf(want) === topMonth) return want;
		}
		return firstOfMonth(topMonth);
	});

	/** Mounted blocks: the ones in view and a margin, and the one with the tab stop. */
	const mounted = $derived(
		listMode
			? monthWindow(scrollTop, listH, monthH, nMonths, 1, [grid.monthOf(tabDay ?? -1)])
			: [topMonth],
	);

	function select(lo: number, hi: number): void {
		const a = grid.days[lo];
		const b = grid.days[hi];
		if (a && b) app.selection.selectDays(cal.scope, a.from, b.to);
	}

	const detailed = $derived(
		detailsOpen && selected && facts ? detailsOf(facts, selected[0], selected[1]) : null,
	);
	const rangeText = $derived(selected ? rangeLabel(grid, selected[0], selected[1]) : '');
	const lineText = $derived.by(() => {
		if (!selected) return C.line.none;
		const text = C.line.days(
			rangeLabel(grid, selected[0], selected[1]),
			selected[1] - selected[0] + 1,
		);
		return gestures.drag ? `${C.modes[cal.mode]}: ${text}` : text;
	});

	// --- Live region
	let liveText = $state('');
	let flip = false;
	function announce(text: string): void {
		if (text === '') return;
		flip = !flip;
		liveText = flip ? text : `${text}​`;
	}
	function setMode(m: CalendarMode): void {
		cal.mode = m;
		announce(`${C.painting(C.modes[m], typeName(cal.leaveType))}. ${C.modeHint[m]}`);
	}

	// --- Edits: strokes through the planner, fields through the edit API
	/** Waits for the index to be read from the text now (an edit just applied), up to ~1.5 s. */
	async function fresh(): Promise<void> {
		for (let i = 0; i < 50; i++) {
			const v = app.workspace?.snapshot().version;
			if (app.index === null || v === undefined || app.index.version === v) return;
			await new Promise((r) => setTimeout(r, 30));
		}
	}
	const confirm = (m: string): boolean => globalThis.confirm(m);

	async function apply(op: 'paint' | 'erase', lo: number, hi: number, name = ''): Promise<void> {
		const a = grid.days[lo];
		const b = grid.days[hi];
		if (!a || !b) return;
		select(lo, hi);
		await fresh();
		const index = app.index;
		if (!result || !index) return;
		const scope = cal.scope;
		const stroke: LeavePaint =
			op === 'erase'
				? { type: 'erase', scope, from: a.from, to: b.to }
				: {
						type: 'paint',
						scope,
						from: a.from,
						to: b.to,
						leave: cal.leaveType,
						...(name === '' ? {} : { name }),
					};
		const r = await runStroke(app.edits, stroke, { index, result, zones }, confirm);
		note = r.status === 'refused' ? r.message : '';
	}

	async function commitLeave(item: PaintItem, f: LeaveFields): Promise<CommitResult> {
		const edits = app.edits;
		if (!edits || !project) return {};
		await fresh();
		const index = app.index;
		if (!index) return {};
		const plan = planLeaveEdit(item, f, { index, project, zones });
		if (plan.status === 'invalid') return { error: plan.reason };
		if (plan.status === 'unchanged') return {};
		const o = await runIntent(edits, plan.intent, plan.label, confirm);
		return { applied: o.status === 'applied' };
	}

	async function removeLeave(item: PaintItem): Promise<void> {
		const edits = app.edits;
		await fresh();
		const index = app.index;
		if (!edits || !project || !index) return;
		const plan = planLeaveRemove(item, { index, project });
		await runIntent(edits, plan.intent, plan.label, confirm);
	}

	function openMilestone(task: string): void {
		app.selection.selectTask(task, 'visual');
		announce(C.selectedTask(result?.tasks.find((t) => t.id === task)?.name ?? task));
	}

	// --- Focus and moving between months
	async function focusDay(i: number): Promise<void> {
		cal.focus = i;
		const m = grid.monthOf(i);
		if (!listMode) cal.month = m;
		else revealMonth(m);
		await tick();
		root?.querySelector<HTMLElement>(`[data-day="${i}"]`)?.focus({ preventScroll: true });
	}

	/** Scrolls the list so that month block `m` is wholly in view. */
	function revealMonth(m: number): void {
		if (!scroller || m < 0) return;
		const top = offsetOfMonth(m, monthH);
		let to = scroller.scrollTop;
		if (top < to) to = top;
		else if (top + monthH > to + listH) to = top + monthH - listH;
		if (to !== scroller.scrollTop) {
			scroller.scrollTop = to;
			scrollTop = scroller.scrollTop;
		}
	}

	function goMonth(m: number): void {
		const to = Math.max(0, Math.min(nMonths - 1, m));
		if (!listMode) cal.month = to;
		else if (scroller) {
			scroller.scrollTop = offsetOfMonth(to, monthH);
			scrollTop = scroller.scrollTop;
		}
	}
	function goToday(): void {
		if (todayDay !== null) goMonth(grid.monthOf(todayDay));
	}

	// --- Pointer
	const gestures = new CalendarGestures({
		mode: () => cal.mode,
		scroller: () => scroller,
		valid: (d) => d >= 0 && d < grid.days.length,
		label: (d) => {
			const day = grid.days[d];
			return day ? C.line.lifted(dateLabel(day)) : '';
		},
		tap(day, touch, shift) {
			const anchor = shift && cal.anchor !== null ? cal.anchor : day;
			cal.focus = day;
			if (!shift) cal.anchor = day;
			const lo = Math.min(anchor, day);
			const hi = Math.max(anchor, day);
			const again = selected !== null && selected[0] === lo && selected[1] === hi;
			if (!touch && !shift && cal.mode !== 'select') {
				detailsOpen = true;
				void apply(cal.mode, lo, hi);
				return;
			}
			select(lo, hi);
			// A click selects and shows the details; a finger's first tap selects, the second opens them.
			if (!touch || again || detailsOpen) detailsOpen = true;
		},
		drop(lo, hi, touch) {
			cal.focus = lo;
			cal.anchor = lo;
			if (!touch) detailsOpen = true;
			if (cal.mode === 'select') select(lo, hi);
			else void apply(cal.mode, lo, hi);
		},
		open(day) {
			cal.focus = day;
			select(day, day);
			detailsOpen = true;
		},
		announce,
	});

	// --- Keyboard
	function onkey(e: KeyboardEvent): void {
		const cell = (e.target as Element).closest<HTMLElement>('[data-day]');
		if (!cell || (e.target as Element).closest('[data-milestone]')) return;
		const day = Number(cell.dataset['day']);
		const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
		const target = selected ?? ([day, day] as const);
		if (plain && !e.shiftKey && (e.key === 'l' || e.key === 'L')) {
			e.preventDefault();
			picker = { lo: target[0], hi: target[1] };
			return;
		}
		if (plain && (e.key === 'Delete' || e.key === 'Backspace')) {
			e.preventDefault();
			void apply('erase', target[0], target[1]);
			return;
		}
		if (plain && (e.key === 'Enter' || e.key === ' ')) {
			e.preventDefault();
			if (!selected || day < selected[0] || day > selected[1]) select(day, day);
			detailsOpen = true;
			void tick().then(() => details?.focus());
			return;
		}
		if (e.key === 'Escape' && detailsOpen) {
			e.stopPropagation();
			closeDetails();
			return;
		}
		const next = moveDay(grid, day, e, todayDay);
		if (next === null) return;
		e.preventDefault();
		const anchor = e.shiftKey ? (cal.anchor ?? day) : next;
		cal.anchor = anchor;
		select(Math.min(anchor, next), Math.max(anchor, next));
		void focusDay(next);
	}

	function closeDetails(): void {
		const inside = !!document.activeElement?.closest('[data-testid="cal-details"]');
		detailsOpen = false;
		if (inside && cal.focus !== null) void focusDay(cal.focus);
	}

	function pickType(t: LeaveType): void {
		const p = picker;
		picker = null;
		cal.leaveType = t;
		if (p) void apply('paint', p.lo, p.hi);
		if (cal.focus !== null) void focusDay(cal.focus);
	}
	function cancelPicker(): void {
		picker = null;
		if (cal.focus !== null) void focusDay(cal.focus);
	}

	// --- Scope: a person selected elsewhere shows their leave; the picker changes it
	$effect(() => {
		const p = app.selection.person;
		untrack(() => {
			if (p !== null && !(cal.scope.kind === 'resource' && cal.scope.resource === p)) {
				cal.setScope({ kind: 'resource', resource: p });
			}
		});
	});
	function setScope(scope: PaintScope): void {
		cal.setScope(scope);
		// The days stay selected, now for this scope.
		if (sel?.kind === 'days') app.selection.selectDays(scope, sel.from, sel.to);
	}

	// A new plan: forget what is open and where the list was. (The state outlives the view.)
	let placedFor: 'list' | 'month' | null = null;
	$effect(() => {
		const id = app.sampleId;
		untrack(() => {
			if (cal.plan === id) return;
			cal.plan = id;
			detailsOpen = false;
			picker = null;
			note = '';
			cal.focus = null;
			cal.anchor = null;
			cal.month = -1;
			cal.scrollTop = 0;
			placedFor = null;
		});
	});

	// Where the list starts: the month of today, or the first, until the user has moved; and again
	// when the layout changes between the list and one month.
	$effect(() => {
		if (nMonths === 0) return;
		const layout = listMode ? 'list' : 'month';
		if (placedFor === layout) return;
		if (listMode && (!scroller || monthH <= 0)) return;
		placedFor = layout;
		untrack(() => {
			if (cal.month < 0 || cal.month >= nMonths) {
				cal.month = todayDay !== null ? grid.monthOf(todayDay) : 0;
			}
			if (listMode && scroller) {
				scroller.scrollTop = cal.scrollTop > 0 ? cal.scrollTop : offsetOfMonth(cal.month, monthH);
				scrollTop = scroller.scrollTop;
			}
		});
	});

	// The details sheet covers the foot: bring the selected day above it (WCAG 2.4.11).
	$effect(() => {
		if (!detailed || sheetH <= 0) return;
		const lo = untrack(() => selected?.[0]);
		if (lo === undefined) return;
		void tick().then(() =>
			root?.querySelector<HTMLElement>(`[data-day="${lo}"]`)?.scrollIntoView({ block: 'nearest' }),
		);
	});

	function onscroll(): void {
		if (!scroller) return;
		scrollTop = scroller.scrollTop;
		cal.scrollTop = scrollTop;
		// In a list the month at the top is the month in view; one month has nothing to follow.
		if (listMode) cal.month = visibleMonths(scrollTop, listH, monthH, nMonths)[0];
		gestures.scrolled();
	}

	onMount(() => (scroller ? gestures.attach(scroller) : () => undefined));
	onMount(() => () => gestures.dispose());

	const pickTarget = $derived(
		picker ? `${L.type[cal.leaveType]}: ${who}, ${rangeLabel(grid, picker.lo, picker.hi)}` : '',
	);
	const addTypes = $derived(typesFor(cal.scope.kind === 'global'));
</script>

<div
	class="calendar"
	class:dimmed
	class:phone
	bind:this={root}
	bind:clientWidth={rootW}
	role="region"
	tabindex="-1"
	aria-label={C.region}
	data-testid="calendar"
	data-mode={cal.mode}
	data-layout={listMode ? 'list' : 'month'}
	style:--sheet-h="{detailed ? sheetH : 0}px"
>
	<span class="probes" aria-hidden="true"><i bind:clientHeight={monthH}></i></span>
	{#if !phone}
		<CalendarBar
			placement="top"
			scope={cal.scope}
			{people}
			mode={cal.mode}
			leaveType={cal.leaveType}
			title={shownTitle}
			hasToday={todayDay !== null}
			onscope={setScope}
			onmode={setMode}
			ontype={(t) => (cal.leaveType = t)}
			onprev={() => goMonth(topMonth - 1)}
			onnext={() => goMonth(topMonth + 1)}
			ontoday={goToday}
			hint={C.modeHint[cal.mode]}
		/>
	{/if}
	<div class="main">
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="scroller"
			bind:this={scroller}
			bind:clientHeight={listH}
			{onscroll}
			onkeydown={onkey}
			onfocusin={(e) => {
				const d = (e.target as Element).closest<HTMLElement>('[data-day]')?.dataset['day'];
				if (d === undefined) return;
				// Focus that did not come from our own keys starts a new selection run.
				if (cal.focus !== Number(d)) cal.anchor = Number(d);
				cal.focus = Number(d);
			}}
			role="presentation"
			data-testid="cal-scroller"
		>
			{#if nMonths === 0 || !facts}
				<p class="scheduling" role="status" data-testid="cal-scheduling">
					<Mark size={44} busy />{C.scheduling}
				</p>
			{:else if listMode}
				<div class="space" style:block-size="{nMonths * monthH}px">
					{#each mounted as i (i)}
						{@const m = grid.months[i]}
						{#if m}
							<MonthView
								{grid}
								month={m}
								{facts}
								{selected}
								{tabDay}
								today={todayDay}
								top={i * monthH}
								onmilestone={openMilestone}
							/>
						{/if}
					{/each}
				</div>
			{:else}
				{@const m = grid.months[topMonth]}
				{#if m}
					<MonthView
						{grid}
						month={m}
						{facts}
						{selected}
						{tabDay}
						today={todayDay}
						onmilestone={openMilestone}
					/>
				{/if}
			{/if}
			<div class="inset" aria-hidden="true"></div>
		</div>
		{#if detailed}
			<div class="sheet" bind:clientHeight={sheetH}>
				<DayDetails
					bind:this={details}
					details={detailed}
					{rangeText}
					{who}
					global={cal.scope.kind === 'global'}
					types={addTypes}
					leaveType={cal.leaveType}
					ontype={(t) => (cal.leaveType = t)}
					fieldsOf={(item) => (project ? itemFields(item, project, zones) : null)}
					oncommit={commitLeave}
					onremove={removeLeave}
					onadd={(name) => selected && apply('paint', selected[0], selected[1], name)}
					onclear={() => selected && apply('erase', selected[0], selected[1])}
					onmilestone={(task) => {
						app.selection.selectTask(task, 'visual');
						showGantt();
					}}
					onclose={closeDetails}
					{note}
				/>
			</div>
		{/if}
		{#if picker}
			<div class="pickwrap">
				<TypePicker
					types={addTypes}
					current={cal.leaveType}
					target={pickTarget}
					onpick={pickType}
					oncancel={cancelPicker}
				/>
			</div>
		{/if}
	</div>
	<p class="line" role="status" data-testid="cal-line">{lineText}</p>
	{#if dimmed}<p class="stale">{C.lastGood}</p>{/if}
	{#if phone}
		<CalendarBar
			placement="bottom"
			scope={cal.scope}
			{people}
			mode={cal.mode}
			leaveType={cal.leaveType}
			title={shownTitle}
			hasToday={todayDay !== null}
			onscope={setScope}
			onmode={setMode}
			ontype={(t) => (cal.leaveType = t)}
			onprev={() => goMonth(topMonth - 1)}
			onnext={() => goMonth(topMonth + 1)}
			ontoday={goToday}
			hint={C.modeHint[cal.mode]}
		/>
	{/if}
	<p class="sr-only" role="status" aria-live="polite" data-testid="cal-live">{liveText}</p>
</div>

<style>
	.calendar {
		container: calendar / inline-size;
		position: relative;
		display: flex;
		flex-direction: column;
		block-size: 100%;
		min-block-size: 0;
		background: var(--color-gantt-surface);
	}
	.calendar:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: -3px;
	}
	.main {
		position: relative;
		flex: 1 1 0;
		min-block-size: 0;
		display: flex;
	}
	/* The one scroll container: the list scrolls, never chaining to the page. */
	.scroller {
		position: relative;
		flex: 1 1 0;
		min-inline-size: 0;
		min-block-size: 0;
		overflow: auto;
		overscroll-behavior: none;
		-webkit-overflow-scrolling: touch;
		/* One finger scrolls natively; a press that holds becomes the painting drag. */
		touch-action: pan-x pan-y;
		scroll-padding-block-end: var(--sheet-h);
		-webkit-touch-callout: none;
		user-select: none;
		-webkit-user-select: none;
	}
	.calendar[data-mode='paint'] .scroller,
	.calendar[data-mode='erase'] .scroller {
		cursor: cell;
	}
	.calendar.dimmed .space,
	.calendar.dimmed .scroller > :global(.month) {
		opacity: var(--gantt-dim-opacity);
	}
	.space {
		position: relative;
	}
	.probes {
		position: absolute;
		visibility: hidden;
		pointer-events: none;
	}
	.probes i {
		display: block;
		inline-size: 0;
		block-size: var(--cal-month-h);
	}
	.scheduling {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		margin: 0;
		padding: var(--space-8) var(--gutter);
		color: var(--color-gantt-text-muted);
	}
	.line {
		flex: none;
		margin: 0;
		padding: var(--space-1) var(--gutter);
		border-block-start: 1px solid var(--color-gantt-border);
		color: var(--color-gantt-text-muted);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}
	.stale {
		margin: 0;
		padding: 0 var(--gutter) var(--space-1);
		color: var(--color-gantt-text-muted);
		font-size: var(--text-xs);
	}
	.inset {
		display: none;
	}
	.sheet {
		display: flex;
		flex-direction: column;
		min-block-size: 0;
	}
	.sheet :global(.details) {
		flex: 1 1 auto;
	}
	.pickwrap {
		position: absolute;
		z-index: 14;
		inset-inline: 0;
		inset-block-end: var(--space-3);
		display: flex;
		justify-content: center;
		pointer-events: none;
	}
	.pickwrap :global(.picker) {
		pointer-events: auto;
	}
	/* Wide: the details are a column beside the months. Narrower: a bottom sheet over their foot. */
	@container calendar (min-width: 760px) {
		.sheet {
			flex: none;
			inline-size: 24rem;
		}
	}
	@container calendar (max-width: 759px) {
		.sheet {
			position: absolute;
			z-index: 12;
			inset-inline: 0;
			inset-block-end: 0;
			max-block-size: 70%;
			border-start-start-radius: var(--radius-sheet);
			border-start-end-radius: var(--radius-sheet);
			box-shadow: var(--shadow-raised);
			background: var(--color-surface);
			overflow: hidden;
		}
		.sheet :global(.details) {
			border-inline-start: 0;
			max-block-size: 100%;
		}
		/* Room to scroll the last rows above the sheet (WCAG 2.4.11). */
		.inset {
			display: block;
			block-size: var(--sheet-h);
		}
	}
	.sr-only {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
