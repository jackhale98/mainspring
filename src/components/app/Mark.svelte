<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The brand mark (ADR-0009, "Mark change, 2026-11-16"; geometry in src/lib/brand/mark.ts): a navy
	ribbon that flows into a coil, like the end of a mainspring strip, with a brass arc beside each
	end. `size` is the height; the width follows the mark's aspect (35 x 26 px at 26).
	With `busy` it doubles as the loader: the ribbon is drawn along its path, from its free end into
	the coil, then released the same way (a short stub of it, 6% of the path, is always drawn, so the mark is
	never blank), a cycle of 2 s (two 1 s beats on the beat's easing); the
	brass arcs brighten with it. Only a dash offset and an opacity move, so it stays cheap to paint (no masks or filters, which WebKit repaints
	every frame). Under reduced motion the mark holds still and pulses gently.
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
	<path class="band" d={g.band} stroke-width={g.bandWidth} pathLength="100" />
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
	/* The loader: the ribbon draws in from its free end, holds, leaves the same way, then rests a
	   moment before the next turn, so the loop does not jump (user, 2026-11-17). */
	.busy .band {
		stroke-dasharray: 100 100;
		animation: mark-draw 2.8s infinite;
	}
	/* The brass arcs wake with the ribbon and dim as it leaves. */
	.busy .arc {
		animation: mark-arc 2.8s infinite;
	}
	@keyframes mark-draw {
		0% {
			stroke-dashoffset: 94;
			opacity: 0;
		}
		6% {
			stroke-dashoffset: 94;
			opacity: 1;
			animation-timing-function: cubic-bezier(0.45, 0, 0.55, 1);
		}
		38% {
			stroke-dashoffset: 0;
		}
		50% {
			stroke-dashoffset: 0;
			animation-timing-function: cubic-bezier(0.45, 0, 0.55, 1);
		}
		82% {
			stroke-dashoffset: -94;
			opacity: 1;
		}
		88%,
		100% {
			stroke-dashoffset: -94;
			opacity: 0;
		}
	}
	@keyframes mark-arc {
		0%,
		6% {
			opacity: 0.3;
			animation-timing-function: cubic-bezier(0.45, 0, 0.55, 1);
		}
		38%,
		50% {
			opacity: 1;
			animation-timing-function: cubic-bezier(0.45, 0, 0.55, 1);
		}
		82%,
		100% {
			opacity: 0.3;
		}
	}
	@keyframes mark-pulse {
		50% {
			opacity: 0.55;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.busy .band,
		.busy .arc {
			animation: none;
			stroke-dasharray: none;
		}
		.busy {
			animation: mark-pulse 1.6s ease-in-out infinite;
		}
	}
</style>
