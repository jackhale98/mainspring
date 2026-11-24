<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The Calendar view (phase-3.md 9.5, 7.1 W3 to W5, 10, 22; T16): holidays, a person's leaves,
	non-working days and milestones by month, and leave painting. One month is in the DOM at a time.
	A desktop (the view is 1000 px wide and 440 px tall or more) fills the view with it: the weeks
	share the height, so a day is tall and shows as many chips as fit, then "+N more"; Previous,
	Next, Today, Page Up and Page Down and a wheel gesture change the month. A tablet and a phone
	show the month at a fixed row height, with the same buttons.

	The calendar never changes the schedule or the text. It reads the newest good result and the
	symbol index (lib/calendar/facts.ts) and sends intents: a stroke of Paint or Erase (a drag, or a
	tap on a day), the type picker's Enter, Delete, and the details' fields become a `LeavePaint`
	for T12's planner or a `leaveEditPlan` for the edit API, planned by the dispatcher on the text now
	(ADR-0018), through run.ts. So each
	is one undo step with a toast, and a resource in a shared `.tji` asks first. While a newer
	schedule runs the days dim.

	- Pointer: gestures (calendar-gestures.svelte.ts, the shared machine): a click or tap selects
	  (a click and a second tap open the details), a drag covers a run of days, a touch long-press
	  lifts a day first. Paint and Erase apply the drop.
	- Keyboard: the grid pattern on days (lib/calendar/nav.ts). Selection follows focus; Shift with
	  the arrows extends it, also past the month's edge: the next month is shown and it goes on. L opens the type picker (Enter adds that leave), Delete clears the leave
	  on the selected days, Enter opens the details, Escape closes the picker or the details.
	- Selection is the app's (`app.selection`, kind `days`), so a person's details can follow it.
	- The days' details are a column beside the month when the view is 760 px wide or more. On a
	  phone and a tablet narrower than that they are the shared bottom Sheet that the task details
	  use: non-modal, half and full height, over the toolbar rows and the tab bar (close it to change
	  the mode, the person or the month; the mode in force shows in its header). The month keeps its
	  place and scrolls only as far as the selected day needs to stay above the Sheet. A desktop never
	  uses the Sheet: in a pane narrower than 760 px (a docked person's details beside it) the
	  details are a panel over the month's foot.

	Over 400 lines on purpose: this one component owns the month, the selection, the focus and the
	dispatch, which only work together (as Workload.svelte does); the rules are in lib/calendar.
-->
<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { createTimeZoneHost } from '../../engine/timezone';
	import { detailsOf } from '../../lib/calendar/details';
	import {
		monthTitle,
		monthTitleShort,
		rangeLabel,
		dateLabel,
		typeName,
	} from '../../lib/calendar/describe';
	import { prepareFacts } from '../../lib/calendar/facts';
	import { buildGrid } from '../../lib/calendar/grid';
	import {
		itemFields,
		typesFor,
		type CommitResult,
		type LeaveFields,
	} from '../../lib/calendar/leave-edit';
	import { moveDay } from '../../lib/calendar/nav';
	import { RovingGrid } from '../../lib/ui/roving-grid';
	import type { LeavePaint, PaintScope } from '../../lib/calendar/paint';
	import { runLeaveEdit, runLeaveRemove, runStroke } from '../../lib/calendar/run';
	import { createWheelPager, wheelPx } from '../../lib/calendar/wheel';
	import type { AppState } from '../../lib/state/app.svelte';
	import { calendarStrings as C, leavePaintStrings as L } from '../../lib/strings-calendar';
	import type { LeaveRef, LeaveType } from '../../lib/tjp/edit/types';
	import Mark from '../app/Mark.svelte';
	import CalendarBar from './CalendarBar.svelte';
	import { sameScope, type CalendarMode, type CalendarState } from './calendar-state.svelte';
	import { CalendarGestures } from './calendar-gestures.svelte';
	import DayDetails from './DayDetails.svelte';
	import MonthView from './MonthView.svelte';
	import TypePicker from './TypePicker.svelte';
	import Sheet from '../Sheet.svelte';
	import type { Detent } from '../../lib/inspector/detent';
	import type { SelectionDetails } from '../../lib/calendar/details';

	interface Props {
		app: AppState;
		/** A phone: the bar is above the tab bar, and there is one month. */
		phone: boolean;
		/** The desktop layout: the details stay a column or a panel in the view, never the bottom Sheet. */
		desktop?: boolean;
		state: CalendarState;
		/** Goes to the Gantt (the details' "Show in Gantt"). */
		showGantt: () => void;
	}
	let { app, phone, desktop = false, state: cal, showGantt }: Props = $props();

	const zones = createTimeZoneHost();
	let root: HTMLDivElement | undefined = $state();
	let scroller: HTMLDivElement | undefined = $state();
	let details: DayDetails | undefined = $state();
	let rootW = $state(0);
	let rootH = $state(0);
	/**
	 * A phone, or a tablet narrower than 760 px: the days' details are the shared bottom Sheet (as the
	 * task details are). A desktop keeps them in the view: a column beside the month, and, in a pane
	 * narrower than 760 px (a docked person's details beside it), a panel over the month's foot.
	 */
	const sheetMode = $derived(phone || (!desktop && rootW > 0 && rootW < 760));
	let detent = $state<Detent>('half');
	/** How far the Sheet reaches up from the viewport's bottom, in px (kept until it has left). */
	let reach = $state(0);
	/** How much of the month's box the Sheet covers, in px: the room the month keeps to scroll above it. */
	let cover = $state(0);
	/** The in-pane panel's height (a desktop's narrow pane), px: the room the month keeps above it. */
	let panelH = $state(0);
	/** What the Sheet shows while it slides away, after the selection has gone. */
	let held = $state.raw<{ details: SelectionDetails; range: string } | null>(null);
	let detailsOpen = $state(false);
	let picker = $state.raw<{ lo: number; hi: number } | null>(null);
	let note = $state('');
	/** A pointer press is in this task: the focus it causes is not a keyboard's. */
	let pressing = false;
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

	// A desktop's month fills the view; a view too short for rows with room for chips (a landscape
	// tablet) keeps the fixed rows and scrolls.
	const fill = $derived(!phone && rootW >= 1000 && rootH >= 440);
	const nMonths = $derived(grid.months.length);
	const todayDay = $derived.by(() => {
		if (!project) return null;
		const d = grid.dayAt(Math.round((now - Date.parse(project.start)) / 60_000));
		return d < 0 ? null : d;
	});

	// The month in view.
	const topMonth = $derived(Math.max(0, Math.min(nMonths - 1, cal.month)));
	const shownTitle = $derived.by(() => {
		const m = grid.months[topMonth];
		return m ? monthTitle(m.year, m.month) : '';
	});
	const shortTitle = $derived.by(() => {
		const m = grid.months[topMonth];
		return m ? monthTitleShort(m.year, m.month) : '';
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
			// The tab stop must be in the month on screen.
			if (grid.monthOf(want) === topMonth) return want;
		}
		return firstOfMonth(topMonth);
	});

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
	const confirm = (m: string): boolean => globalThis.confirm(m);

	async function apply(op: 'paint' | 'erase', lo: number, hi: number, name = ''): Promise<void> {
		const a = grid.days[lo];
		const b = grid.days[hi];
		if (!a || !b) return;
		select(lo, hi);
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
		const r = await runStroke(app.edits, stroke, result, zones, confirm);
		note = r.status === 'refused' ? r.message : '';
	}

	// A leave card's commit and Remove go out at once on the item's range and the index version it
	// was read in; the dispatcher finds the item in the text now (ADR-0018), however far the index lags.
	const commitLeave = (ref: LeaveRef, f: LeaveFields): Promise<CommitResult> =>
		runLeaveEdit(app.edits, ref, f, project ? { project, zones } : null, confirm);
	const removeLeave = (ref: LeaveRef): Promise<void> =>
		runLeaveRemove(app.edits, ref, project ? { project } : null, confirm);

	/** "+N more" on a day: select it and open its details, with the focus there (as Enter does). */
	function openMore(day: number): void {
		cal.focus = day;
		cal.anchor = day;
		select(day, day);
		detailsOpen = true;
		void tick().then(() => details?.focus());
	}

	function openMilestone(task: string): void {
		app.selection.selectTask(task, 'visual');
		announce(C.selectedTask(result?.tasks.find((t) => t.id === task)?.name ?? task));
	}

	// --- Focus and moving between months
	// A rebuild of the month (the facts changing, a resize) replaces the day that has the focus: it
	// goes back to the day (lib/ui/roving-grid.ts), unless the person moved it elsewhere.
	const roving = new RovingGrid<number>({
		root: () => scroller,
		keyOf: (t) => {
			const d =
				t instanceof Element ? t.closest<HTMLElement>('[data-day]')?.dataset['day'] : undefined;
			return d === undefined ? null : Number(d);
		},
		find: (r, d) => r.querySelector<HTMLElement>(`[data-day="${d}"]`),
	});
	$effect(() => {
		void grid;
		void topMonth;
		const f = untrack(() => cal.focus);
		if (f === null || f === undefined) return;
		void tick().then(() => roving.restore(f));
	});
	async function focusDay(i: number): Promise<void> {
		cal.focus = i;
		cal.month = grid.monthOf(i);
		await tick();
		root?.querySelector<HTMLElement>(`[data-day="${i}"]`)?.focus({ preventScroll: true });
	}

	function goMonth(m: number): void {
		cal.month = Math.max(0, Math.min(nMonths - 1, m));
	}
	function goToday(): void {
		if (todayDay !== null) goMonth(grid.monthOf(todayDay));
	}

	// --- Pointer
	const gestures = new CalendarGestures({
		mode: () => cal.mode,
		scroller: () => scroller,
		covered: (): number => (sheetMode && detailed ? cover : 0),
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
		if (!cell || (e.target as Element).closest('[data-milestone], [data-more]')) return;
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

	function setScope(scope: PaintScope): void {
		cal.setScope(scope);
		// The days stay selected, now for this scope.
		if (sel?.kind === 'days') app.selection.selectDays(scope, sel.from, sel.to);
	}

	// A new plan: forget what is open and the month it was on. (The state outlives the view.)
	$effect(() => {
		const id = app.openSerial;
		untrack(() => {
			if (cal.plan === id) return;
			cal.plan = id;
			// The people of another plan are not these: start on Everyone.
			cal.seenPerson = null;
			cal.setScope({ kind: 'global' });
			detailsOpen = false;
			picker = null;
			note = '';
			cal.focus = null;
			cal.anchor = null;
			cal.month = -1;
		});
	});

	// --- Scope: a person selected elsewhere shows their leave; the picker changes it. Only a
	// selection that changed since the calendar last saw one counts, so coming back to the view
	// (a remount) keeps the scope the user picked, "Everyone" included.
	$effect(() => {
		const p = app.selection.person;
		untrack(() => {
			if (p === cal.seenPerson) return;
			cal.seenPerson = p;
			if (p !== null && !(cal.scope.kind === 'resource' && cal.scope.resource === p)) {
				cal.setScope({ kind: 'resource', resource: p });
			}
		});
	});

	// The month to start on: today's, or the first, until the user has moved.
	$effect(() => {
		if (nMonths === 0 || (cal.month >= 0 && cal.month < nMonths)) return;
		untrack(() => (cal.month = todayDay !== null ? grid.monthOf(todayDay) : 0));
	});

	// The Sheet's content while it goes: the selection may be cleared by then.
	const live = $derived(detailed ? { details: detailed, range: rangeText } : null);
	$effect(() => {
		if (live) held = live;
	});
	const shown = $derived(live ?? held);

	// The Sheet covers the foot of the month: the month keeps its place, and scrolls only when the
	// selected day would be under the Sheet (WCAG 2.4.11), as the sheet opens, grows or the selection
	// moves. The room to scroll the last rows above it is `cover`. A month that is nearly all under
	// the Sheet (full height) is left where it is: that is the height the person asked for.
	$effect(() => {
		const el = scroller;
		const h = reach;
		void rootH;
		void rootW;
		const from = sel?.kind === 'days' ? sel.from : null;
		if (!el || h <= 0 || !sheetMode) return;
		const covered = Math.max(
			0,
			Math.round(el.getBoundingClientRect().bottom - (window.innerHeight - h)),
		);
		cover = covered;
		const lo = from === null ? -1 : untrack(() => grid.dayAt(Math.max(0, from)));
		if (lo < 0 || el.clientHeight - covered < 56) return;
		const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
		void tick().then(() =>
			root
				?.querySelector<HTMLElement>(`[data-day="${lo}"]`)
				?.scrollIntoView({ block: 'nearest', behavior: calm ? 'instant' : 'smooth' }),
		);
	});

	// A panel over the foot of a narrow desktop pane: bring the selected day above it (WCAG 2.4.11).
	$effect(() => {
		if (sheetMode || !detailed || panelH <= 0) return;
		const lo = untrack(() => selected?.[0]);
		if (lo === undefined) return;
		void tick().then(() =>
			root?.querySelector<HTMLElement>(`[data-day="${lo}"]`)?.scrollIntoView({ block: 'nearest' }),
		);
	});

	function onscroll(): void {
		gestures.scrolled();
	}

	// A wheel or a trackpad swipe over the month that fills the view turns the month, once per
	// gesture (lib/calendar/wheel.ts). Nothing scrolls there, so the event is the page's to ignore.
	const pager = createWheelPager();
	$effect(() => {
		const el = scroller;
		if (!el || !fill) return;
		const onwheel = (e: WheelEvent): void => {
			if (e.ctrlKey || e.metaKey || gestures.drag || Math.abs(e.deltaX) > Math.abs(e.deltaY))
				return;
			const step = pager.push(wheelPx(e.deltaY, e.deltaMode), e.timeStamp);
			if (step === 0) return;
			const was = topMonth;
			const held = document.activeElement?.closest<HTMLElement>('[data-day]');
			goMonth(was + step);
			// Focus in the grid goes with the month, to the same date, as Page Up and Page Down do.
			if (held && el.contains(held) && topMonth !== was) {
				const to = moveDay(
					grid,
					Number(held.dataset['day']),
					{ key: step < 0 ? 'PageUp' : 'PageDown', ctrlKey: false, metaKey: false, altKey: false },
					null,
				);
				if (to !== null) void focusDay(to);
			}
		};
		el.addEventListener('wheel', onwheel, { passive: true });
		return () => el.removeEventListener('wheel', onwheel);
	});

	onMount(() => (scroller ? gestures.attach(scroller) : () => undefined));
	onMount(() => () => gestures.dispose());

	const pickTarget = $derived(
		picker ? `${L.type[cal.leaveType]}: ${who}, ${rangeLabel(grid, picker.lo, picker.hi)}` : '',
	);
	const addTypes = $derived(typesFor(cal.scope.kind === 'global'));
</script>

{#snippet dayDetails(d: SelectionDetails, range: string, inSheet: boolean)}
	<DayDetails
		bind:this={details}
		details={d}
		rangeText={range}
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
		sheet={inSheet}
	/>
{/snippet}

{#snippet modeChip()}
	{#if cal.mode !== 'select'}
		<span class="modechip" data-testid="cal-mode-chip">
			{C.painting(C.modes[cal.mode], typeName(cal.leaveType))}
		</span>
	{/if}
{/snippet}

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
	bind:clientHeight={rootH}
	data-layout={fill ? 'fill' : 'month'}
	style:--sheet-h="{sheetMode ? cover : detailed ? panelH : 0}px"
>
	{#if !phone}
		<CalendarBar
			placement="top"
			scope={cal.scope}
			{people}
			mode={cal.mode}
			leaveType={cal.leaveType}
			title={shownTitle}
			{shortTitle}
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
			{onscroll}
			onkeydown={onkey}
			onpointerdowncapture={() => {
				// The press focuses its day in this same task, before the gesture says what it was.
				pressing = true;
				setTimeout(() => (pressing = false), 0);
			}}
			onfocusout={(e) => void roving.focusout(e)}
			onfocusin={(e) => {
				roving.focusin(e);
				const d = (e.target as Element).closest<HTMLElement>('[data-day]')?.dataset['day'];
				if (d === undefined) return;
				// Focus that did not come from our own keys starts a new selection run. A press's focus
				// does not: the click or the drag that follows sets the anchor (a Shift-click extends it).
				if (cal.focus !== Number(d) && !pressing) cal.anchor = Number(d);
				cal.focus = Number(d);
			}}
			role="presentation"
			data-testid="cal-scroller"
		>
			{#if nMonths === 0 || !facts}
				<p class="scheduling" role="status" data-testid="cal-scheduling">
					<Mark size={44} busy />{C.scheduling}
				</p>
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
						{fill}
						onmilestone={openMilestone}
						onmore={openMore}
					/>
				{/if}
			{/if}
			<div class="inset" aria-hidden="true"></div>
		</div>
		{#if detailed && !sheetMode}
			<div class="sheet" bind:clientHeight={panelH}>
				{@render dayDetails(detailed, rangeText, false)}
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
			{shortTitle}
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

<!-- Narrow: the days' details are the shared bottom Sheet, not modal, so the month stays in reach. -->
{#if sheetMode}
	<Sheet
		open={detailed !== null}
		side="bottom"
		modal={false}
		focusOnOpen={false}
		title={shown?.range ?? ''}
		closeLabel={C.details.close}
		actions={modeChip}
		{detent}
		ondetent={(d) => (detent = d)}
		onheight={(h) => {
			if (h > 0) reach = h;
		}}
		onreturn={() => {
			if (cal.focus === null) return false;
			void focusDay(cal.focus);
			return true;
		}}
		onleft={() => {
			held = null;
			reach = 0;
			cover = 0;
		}}
		onclose={closeDetails}
	>
		{#if shown}{@render dayDetails(shown.details, shown.range, true)}{/if}
	</Sheet>
{/if}

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
	/* The month's box. A month with fixed rows (a tablet, a phone) scrolls in it, never chaining to the page. */
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
	/* The month that fills the view has nothing to scroll: its weeks share the height. */
	.calendar[data-layout='fill'] .scroller {
		overflow: hidden;
	}
	.calendar.dimmed .scroller > :global(.month) {
		opacity: var(--gantt-dim-opacity);
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
	/*
	   The details of a desktop: a column beside the months, and in a pane narrower than 760 px a panel
	   over their foot. A phone and a tablet use the shared bottom Sheet instead (outside this box).
	   The inset is the room to scroll the last rows above the Sheet or the panel (WCAG 2.4.11).
	*/
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
		.inset {
			display: block;
			block-size: var(--sheet-h);
		}
	}
	/* The mode in force while the Sheet covers the toolbar: a drag on the month above it paints or erases. */
	.modechip {
		padding: 2px var(--space-3);
		border-radius: var(--radius-pill);
		background: var(--color-brass-wash);
		color: var(--color-brass-ink);
		font-size: var(--text-xs);
		font-weight: 600;
		white-space: nowrap;
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
