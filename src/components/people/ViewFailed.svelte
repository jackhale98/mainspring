<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	What a People view shows when its chunk could not be loaded (offline with nothing cached, a deploy
	that replaced it): the sentence and "Try again", which imports it once more. Chrome remembers a
	failed dynamic import, so after the second failure the button is "Reload the page" (`reload`,
	AppState.reloadPage: what autosave holds is stored first, and it asks only if changes would be
	lost): PeopleSlot.svelte's rule for the shell's own chunk.
-->
<script lang="ts">
	import { strings } from '../../lib/strings';
	import type { LazyModule } from './lazy.svelte';

	interface Props {
		lazy: LazyModule<unknown>;
		/** Reloads the page the app's way (AppState.reloadPage). */
		reload: () => unknown;
		testid?: string;
	}
	let { lazy, reload, testid = 'people-view-failed' }: Props = $props();
	const S = strings.people;

	function again(): void {
		if (lazy.failures >= 2) {
			reload();
			return;
		}
		lazy.load();
	}
</script>

<div class="message" role="alert" data-testid={testid}>
	<p>{S.loadFailed}</p>
	<button type="button" onclick={again}>{lazy.failures >= 2 ? S.reload : S.retry}</button>
</div>

<style>
	.message {
		margin: 0;
		padding: var(--space-6) var(--gutter);
		color: var(--color-text-muted);
		text-align: center;
	}
	.message p {
		margin: 0 0 var(--space-3);
	}
	button {
		min-block-size: var(--size-control);
		padding-inline: var(--space-6);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		cursor: pointer;
	}
	button:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
</style>
