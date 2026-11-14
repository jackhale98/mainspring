<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The plan's combined state as a shape, not only a colour (WCAG 1.4.1): the brand mark ticking
	while the scheduler starts or works, a green circle when scheduled with no problems, an amber
	triangle with warnings only, a ruby diamond when the plan does not schedule or the scheduler
	failed. Decorative: the words are on the control that carries it (`statusGlyph`, lib/state/status.ts).
-->
<script lang="ts">
	import type { StatusGlyph } from '../../lib/state/status';
	import Mark from './Mark.svelte';

	interface Props {
		kind: StatusGlyph;
		size?: number;
	}
	let { kind, size = 20 }: Props = $props();
</script>

{#if kind === 'busy'}
	<Mark {size} busy />
{:else}
	<svg
		class="glyph {kind}"
		width={size}
		height={size}
		viewBox="0 0 24 24"
		aria-hidden="true"
		focusable="false"
	>
		{#if kind === 'ok'}
			<circle class="halo" cx="12" cy="12" r="10.5" />
			<circle class="fill" cx="12" cy="12" r="6.5" />
		{:else if kind === 'warning'}
			<path class="halo" d="M12 2.5 22.5 20.5H1.5Z" />
			<path class="fill" d="M12 6 19 18H5Z" />
		{:else}
			<path class="halo" d="M12 1.5 22.5 12 12 22.5 1.5 12Z" />
			<path class="fill" d="M12 5.5 18.5 12 12 18.5 5.5 12Z" />
		{/if}
	</svg>
{/if}

<style>
	.glyph {
		flex: none;
		display: block;
		overflow: visible;
	}
	.fill {
		stroke-width: 2;
		stroke-linejoin: round;
	}
	.ok .fill {
		fill: var(--color-status-ok);
	}
	.ok .halo {
		fill: var(--color-status-ok-halo);
	}
	.warning .fill {
		fill: var(--color-diagnostic-warning);
		stroke: var(--color-diagnostic-warning);
	}
	.warning .halo {
		fill: color-mix(in srgb, var(--color-diagnostic-warning) 18%, transparent);
	}
	.error .fill {
		fill: var(--color-diagnostic-error);
		stroke: var(--color-diagnostic-error);
	}
	.error .halo {
		fill: var(--color-ruby-wash);
	}
</style>
