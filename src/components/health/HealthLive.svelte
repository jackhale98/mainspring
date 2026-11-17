<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The polite live region of plan health (phase-3.md 10): after a reschedule it says how many new
	problems the result has ("2 new problems"), once per result. Visually hidden, on every layout.
-->
<script lang="ts">
	import type { AppState } from '../../lib/state/app.svelte';

	let { app }: { app: AppState } = $props();
</script>

<p class="sr-only" role="status" aria-live="polite" data-testid="health-live">
	{app.health.announcement}
</p>

<style>
	.sr-only {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
