<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The People views' frame and the door to their lazy chunk (phase-3.md 8.3, 9.1, 18.10). It is
	mounted only while a People view is on screen: a desktop or tablet view other than the Gantt (the
	switcher is ViewSwitcher.svelte, in the chart panel), or the phone's People tab, which has its
	own segmented control here (Load, Lanes, Calendar, Team). The first time it shows, it imports
	PeopleHost.svelte, so a Gantt-first load never fetches the chunk; the component is kept for
	later mounts. A chunk that cannot load (offline, with nothing cached) says so and offers a retry.

	The selected content is the person's choice (`people`, remembered per plan); the content area
	is a tabpanel only on the phone, where the segments are tabs (on a desktop the tabpanel is the
	chart panel's `views-body`).
-->
<script lang="ts" module>
	import type { Component } from 'svelte';
	import type { PeopleContent } from '../../lib/people/shell';
	import type { AppState } from '../../lib/state/app.svelte';

	type Host = Component<{ app: AppState; content: PeopleContent }>;
	/** The chunk's component once loaded: a later mount shows it at once. */
	let loaded: Host | null = null;
</script>

<script lang="ts">
	import { contentOfSegment, contentOfView } from '../../lib/people/shell';
	import type { PeopleViewState } from '../../lib/state/people-view.svelte';
	import type { PeopleSegment } from '../../lib/state/selection.svelte';
	import { SEGMENTS } from '../../lib/workload/prefs';
	import type { IconName } from '../../lib/icons';
	import { strings } from '../../lib/strings';
	import SegmentTabs from './SegmentTabs.svelte';

	interface Props {
		app: AppState;
		people: PeopleViewState;
		/** The phone's People tab: it has the segments; elsewhere the switcher chooses the view. */
		phone: boolean;
	}
	let { app, people, phone }: Props = $props();

	const S = strings.people;
	const ICON: Record<PeopleSegment, IconName> = {
		load: 'grid',
		lanes: 'rows',
		calendar: 'calendar',
		team: 'users',
	};
	const ITEMS = SEGMENTS.map((id) => ({ id, label: S.segment[id], icon: ICON[id] }));

	const content = $derived<PeopleContent>(
		phone ? contentOfSegment(people.segment) : (contentOfView(people.view) ?? 'workload'),
	);

	let Host = $state.raw<Host | null>(loaded);
	let failed = $state(false);
	let loading = false;

	function load(): void {
		if (loading || Host !== null) return;
		loading = true;
		failed = false;
		import('./PeopleHost.svelte').then(
			(m) => {
				loaded = m.default;
				Host = m.default;
				loading = false;
			},
			() => {
				failed = true;
				loading = false;
			},
		);
	}
	$effect(load);
</script>

<div class="people" data-phone={phone || undefined} data-testid="people-view">
	{#if phone}
		<div class="segments">
			<SegmentTabs
				items={ITEMS}
				value={people.segment}
				onchange={(s) => people.setSegment(s)}
				label={S.segments}
				prefix="segment-tab"
				controls="segment-panel"
				variant="block"
			/>
		</div>
	{/if}
	<div
		id={phone ? 'segment-panel' : undefined}
		class="area"
		role={phone ? 'tabpanel' : undefined}
		aria-labelledby={phone ? `segment-tab-${people.segment}` : undefined}
	>
		{#if Host}
			<Host {app} {content} />
		{:else if failed}
			<div class="message" role="alert">
				<p>{S.loadFailed}</p>
				<button
					type="button"
					onclick={() => {
						failed = false;
						load();
					}}>{S.retry}</button
				>
			</div>
		{:else}
			<p class="message" role="status">{S.loading}</p>
		{/if}
	</div>
</div>

<style>
	.people {
		display: flex;
		flex-direction: column;
		block-size: 100%;
		min-block-size: 0;
		background: var(--color-gantt-surface);
	}
	/* The phone's segmented control: a row above the content, in the gutter. */
	.segments {
		flex: none;
		padding: var(--space-2);
		border-block-end: 1px solid var(--color-gantt-border);
	}
	.area {
		flex: 1 1 0;
		min-block-size: 0;
	}
	.message {
		margin: 0;
		padding: var(--space-6) var(--gutter);
		color: var(--color-text-muted);
		text-align: center;
	}
	.message p {
		margin: 0 0 var(--space-3);
	}
	.message button {
		min-block-size: var(--size-control);
		padding-inline: var(--space-6);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		cursor: pointer;
	}
	.message button:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
</style>
