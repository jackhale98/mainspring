<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	Undo and redo icon buttons: the workspace history (phase-2.md 6.7), the same as Mod-Z. Disabled
	while there is nothing to do; the tooltip names what would be undone.
-->
<script lang="ts">
	import type { AppState } from '../../lib/state/app.svelte';
	import { strings } from '../../lib/strings';
	import Icon from '../Icon.svelte';

	let { app }: { app: AppState } = $props();
</script>

<div class="pair" role="group" aria-label={strings.topBar.history}>
	<button
		type="button"
		data-testid="undo"
		aria-label={strings.topBar.undo}
		title={app.history.undoLabel}
		disabled={!app.history.canUndo}
		onclick={() => app.history.undo()}
	>
		<Icon name="undo" size={17} />
	</button>
	<button
		type="button"
		data-testid="redo"
		aria-label={strings.topBar.redo}
		title={app.history.redoLabel}
		disabled={!app.history.canRedo}
		onclick={() => app.history.redo()}
	>
		<Icon name="redo" size={17} />
	</button>
</div>

<style>
	.pair {
		display: inline-flex;
		gap: 2px;
	}
	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		inline-size: var(--size-control);
		block-size: var(--size-control);
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: background-color var(--motion-fast);
	}
	button:hover:not(:disabled) {
		background: var(--color-row-hover);
		color: var(--color-text);
	}
	/* Disabled is still readable: 3:1 is the floor for a control that is shown (WCAG 1.4.11). */
	button:disabled {
		color: var(--color-text-faint);
		opacity: 0.6;
		cursor: default;
	}
</style>
