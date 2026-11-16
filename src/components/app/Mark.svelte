<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The brand mark (ADR-0009, "Mark change, 2026-11-16"; geometry in src/lib/brand/mark.ts): a navy
	ribbon that flows into a coil, like the end of a mainspring strip, with a brass arc beside each
	end. `size` is the height; the width follows the mark's aspect (35 x 26 px at 26).
	With `busy` it doubles as the loader and pulses gently (the ribbon-drawing loader follows).
	Decorative unless `label` is given (then it is an image with that name).
-->
<script lang="ts">
	import { MARK_ASPECT, VIEWBOX_H, VIEWBOX_W, markForm, markGeometry } from '../../lib/brand/mark';

	interface Props {
		size?: number;
		busy?: boolean;
		label?: string;
	}
	let { size = 28, busy = false, label }: Props = $props();

	const g = $derived(markGeometry(markForm(size)));
</script>

<svg
	class="mark"
	class:busy
	width={Math.round(size * MARK_ASPECT * 100) / 100}
	height={size}
	viewBox="0 0 {VIEWBOX_W} {VIEWBOX_H}"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
	focusable="false"
>
	{#each g.arcs as d (d)}
		<path class="arc" {d} stroke-width={g.arcWidth} />
	{/each}
	<path class="band" d={g.band} stroke-width={g.bandWidth} />
</svg>

<style>
	.mark {
		flex: none;
		display: block;
		overflow: visible;
	}
	.arc,
	.band {
		fill: none;
	}
	.arc {
		stroke: var(--color-mark-arc);
	}
	.band {
		stroke: var(--color-mark-band);
	}
	.busy {
		animation: mark-pulse 1.6s ease-in-out infinite;
	}
	@keyframes mark-pulse {
		50% {
			opacity: 0.55;
		}
	}
</style>
