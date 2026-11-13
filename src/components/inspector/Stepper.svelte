<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	A value with a minus and a plus button (phase-2.md 9.3; the buttons are 44 px on a touch screen,
	polish item 8). The value is also a text field, so a number can be typed (committed on Enter or
	blur, as every field).

	The buttons make a burst (lib/inspector/burst.ts): each press tells the parent the total since
	the burst began, and the dispatcher coalesces them into one edit and one undo step (edits.svelte.ts
	"Coalescing"). The burst ends on Enter, when the focus leaves the stepper, or after a pause
	(`PAUSE_MS`), which also covers Safari, where a pressed button takes no focus to lose. While the
	burst runs and until the text catches up, the stepper shows base plus total, not the plan's text.
	Presses while an ended burst is settling are ignored (a few frames).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { Burst } from '../../lib/inspector/burst';
	import { inspectorStrings as S } from '../../lib/strings';
	import CommitInput from './CommitInput.svelte';

	interface Props {
		id: string;
		/** What the plan says, as written ("3d", "500"). */
		text: string;
		/** The number in it, or null when the stepper cannot step it (a macro, a variable). */
		value: number | null;
		format: (n: number) => string;
		min?: number;
		max?: number;
		/** How much a press changes the value. */
		step?: number;
		/** The accessible name of the value, and what the buttons say they change. */
		what: string;
		disabled?: boolean;
		describedby?: string | undefined;
		/** A press: the total since the burst began (never the step), and the value it began from. */
		onpress: (total: number, base: number) => void;
		/** The burst is over: send the held total now; whether it applied. */
		onend: () => Promise<boolean> | boolean;
		oncommit: (text: string) => Promise<boolean> | boolean;
	}
	let {
		id,
		text,
		value,
		format,
		min = -Infinity,
		max = Infinity,
		step = 1,
		what,
		disabled = false,
		describedby,
		onpress,
		onend,
		oncommit,
	}: Props = $props();

	/** Quiet time after the last press that ends the burst. */
	const PAUSE_MS = 1200;
	/** The longest an ended burst waits for the text to change. */
	const SETTLE_MS = 2500;

	const burst = new Burst(
		untrack(() => min),
		untrack(() => max),
	);
	let held = $state(false);
	let total = $state(0);
	let phase = $state<'idle' | 'active' | 'settling'>('idle');
	let at: string | null = null;
	let pause: ReturnType<typeof setTimeout> | null = null;
	let settle: ReturnType<typeof setTimeout> | null = null;
	let root: HTMLDivElement | undefined = $state();

	/** The number the stepper stands at: the held burst's, else the plan's. */
	const current = $derived(held && burst.base !== null ? burst.base + total : value);
	const shown = $derived(held && current !== null ? format(current) : text);

	function release(): void {
		if (pause) clearTimeout(pause);
		if (settle) clearTimeout(settle);
		pause = settle = null;
		burst.release();
		held = false;
		total = 0;
		phase = 'idle';
		at = null;
	}

	async function end(): Promise<void> {
		if (phase !== 'active') return;
		if (pause) clearTimeout(pause);
		pause = null;
		phase = 'settling';
		at = text;
		const applied = await onend();
		if (!applied) return release();
		// The text changes a moment later (the index follows it): the effect below releases.
		settle = setTimeout(release, SETTLE_MS);
	}

	$effect(() => {
		if (phase === 'settling' && text !== at) release();
	});
	$effect(() => () => {
		if (pause) clearTimeout(pause);
		if (settle) clearTimeout(settle);
		if (phase === 'active') void onend();
	});

	function press(by: number): void {
		if (value === null || disabled || phase === 'settling') return;
		phase = 'active';
		total = burst.press(value, by * step);
		held = true;
		onpress(total, burst.base ?? value);
		if (pause) clearTimeout(pause);
		pause = setTimeout(() => void end(), PAUSE_MS);
	}

	function focusout(e: FocusEvent): void {
		if (!root?.contains(e.relatedTarget as Node | null)) void end();
	}

	const atMin = $derived(current !== null && current <= min);
	const atMax = $derived(current !== null && current >= max);
</script>

<!-- The group's focusout is how a burst ends; it is not itself interactive. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="stepper" bind:this={root} onfocusout={focusout} role="group" aria-label={what}>
	<button
		type="button"
		class="step"
		disabled={disabled || value === null || atMin}
		aria-label={S.decrease(what)}
		onclick={() => press(-1)}>−</button
	>
	<div class="value">
		<CommitInput
			{id}
			value={shown}
			{oncommit}
			{disabled}
			{describedby}
			mono
			inputmode="text"
			label={what}
			onend={() => void end()}
			onkeydown={(e) => {
				if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
					e.preventDefault();
					press(e.key === 'ArrowUp' ? 1 : -1);
				} else if (e.key === 'Enter') void end();
			}}
		/>
	</div>
	<button
		type="button"
		class="step"
		disabled={disabled || value === null || atMax}
		aria-label={S.increase(what)}
		onclick={() => press(1)}>+</button
	>
</div>

<style>
	.stepper {
		display: flex;
		align-items: stretch;
		gap: var(--space-1);
		min-inline-size: 0;
	}
	.value {
		flex: 1;
		min-inline-size: 0;
	}
	.step {
		flex: none;
		inline-size: var(--size-control);
		min-block-size: var(--size-control);
		padding: 0;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: 1.25rem;
		line-height: 1;
		cursor: pointer;
	}
	.step:hover:not(:disabled) {
		background: var(--color-row-hover);
	}
	.step:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 1px;
	}
	.step:disabled {
		color: var(--color-text-muted);
		cursor: default;
	}
	/* A touch screen: 44 px buttons (the size-control token is already 44 there). */
	@media (pointer: coarse) {
		.step {
			inline-size: var(--size-tap);
			min-block-size: var(--size-tap);
		}
	}
</style>
