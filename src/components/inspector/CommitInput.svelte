<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	A text field that commits on Enter or on blur (phase-2.md 9.3 "Field rules"): one edit, one
	undo step, never one per keystroke. Escape puts the plan's value back (and does not close the
	sheet it is in). A note (`multiline`) commits on blur only, since Enter is a new line there;
	Ctrl or Cmd with Enter commits it.

	`value` is what the plan says. While the person types, the draft is theirs and a new `value`
	(a reschedule, say) does not overwrite it. `oncommit` returns whether the edit applied. When it
	did, the committed text stays shown until `value` changes (the index follows the text a moment
	later), so the field never flashes back to the old value; when it did not (a refusal, a no-op),
	the field shows the plan's value again, and the dispatcher's toast says why.
-->
<script lang="ts">
	import { untrack } from 'svelte';

	interface Props {
		id: string;
		value: string;
		oncommit: (text: string) => Promise<boolean> | boolean;
		disabled?: boolean;
		describedby?: string | undefined;
		multiline?: boolean;
		inputmode?: 'text' | 'numeric' | 'decimal' | undefined;
		placeholder?: string;
		list?: string | undefined;
		mono?: boolean;
		/** The accessible name when there is no <label for>. */
		label?: string | undefined;
		/** Called on blur and Enter after the commit, for a stepper's burst. */
		onend?: () => void;
		onfocusin?: (e: FocusEvent) => void;
		onkeydown?: (e: KeyboardEvent) => void;
	}
	let {
		id,
		value,
		oncommit,
		disabled = false,
		describedby,
		multiline = false,
		inputmode,
		placeholder,
		list,
		mono = false,
		label,
		onend,
		onfocusin,
		onkeydown,
	}: Props = $props();

	let draft = $state(untrack(() => value));
	let editing = $state(false);
	/** The text just committed, shown until the plan's value changes. */
	let held = $state<string | null>(null);
	const shown = $derived(editing ? draft : (held ?? value));

	// A new value from the plan ends the hold, and replaces the draft unless one is being typed.
	$effect(() => {
		void value;
		held = null;
		if (!untrack(() => editing)) draft = value;
	});

	async function commit(): Promise<void> {
		if (!editing) return;
		editing = false;
		const text = draft;
		if (text === value) return;
		held = text;
		const applied = await oncommit(text);
		if (!applied) held = null;
		onend?.();
	}

	function key(e: KeyboardEvent): void {
		onkeydown?.(e);
		if (e.defaultPrevented) return;
		if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			void commit();
		} else if (e.key === 'Escape' && (editing || draft !== value)) {
			// Take back what was typed; the sheet stays open.
			e.preventDefault();
			editing = false;
			draft = value;
		}
	}
</script>

{#if multiline}
	<textarea
		{id}
		class="input"
		class:mono
		rows="3"
		{disabled}
		{placeholder}
		aria-label={label}
		aria-describedby={describedby}
		value={shown}
		oninput={(e) => {
			editing = true;
			draft = e.currentTarget.value;
		}}
		onblur={() => void commit()}
		{onfocusin}
		onkeydown={key}></textarea>
{:else}
	<input
		{id}
		class="input"
		class:mono
		type="text"
		{inputmode}
		{list}
		{disabled}
		{placeholder}
		autocomplete="off"
		autocapitalize="off"
		spellcheck="false"
		aria-label={label}
		aria-describedby={describedby}
		value={shown}
		oninput={(e) => {
			editing = true;
			draft = e.currentTarget.value;
		}}
		onblur={() => void commit()}
		{onfocusin}
		onkeydown={key}
	/>
{/if}

<style>
	.input {
		inline-size: 100%;
		min-inline-size: 0;
		min-block-size: var(--size-control);
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		/* 16 px at least, so that iOS does not zoom when a field takes the focus. */
		font: inherit;
		font-size: max(16px, var(--text-md));
	}
	textarea.input {
		padding-block: var(--space-2);
		line-height: var(--leading);
		resize: vertical;
	}
	.input.mono {
		font-family: var(--font-mono);
	}
	.input:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 1px;
	}
	.input:disabled {
		background: var(--color-surface-sunken);
		color: var(--color-text-muted);
	}
</style>
