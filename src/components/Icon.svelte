<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	An inline stroke icon (src/lib/icons.ts, Lucide-style, ISC). Decorative: hidden from assistive
	technology; the control it sits on has the accessible name. The colour is the text colour.
-->
<script lang="ts">
	import { ICONS, type IconName } from '../lib/icons';

	interface Props {
		/** A shared icon. Optional when `paths` is given. */
		name?: IconName;
		/** The path data itself, for an icon that one lazy view owns (lib/icons-calendar.ts). */
		paths?: readonly string[];
		/** Size in px; the grid is 24. */
		size?: number;
		/** Stroke width on the 24 px grid (ADR-0009: 1.8). */
		stroke?: number;
	}
	let { name, paths, size = 16, stroke = 1.8 }: Props = $props();
	const shapes = $derived(paths ?? (name ? ICONS[name] : []));
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
	{#each shapes as d (d)}<path {d} />{/each}
</svg>

<style>
	.icon {
		flex: none;
		display: block;
	}
</style>
