<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The mode switch in the top bar (phase-2.md 9.1): Text, Split and Visual as a floating pill with
	an icon on each segment. The active segment is a dark enamel pill with ivory text and a thin
	blued-steel marker (ADR-0009: steel is an accent only). Each button is a toggle with its name
	in the DOM, so the icon-only form on narrow bars still has names. Cmd or Ctrl and 1, 2, 3 pick
	a mode from anywhere (src/lib/state/shortcuts.ts).
-->
<script lang="ts">
	import { VIEW_MODES, type ViewMode } from '../../lib/state/view-mode';
	import { strings } from '../../lib/strings';
	import type { IconName } from '../../lib/icons';
	import Icon from '../Icon.svelte';

	interface Props {
		mode: ViewMode;
		onmode: (mode: ViewMode) => void;
	}
	let { mode, onmode }: Props = $props();

	const ICON: Record<ViewMode, IconName> = { text: 'code', split: 'split', visual: 'visual' };
</script>

<div class="switch" role="group" aria-label={strings.view.label}>
	{#each VIEW_MODES as m, i (m)}
		<button
			type="button"
			aria-pressed={mode === m}
			aria-keyshortcuts="Control+{i + 1} Meta+{i + 1}"
			title="{strings.view[m]} ({strings.view.shortcut(i + 1)})"
			onclick={() => onmode(m)}
		>
			<Icon name={ICON[m]} size={15} />
			<span class="label">{strings.view[m]}</span>
		</button>
	{/each}
</div>

<style>
	.switch {
		display: inline-flex;
		gap: 2px;
		padding: 4px;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		box-shadow: var(--shadow-chip);
	}
	button {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-block-size: 30px;
		padding-inline: 14px;
		border: 0;
		border-radius: var(--radius-pill);
		background: transparent;
		color: var(--color-text-muted);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		transition:
			background-color var(--motion-fast),
			color var(--motion-fast);
	}
	button:hover:not([aria-pressed='true']) {
		background: var(--color-row-hover);
		color: var(--color-text);
	}
	button[aria-pressed='true'] {
		background: var(--color-pill-on);
		color: var(--color-pill-on-ink);
		font-weight: 600;
	}
	/* The steel marker: thin, under the label, like a watch hand's tip. */
	button[aria-pressed='true']::after {
		content: '';
		position: absolute;
		inset-block-end: 3px;
		inset-inline: 50%;
		inline-size: 14px;
		block-size: 2px;
		margin-inline-start: -7px;
		border-radius: 1px;
		background: var(--color-pill-marker);
	}
	@media (pointer: coarse) {
		button {
			min-block-size: var(--size-tap);
		}
	}
	/* A narrow bar keeps the icons, and the label of the active segment only. */
	@container topbar (max-width: 899px) {
		button:not([aria-pressed='true']) .label {
			position: absolute;
			inline-size: 1px;
			block-size: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		button:not([aria-pressed='true']) {
			padding-inline: 11px;
		}
	}
</style>
