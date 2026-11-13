<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The engine status pill (ADR-0009): a halo dot and "Engine: Ready". The state is in the text,
	not only the colour: the dot also changes shape (a diamond for a failure, a ring while it
	works). On a narrow bar or a phone the words are kept for screen readers and the title, and the
	pill shrinks to the dot.
-->
<script lang="ts">
	import type { EngineState } from '../../engine/client';
	import { engineLine } from '../../lib/strings';

	interface Props {
		state: EngineState;
		/** Show only the dot (the words stay in the DOM for assistive technology). */
		compact?: boolean;
		/** Shrink to the dot when the top bar is narrower than 1100 px (a container query). */
		adaptive?: boolean;
	}
	let { state, compact = false, adaptive = false }: Props = $props();
</script>

<p
	class="engine"
	class:compact
	class:adaptive
	data-testid="engine-status"
	data-state={state}
	title={engineLine(state)}
>
	<span class="words">{engineLine(state)}</span>
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
	/* Working: a ring, so that it differs from "ready" without colour. */
	.engine[data-state='busy']::before,
	.engine[data-state='booting']::before {
		background: transparent;
		border: 2px solid var(--color-brass);
		box-shadow: 0 0 0 3px var(--color-brass-wash);
	}
	/* Failed: a diamond in ruby. */
	.engine[data-state='failed']::before {
		border-radius: 1px;
		transform: rotate(45deg);
		background: var(--color-ruby);
		box-shadow: 0 0 0 3px var(--color-ruby-wash);
	}
	.compact {
		padding-inline: 10px;
	}
	.compact .words {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip-path: inset(50%);
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
