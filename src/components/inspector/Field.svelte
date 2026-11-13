<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	One labelled field of the inspector (phase-2.md 9.3 "Field rules"). The label is a real <label>
	for the control; the control comes from the caller (`children` gets its id and what to set on
	it). The field reads what the plan says through a `FieldState` (lib/inspector/field.ts):

	- text only (a macro, a variable): the control is disabled, the field says why and offers
	  "Show in text" instead of editing;
	- inherited from a parent task: the field says so and where from, with "Show in text" for the
	  parent's statement; a value typed here is written on the task itself and replaces it;
	- otherwise the optional hint, tied to the control with aria-describedby.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { FieldState } from '../../lib/inspector/field';
	import { inspectorStrings as S } from '../../lib/strings';
	import type { SourceRange } from '../../lib/tjp/index';

	interface Props {
		label: string;
		/** The control's id; one is made when it is not given. */
		id?: string;
		state?: FieldState | undefined;
		/** A fixed note under the control (a hint, a warning); shown after the state's own. */
		hint?: string | null;
		/** Why the control is off, when the caller knows better than the state. */
		off?: string | null;
		/** "Show in text" for a range. Without it the button is not offered. */
		onshow?: (at: SourceRange) => void;
		children: Snippet<[{ id: string; disabled: boolean; describedby: string | undefined }]>;
	}
	let { label, id: given, state, hint = null, off = null, onshow, children }: Props = $props();

	const own = $props.id();
	const id = $derived(given ?? own);
	const noteId = $derived(`${id}-note`);
	const textOnly = $derived(state?.kind === 'text-only' ? state : null);
	const inherited = $derived(state?.kind === 'inherited' ? state : null);
	const disabled = $derived(textOnly !== null || off !== null);
	const note = $derived(
		off ??
			(textOnly ? S.textOnly[textOnly.reason] : null) ??
			(inherited ? S.inherited(inherited.fromName) : null) ??
			hint,
	);
	const at = $derived(textOnly?.at ?? inherited?.at ?? null);
</script>

<div class="field">
	<label for={id}>{label}</label>
	{@render children({ id, disabled, describedby: note ? noteId : undefined })}
	{#if note}
		<p class="note" id={noteId}>{note}</p>
	{/if}
	{#if at && onshow}
		<button type="button" class="link" onclick={() => onshow(at)}>{S.showInText}</button>
	{/if}
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-inline-size: 0;
	}
	label {
		color: var(--color-text-muted);
		font-size: var(--text-label);
		font-weight: 600;
		letter-spacing: 0.02em;
	}
	.note {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
	.link {
		align-self: flex-start;
		min-block-size: 24px;
		padding: 0 2px;
		border: 0;
		background: transparent;
		color: var(--color-accent);
		font: inherit;
		font-size: var(--text-xs);
		text-decoration: underline;
		cursor: pointer;
	}
	.link:hover {
		color: var(--color-accent-hover);
	}
	@media (pointer: coarse) {
		.link {
			min-block-size: var(--size-tap);
		}
	}
</style>
