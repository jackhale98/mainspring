<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	Where the People views sit, and the door to their lazy chunk (phase-3.md 8.3, 9.1, 18.10). It is
	small on purpose: it holds only what must be on screen before the chunk is there (the view
	switcher's bar on a desktop and a tablet, the segmented control on a phone) and the loading and
	failure states. The views themselves, PeopleView.svelte (and what T14 to T17 import into it), are
	imported when this first mounts, so a Gantt-first load never fetches them.

	The owner mounts it when a People view first shows and then keeps it (hidden while another view
	shows), as it keeps the Gantt: a view's scroll and zoom survive a switch. The component of the
	chunk is also kept for later mounts.

	A chunk that cannot be loaded (offline with nothing cached, a deploy that replaced it) says so,
	with "Try again", which imports it once more. If that fails too (a browser may remember a failed
	import), the button becomes "Reload the page", asking first when the plan was edited, since a
	reload discards it.

	The content is the person's choice (`people`, remembered per plan). It is a tabpanel only on the
	phone, where the segments are tabs; the switcher of a toolbar is a radio group (SegmentTabs).
-->
<script lang="ts" module>
	import type { Component, Snippet } from 'svelte';
	import type { PeopleContent } from '../../lib/people/shell';
	import type { AppState } from '../../lib/state/app.svelte';

	type View = Component<{ app: AppState; content: PeopleContent }>;
	/** The chunk's component once loaded: a later mount shows it at once. */
	let loaded: View | null = null;
</script>

<script lang="ts">
	import { contentOfSegment, contentOfView } from '../../lib/people/shell';
	import type { PeopleViewState } from '../../lib/state/people-view.svelte';
	import type { PeopleSegment } from '../../lib/state/selection.svelte';
	import { SEGMENTS } from '../../lib/workload/prefs';
	import type { IconName } from '../../lib/icons';
	import { strings } from '../../lib/strings';
	import SegmentTabs from './SegmentTabs.svelte';
	import ViewBar from './ViewBar.svelte';

	interface Props {
		app: AppState;
		people: PeopleViewState;
		/** The phone's People tab: it has the segments; elsewhere a toolbar's switcher chooses the view. */
		phone: boolean;
		/** The view switcher, for the bar of a desktop and a tablet. */
		lead?: Snippet | undefined;
	}
	let { app, people, phone, lead }: Props = $props();

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

	let Chunk = $state.raw<View | null>(loaded);
	let failed = $state(0);
	let loading = false;

	function load(): void {
		if (loading || Chunk !== null) return;
		loading = true;
		import('./PeopleView.svelte').then(
			(m) => {
				loaded = m.default;
				Chunk = m.default;
				failed = 0;
				loading = false;
			},
			() => {
				failed++;
				loading = false;
			},
		);
	}
	$effect(load);

	function again(): void {
		if (failed >= 2) {
			if (app.dirty && !globalThis.confirm(strings.update.confirmReload)) return;
			location.reload();
			return;
		}
		load();
	}
</script>

<div class="people" data-testid="people-slot">
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
	{:else if lead}
		<ViewBar>{@render lead()}</ViewBar>
	{/if}
	<div
		id={phone ? 'segment-panel' : undefined}
		class="area"
		role={phone ? 'tabpanel' : undefined}
		aria-labelledby={phone ? `segment-tab-${people.segment}` : undefined}
	>
		{#if Chunk}
			<Chunk {app} {content} />
		{:else if failed > 0}
			<div class="message" role="alert" data-testid="people-failed">
				<p>{S.loadFailed}</p>
				<button type="button" onclick={again}>{failed >= 2 ? S.reload : S.retry}</button>
			</div>
		{:else}
			<p class="message" role="status" data-testid="people-loading">{S.loading}</p>
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
