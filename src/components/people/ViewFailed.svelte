<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	What a People view shows when its chunk could not be loaded (offline with nothing cached, a deploy
	that replaced it): the sentence and "Try again", which imports it once more. Chrome remembers a
	failed dynamic import, so after the second failure the button is "Reload the page", asking first
	when the plan was edited (a reload discards it): PeopleSlot.svelte's rule for the shell's own chunk.
-->
<script lang="ts">
	import { strings } from '../../lib/strings';
	import type { LazyModule } from './lazy.svelte';

	interface Props {
		lazy: LazyModule<unknown>;
		/** Whether the open plan was edited (a reload would discard it). */
		dirty: boolean;
		testid?: string;
	}
	let { lazy, dirty, testid = 'people-view-failed' }: Props = $props();
	const S = strings.people;

	function again(): void {
		if (lazy.failures >= 2) {
			if (dirty && !globalThis.confirm(strings.update.confirmReload)) return;
			location.reload();
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
