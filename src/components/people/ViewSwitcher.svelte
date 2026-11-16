<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The view switcher of the desktop and the tablet (phase-3.md 9.1, 18.10): Gantt, Workload,
	Resources and Calendar, a slim band above the chart (so that it covers no row) holding the tabs
	of SegmentTabs. Shown in Split and Visual mode, where there is a chart panel; Split puts the
	editor beside any of the views. A phone has no switcher: its tab bar has People.

	The panel it controls is `views-body` (App.svelte). The change is announced politely, once, as
	"Workload view" (the tab's own name is what a screen reader reads when the focus is on it; the
	announcement is for a change made by a key while the panel behind it swaps its content). The
	focus stays on the chosen tab, and a Tab goes into the new view's content.
-->
<script lang="ts">
	import type { IconName } from '../../lib/icons';
	import type { View } from '../../lib/state/selection.svelte';
	import { VIEWS } from '../../lib/workload/prefs';
	import { strings } from '../../lib/strings';
	import SegmentTabs from './SegmentTabs.svelte';

	interface Props {
		view: View;
		onchange: (view: View) => void;
	}
	let { view, onchange }: Props = $props();

	const S = strings.people;
	const ICON: Record<View, IconName> = {
		gantt: 'visual',
		workload: 'grid',
		resources: 'rows',
		calendar: 'calendar',
	};
	const ITEMS = VIEWS.map((id) => ({ id, label: S.view[id], icon: ICON[id] }));

	/** The announcement; empty until the person changes the view, so that opening says nothing. */
	let said = $state('');
	function choose(next: View): void {
		if (next === view) return;
		said = S.viewShown(S.view[next]);
		onchange(next);
	}
</script>

<div class="bar" data-testid="view-switcher">
	<SegmentTabs
		items={ITEMS}
		value={view}
		onchange={choose}
		label={S.switcher}
		prefix="view-tab"
		controls="views-body"
	/>
	<p class="sr-only" role="status" aria-live="polite">{said}</p>
</div>

<style>
	/* The band is the Gantt's own (same surface and rule), so that the chart's toolbar under it
	   reads as one header. `views` is the container the narrow-bar rule of SegmentTabs measures. */
	.bar {
		flex: none;
		container: views / inline-size;
		display: flex;
		align-items: center;
		min-inline-size: 0;
		padding: 6px 14px;
		border-block-end: 1px solid var(--color-gantt-border);
		background: var(--color-gantt-surface);
	}
</style>
