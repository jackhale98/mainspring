<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The brand mark (ADR-0009): a brass coiled mainspring in a thin ring. Decorative; the wordmark
	beside it names the app. The colour is the brass token, so it follows the theme.
-->
<script lang="ts">
	let { size = 28 }: { size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" focusable="false">
	<circle cx="14" cy="14" r="12.5" />
	<path
		d="M14 14 m0 -1.6 a1.6 1.6 0 1 1 -1.6 1.6 a3.2 3.2 0 1 1 3.2 3.2 a4.8 4.8 0 1 1 -4.8 -4.8 a6.4 6.4 0 1 1 6.4 6.4 a8 8 0 1 1 -8 -8"
	/>
</svg>

<style>
	svg {
		flex: none;
		fill: none;
		stroke: var(--color-brass);
		stroke-linecap: round;
	}
	circle {
		stroke-width: 1.5;
	}
	path {
		stroke-width: 1.4;
	}
</style>
