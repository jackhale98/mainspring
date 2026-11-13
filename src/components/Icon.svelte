<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	An inline stroke icon (src/lib/icons.ts, Lucide-style, ISC). Decorative: hidden from assistive
	technology; the control it sits on has the accessible name. The colour is the text colour.
-->
<script lang="ts">
	import { ICONS, type IconName } from '../lib/icons';

	interface Props {
		name: IconName;
		/** Size in px; the grid is 24. */
		size?: number;
		/** Stroke width on the 24 px grid (ADR-0009: 1.8). */
		stroke?: number;
	}
	let { name, size = 16, stroke = 1.8 }: Props = $props();
</script>

<svg
	class="icon"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={stroke}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	{#each ICONS[name] as d (d)}<path {d} />{/each}
</svg>

<style>
	.icon {
		flex: none;
		display: block;
	}
</style>
