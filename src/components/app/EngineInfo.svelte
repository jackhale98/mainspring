<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The engine's version and the last run's timings in the status strip (phase-2.md 9.4, the Phase
	0 carry-over). The button reads "TaskJuggler 3.8.4 · Last run 182 ms" and opens a popover with
	every stage and the build's versions. Desktop and tablet only: a phone has no strip, and its
	top-bar status button opens the same details (EngineDetails) with the plan's status above them.
	The popover is the native kind (light dismiss, Escape, focus returns to the button), so it
	works by touch, where a tooltip would not.
-->
<script lang="ts">
	import type { EngineInfo } from '../../lib/state/status';
	import type { AppUpdates } from '../../lib/state/updates.svelte';
	import { strings } from '../../lib/strings';
	import DetailsPopover from './DetailsPopover.svelte';
	import EngineDetails from './EngineDetails.svelte';

	interface Props {
		info: EngineInfo;
		/** This app's build and whether a newer one is deployed (ADR-0012). */
		updates?: AppUpdates | undefined;
		onreload?: (() => void) | undefined;
	}
	let { info, updates, onreload }: Props = $props();
	const id = $props.id();
	const label = $derived(
		[info.version, info.last === null ? null : strings.status.lastRun(info.last)]
			.filter((p) => p !== null)
			.join(' · '),
	);
</script>

<button
	type="button"
	class="engine-info"
	popovertarget="engine-info-{id}"
	aria-label={`${strings.status.engineDetails}: ${label}`}
	title={strings.status.engineDetailsTitle}
	data-testid="engine-info"
>
	<span aria-hidden="true">{label}</span>
</button>
<DetailsPopover
	id="engine-info-{id}"
	title={strings.status.engineDetailsTitle}
	testid="engine-info-details"
>
	<EngineDetails {info} {updates} {onreload} />
</DetailsPopover>

<style>
	.engine-info {
		flex: none;
		margin-inline-start: auto;
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text-muted);
		font: inherit;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		white-space: nowrap;
		cursor: pointer;
		min-block-size: 1.75rem;
	}
	.engine-info:hover {
		background: var(--color-row-hover);
	}
	@media (pointer: coarse) {
		.engine-info {
			min-block-size: var(--size-tap);
		}
	}
</style>
