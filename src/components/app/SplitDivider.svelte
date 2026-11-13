<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The draggable divider of Split mode (phase-2.md 9.2): a `role="separator"` that is focusable and
	moves with the arrow keys (Left and Right side by side, Up and Down stacked; Shift for bigger
	steps, Home and End for the limits) and with a pointer drag. Pointer events with capture, so
	that the drag follows the pointer out of the handle and works for mouse, pen and touch; the
	touch handle is 44 px. The drag is also reachable by keyboard (WCAG 2.5.7). The ratio rules are
	src/lib/state/split.ts; the container is whatever element holds both panels.
-->
<script lang="ts">
	import { ratioFromPointer, stepRatio, type SplitAxis } from '../../lib/state/split';
	import { strings } from '../../lib/strings';
	import Icon from '../Icon.svelte';

	interface Props {
		axis: SplitAxis;
		/** The ratio now (see split.ts for what it is a share of). */
		value: number;
		/** The element that holds the two panels. */
		container: HTMLElement | undefined;
		onchange: (value: number) => void;
		/** A drag or a key press ended: the place to remember it. */
		oncommit: () => void;
		/** What the separator is called, and the name of the first panel in its value text. */
		label?: string;
		firstName?: string;
	}
	let {
		axis,
		value,
		container,
		onchange,
		oncommit,
		label = strings.panels.divider,
		firstName,
	}: Props = $props();

	let dragging = $state(false);
	const vertical = $derived(axis === 'col');
	const percent = $derived(Math.round(value * 100));
	const first = $derived(
		firstName ?? (axis === 'col' ? strings.panels.dividerEditor : strings.panels.dividerChart),
	);

	function fromPointer(e: PointerEvent): void {
		if (!container) return;
		const r = container.getBoundingClientRect();
		onchange(
			vertical
				? ratioFromPointer(e.clientX, r.left, r.width)
				: ratioFromPointer(e.clientY, r.top, r.height),
		);
	}

	function onpointerdown(e: PointerEvent): void {
		if (e.button !== 0) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		dragging = true;
		fromPointer(e);
		e.preventDefault();
	}
	function onpointermove(e: PointerEvent): void {
		if (dragging) fromPointer(e);
	}
	function onpointerup(e: PointerEvent): void {
		if (!dragging) return;
		dragging = false;
		fromPointer(e);
		oncommit();
	}
	function onkeydown(e: KeyboardEvent): void {
		const next = stepRatio(value, e.key, axis, e.shiftKey);
		if (next === null) return;
		e.preventDefault();
		onchange(next);
		oncommit();
	}
</script>

<div
	class="divider"
	class:dragging
	data-axis={axis}
	role="separator"
	tabindex="0"
	aria-label={label}
	aria-orientation={vertical ? 'vertical' : 'horizontal'}
	aria-valuenow={percent}
	aria-valuemin={20}
	aria-valuemax={80}
	aria-valuetext={strings.panels.dividerValue(percent, first)}
	{onpointerdown}
	{onpointermove}
	{onpointerup}
	onpointercancel={onpointerup}
	{onkeydown}
>
	<span class="grip"><Icon name="grip" size={14} stroke={2.4} /></span>
</div>

<style>
	.divider {
		position: relative;
		z-index: 3;
		display: grid;
		place-items: center;
		touch-action: none;
		outline-offset: -2px;
	}
	.divider[data-axis='col'] {
		inline-size: var(--gap-panel);
		cursor: col-resize;
	}
	.divider[data-axis='row'] {
		block-size: var(--gap-panel);
		cursor: row-resize;
	}
	/* The hit area is wider than the visible gap: 24 px, and 44 px on a coarse pointer. */
	.divider::before {
		content: '';
		position: absolute;
	}
	.divider[data-axis='col']::before {
		inset-block: 0;
		inset-inline: calc((24px - var(--gap-panel)) / -2);
	}
	.divider[data-axis='row']::before {
		inset-inline: 0;
		inset-block: calc((24px - var(--gap-panel)) / -2);
	}
	@media (pointer: coarse) {
		.divider[data-axis='col']::before {
			inset-inline: calc((44px - var(--gap-panel)) / -2);
		}
		.divider[data-axis='row']::before {
			inset-block: calc((44px - var(--gap-panel)) / -2);
		}
	}
	/* The grip is a small brass pill that appears on hover, focus and drag. */
	.grip {
		display: grid;
		place-items: center;
		inline-size: 18px;
		block-size: 34px;
		border-radius: var(--radius-pill);
		border: 1px solid var(--color-border-strong);
		background: var(--color-surface-raised);
		box-shadow: var(--shadow-chip);
		color: var(--color-text-faint);
		opacity: 0;
		transition: opacity var(--motion-fast);
		pointer-events: none;
	}
	.divider[data-axis='row'] .grip {
		inline-size: 34px;
		block-size: 18px;
		transform: rotate(90deg);
	}
	.divider:hover .grip,
	.divider:focus-visible .grip,
	.divider.dragging .grip {
		opacity: 1;
	}
	@media (pointer: coarse) {
		.grip {
			opacity: 1;
		}
	}
	.divider:focus-visible {
		outline: 3px solid var(--color-focus);
	}
</style>
