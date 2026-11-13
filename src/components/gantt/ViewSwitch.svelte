<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The minimal view switch (src/lib/state/view-mode.ts): Text, Split or Gantt, as three toggle
	buttons in the top bar. Task T14 replaces it with the real mode toggle and shortcuts.
-->
<script lang="ts">
	import { VIEW_MODES, type ViewMode } from '../../lib/state/view-mode';
	import { strings } from '../../lib/strings';

	interface Props {
		mode: ViewMode;
		onmode: (mode: ViewMode) => void;
	}
	let { mode, onmode }: Props = $props();
</script>

<div class="switch" role="group" aria-label={strings.view.label}>
	{#each VIEW_MODES as m (m)}
		<button type="button" aria-pressed={mode === m} onclick={() => onmode(m)}>
			{strings.view[m]}
		</button>
	{/each}
</div>

<style>
	.switch {
		display: inline-flex;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}
	button {
		min-block-size: 2.25rem;
		padding-inline: var(--space-3);
		border: 0;
		border-inline-start: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	button:first-child {
		border-inline-start: 0;
	}
	button[aria-pressed='true'] {
		background: var(--color-accent);
		color: var(--color-accent-text);
		font-weight: 600;
	}
	button:not([aria-pressed='true']):hover {
		background: var(--color-row-hover);
	}
	@media (pointer: coarse) {
		button {
			min-block-size: var(--size-tap);
		}
	}
</style>
