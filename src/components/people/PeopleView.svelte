<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The People views' shell inside the lazy chunk (phase-3.md 8.3, 23.1): PeopleSlot.svelte imports it
	when a People view first opens and keeps it. It is small on purpose: each view is a chunk of its
	own that it imports when that view first shows (LazyModule), so opening the heatmap does not fetch
	the calendar, and the shell itself stays a few KB (the cap of scripts/js-sizes.mjs).

	For each content (`workload`, `resources`, `calendar`, `team`) it shows the "No people" state
	when the plan declares no resource (lib/people/empty.ts), else the content: the workload heatmap
	(T14, components/workload) and the Resources view (T15 and T17: the table beside the lanes,
	components/resources), which stay mounted once seen so that their scroll, zoom and selection
	survive a switch to another view; the calendar (T16, components/calendar), which needs no people
	(Everyone's holidays), draws its own toolbar and keeps its month and mode in a state made here; and
	the phone's Team segment, the table alone (T17). While a view's chunk is on its way it says so, and
	a chunk that cannot be fetched says so with "Try again". After Add person the keyboard focus goes
	to the content, where the button was.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { peopleState } from '../../lib/people/empty';
	import type { PeopleContent } from '../../lib/people/shell';
	import type { AppState } from '../../lib/state/app.svelte';
	import { strings } from '../../lib/strings';
	import type { CalendarState } from '../calendar/calendar-state.svelte';
	import { LazyModule } from './lazy.svelte';
	import ViewFailed from './ViewFailed.svelte';
	import NoPeople from './NoPeople.svelte';

	interface Props {
		app: AppState;
		content: PeopleContent;
		/** The phone's People tab: the heatmap's toolbar is a row of the view, else the People bar's. */
		phone: boolean;
		/** The desktop layout (1024 px and wider). */
		desktop?: boolean;
		setBar: (bar: Snippet | null) => void;
		showGantt: () => void;
	}
	let { app, content, phone, desktop = false, setBar, showGantt }: Props = $props();

	const S = strings.people;
	const shown = $derived(
		peopleState(content, {
			indexed: app.index !== null,
			resources: app.outline.resources.length,
		}),
	);
	let host: HTMLDivElement | undefined = $state();
	let focusContent = $state(false);
	// Each view is a chunk of its own, fetched when it first opens (phase-3.md 8.3, 23.1).
	const heatmap = new LazyModule(() => import('../workload/Workload.svelte'));
	// The Resources view is the table beside the lanes, the phone's Lanes segment the lanes alone and
	// its Team segment the table alone: one component (ResourcesView), which fetches the lanes itself.
	const lanes = new LazyModule(() => import('../resources/ResourcesView.svelte'));
	const calendarView = new LazyModule(async () => ({
		...(await import('../calendar/Calendar.svelte')),
		...(await import('../calendar/calendar-state.svelte')),
	}));
	/** The calendar's month, mode and focus, kept while another view shows (made once the chunk is in). */
	let calendar = $state.raw<CalendarState | null>(null);
	$effect(() => {
		if (calendarView.module && calendar === null)
			calendar = new calendarView.module.CalendarState();
	});
	/** The heatmap and the lanes are mounted when first shown and then kept (scroll and zoom survive). */
	let heatmapSeen = $state(false);
	let lanesSeen = $state(false);
	$effect(() => {
		if (content === 'workload' && shown === 'content') heatmapSeen = true;
		if (content === 'resources' && shown === 'content') lanesSeen = true;
	});
	$effect(() => {
		if (heatmapSeen) heatmap.load();
	});
	$effect(() => {
		if (lanesSeen) lanes.load();
	});
	$effect(() => {
		if (content === 'calendar' && shown === 'content') calendarView.load();
	});
	$effect(() => {
		if (content === 'team' && shown === 'content') lanes.load();
	});
	/** The lazy module whose view is on screen now, for the loading and failure message. */
	const awaited = $derived(
		shown !== 'content'
			? null
			: content === 'workload'
				? heatmap
				: content === 'resources'
					? lanes
					: content === 'calendar'
						? calendarView
						: lanes,
	);
	/** Whose toolbar is in the People bar: a view takes its own out only when it is still the one. */
	let barOwner: PeopleContent | null = null;
	const barFor = (who: PeopleContent) => (bar: Snippet | null) => {
		if (bar) {
			barOwner = who;
			setBar(bar);
		} else if (barOwner === who) {
			barOwner = null;
			setBar(null);
		}
	};
	const heatBar = barFor('workload');
	const laneBar = barFor('resources');
	/** A content drawn on the canvas, which fills the area itself. */
	const drawn = $derived(
		(content === 'workload' && heatmapSeen) || (content === 'resources' && lanesSeen),
	);

	// The button that was pressed leaves with the state: the focus goes to what replaces it, once
	// the index has the new person (a keyboard user is not dropped on the page). The heatmap's is
	// its first cell, which exists once the schedule has been read into rows.
	$effect(() => {
		if (!focusContent || shown !== 'content') return;
		if (content === 'workload' || content === 'resources') {
			const kind = content === 'workload' ? 'heat' : 'lane';
			let frames = 0;
			const look = (): void => {
				const cell = host?.querySelector<HTMLElement>(`[data-testid="${kind}-cell"][tabindex="0"]`);
				if (cell) cell.focus({ preventScroll: true });
				else if (frames++ < 120) requestAnimationFrame(look);
				// No schedule to read yet (a plan with a person and no task): the view itself.
				else {
					host
						?.querySelector<HTMLElement>(
							`[data-testid="${content === 'workload' ? 'workload' : 'lanes'}"]`,
						)
						?.focus();
				}
			};
			focusContent = false;
			look();
			return;
		}
		// The Team segment: the table's row with the tab stop (the new person's, once the outline has it).
		if (content === 'team') {
			let frames = 0;
			const look = (): void => {
				const row = host?.querySelector<HTMLElement>('[data-testid="resource-row"][tabindex="0"]');
				if (row) row.focus({ preventScroll: true });
				else if (frames++ < 120) requestAnimationFrame(look);
			};
			focusContent = false;
			look();
		}
	});
</script>

<div
	class="host"
	class:flush={drawn || content === 'calendar' || content === 'team'}
	bind:this={host}
	data-testid="people-host"
	data-content={content}
	data-state={shown}
>
	{#if heatmapSeen && shown === 'content' && heatmap.module}
		{@const Workload = heatmap.module.default}
		<Workload {app} {phone} active={content === 'workload'} setBar={heatBar} />
	{/if}
	{#if lanesSeen && shown === 'content' && lanes.module}
		{@const Resources = lanes.module.default}
		<Resources {app} {phone} active={content === 'resources'} setBar={laneBar} />
	{/if}
	{#if awaited && !awaited.module}
		{#if awaited.failed}
			<ViewFailed lazy={awaited} dirty={app.dirty} />
		{:else}
			<p class="message" role="status" data-testid="people-view-loading">{S.loading}</p>
		{/if}
	{:else if shown === 'loading'}
		<p class="message" role="status">{strings.topBar.loading}</p>
	{:else if shown === 'none'}
		<NoPeople {app} ondone={() => (focusContent = true)} />
	{:else if content === 'calendar' && calendarView.module && calendar}
		{@const Calendar = calendarView.module.default}
		<Calendar {app} {phone} {desktop} state={calendar} {showGantt} />
	{:else if content === 'team' && lanes.module}
		{@const Team = lanes.module.default}
		<Team {app} {phone} team />
	{/if}
</div>

<style>
	.host {
		display: flex;
		flex-direction: column;
		justify-content: center;
		block-size: 100%;
		min-block-size: 0;
		overflow: auto;
		background: var(--color-gantt-surface);
	}
	/* The heatmap and the lanes fill the area themselves (they scroll inside), so the host does not centre or scroll. */
	.host.flush {
		justify-content: stretch;
		overflow: hidden;
	}
	.message {
		margin: 0;
		padding: var(--space-6) var(--gutter);
		color: var(--color-text-muted);
		text-align: center;
	}
	.message:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: -3px;
	}
</style>
