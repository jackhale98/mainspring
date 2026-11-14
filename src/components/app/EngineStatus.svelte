<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The engine status pill (ADR-0009): a halo dot and "Engine: Ready". The state is in the text,
	not only the colour: the dot also changes shape (a diamond for a failure, and while it works the
	brand mark, ticking, as the loader). On a narrow bar the words are kept for screen readers and
	the title, and the pill shrinks to the dot. (A phone has the top bar's status button instead.)
-->
<script lang="ts">
	import type { EngineState } from '../../engine/client';
	import { engineLine } from '../../lib/strings';
	import Mark from './Mark.svelte';

	interface Props {
		state: EngineState;
		/** Shrink to the dot when the top bar is narrower than 1100 px (a container query). */
		adaptive?: boolean;
	}
	let { state, adaptive = false }: Props = $props();
	const working = $derived(state === 'busy' || state === 'booting');
</script>

<p
	class="engine"
	class:adaptive
	data-testid="engine-status"
	data-state={state}
	title={engineLine(state)}
>
	{#if working}<Mark size={16} busy />{/if}<span class="words">{engineLine(state)}</span>
</p>

<style>
	.engine {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-block-size: 32px;
		margin: 0;
		padding-inline: 12px;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		box-shadow: var(--shadow-chip);
		color: var(--color-text-muted);
		font-size: 12px;
		white-space: nowrap;
	}
	/* The dot is drawn on the pill, so that its text is the only content (no stray space). */
	.engine::before {
		content: '';
		flex: none;
		inline-size: 8px;
		block-size: 8px;
		border-radius: 50%;
		background: var(--color-status-neutral);
	}
	.engine[data-state='idle']::before {
		background: var(--color-status-ok);
		box-shadow: 0 0 0 3px var(--color-status-ok-halo);
	}
	/* Working: the ticking mark replaces the dot, so it differs from "ready" without colour. */
	.engine[data-state='busy']::before,
	.engine[data-state='booting']::before {
		display: none;
	}
	/* Failed: a diamond in ruby. */
	.engine[data-state='failed']::before {
		border-radius: 1px;
		transform: rotate(45deg);
		background: var(--color-ruby);
		box-shadow: 0 0 0 3px var(--color-ruby-wash);
	}
	@container topbar (max-width: 1099px) {
		.adaptive {
			padding-inline: 10px;
		}
		.adaptive .words {
			position: absolute;
			inline-size: 1px;
			block-size: 1px;
			overflow: hidden;
			clip-path: inset(50%);
		}
	}
</style>
