<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The People views' content, the entry of the lazy chunk (phase-3.md 8.3): everything the People
	views and the insight modules import hangs off this component, so a Gantt-first load never
	fetches it (PeopleSlot.svelte imports it when a People view first opens, and keeps it).

	For each content (`workload`, `resources`, `calendar`, `team`) it shows the "No people" state
	when the plan declares no resource (lib/people/empty.ts), else the content: the workload heatmap
	(T14, components/workload) and the Resources lanes (T15, components/resources), which stay
	mounted once seen so that their scroll, zoom and selection survive a switch to another view, and
	for the rest a short placeholder that T16 (calendar) and T17 (resource table, which the desktop
	puts beside the lanes) replace. After Add person the keyboard focus goes to the content, where
	the button was.
-->
<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { peopleState } from '../../lib/people/empty';
	import type { PeopleContent } from '../../lib/people/shell';
	import type { AppState } from '../../lib/state/app.svelte';
	import { strings } from '../../lib/strings';
	import Workload from '../workload/Workload.svelte';
	import Lanes from '../resources/Lanes.svelte';
	import NoPeople from './NoPeople.svelte';

	interface Props {
		app: AppState;
		content: PeopleContent;
		/** The phone's People tab: the heatmap's toolbar is a row of the view, else the People bar's. */
		phone: boolean;
		setBar: (bar: Snippet | null) => void;
		showGantt: () => void;
	}
	let { app, content, phone, setBar, showGantt }: Props = $props();

	const S = strings.people;
	const shown = $derived(
		peopleState(content, {
			indexed: app.index !== null,
			resources: app.outline.resources.length,
		}),
	);
	let coming: HTMLElement | undefined = $state();
	let host: HTMLDivElement | undefined = $state();
	let focusContent = $state(false);
	/** The heatmap and the lanes are mounted when first shown and then kept (scroll and zoom survive). */
	let heatmapSeen = $state(false);
	let lanesSeen = $state(false);
	$effect(() => {
		if (content === 'workload' && shown === 'content') heatmapSeen = true;
		if (content === 'resources' && shown === 'content') lanesSeen = true;
	});
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
		if (!coming) return;
		focusContent = false;
		void tick().then(() => coming?.focus());
	});
</script>

<div
	class="host"
	class:flush={drawn}
	bind:this={host}
	data-testid="people-host"
	data-content={content}
	data-state={shown}
>
	{#if heatmapSeen && shown === 'content'}
		<Workload {app} {phone} active={content === 'workload'} setBar={heatBar} {showGantt} />
	{/if}
	{#if lanesSeen && shown === 'content'}
		<Lanes {app} {phone} active={content === 'resources'} setBar={laneBar} {showGantt} />
	{/if}
	{#if shown === 'loading'}
		<p class="message" role="status">{strings.topBar.loading}</p>
	{:else if shown === 'none'}
		<NoPeople {app} ondone={() => (focusContent = true)} />
	{:else if content !== 'workload' && content !== 'resources'}
		<p class="message" data-testid="people-coming" tabindex="-1" bind:this={coming}>
			{S.coming[content]}
		</p>
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
