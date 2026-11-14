<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The move question (phase-2.md 7.1 R2, ADR-0008 #2), asked once per browser: how should moving a
	task change the plan? Either a gap after the task it waits for (`gaplength`) or a fixed start
	date, which is a constraint and says so. The suggestion is pre-selected: a gap when the task
	has a driving dependency of its own, else a start. Move stores the answer (through the
	dispatcher, in the actor) and the same move is sent again; Cancel leaves the plan as it was.
	A native modal <dialog>: the browser traps the focus, closes it on Escape and returns the focus
	to what had it (the row). The answer can be changed later in Project settings.
-->
<script lang="ts">
	import type { MoveKind } from '../../lib/gantt/intents';
	import { ganttActionStrings, gestureStrings } from '../../lib/strings';

	interface Props {
		/** The suggestion while the question is open, else null. */
		ask: { readonly suggested: MoveKind } | null;
		onanswer: (kind: MoveKind | null) => void;
	}
	let { ask, onanswer }: Props = $props();

	const Q = ganttActionStrings.movePreference;
	const uid = $props.id();
	let dialog: HTMLDialogElement | undefined = $state();
	let chosen = $state<MoveKind>('start');

	$effect(() => {
		if (ask && dialog && !dialog.open) {
			chosen = ask.suggested;
			dialog.showModal();
		} else if (!ask && dialog?.open) {
			dialog.close();
		}
	});

	const options: ReadonlyArray<{ kind: MoveKind; label: string; note?: string }> = [
		{ kind: 'gap', label: Q.gap },
		{ kind: 'start', label: Q.start, note: Q.startWarning },
	];
</script>

<dialog
	bind:this={dialog}
	class="ask"
	data-testid="move-question"
	aria-labelledby="{uid}-title"
	oncancel={(e) => {
		e.preventDefault();
		onanswer(null);
	}}
>
	<form
		method="dialog"
		onsubmit={(e) => {
			e.preventDefault();
			onanswer(chosen);
		}}
	>
		<h2 id="{uid}-title">{Q.title}</h2>
		<fieldset>
			<legend class="sr-only">{Q.title}</legend>
			{#each options as o (o.kind)}
				<label class="option">
					<input type="radio" name="{uid}-kind" value={o.kind} bind:group={chosen} />
					<span class="text">
						{o.label}
						{#if o.note}<small>{o.note}</small>{/if}
					</span>
				</label>
			{/each}
		</fieldset>
		<p class="remember">{gestureStrings.moveQuestion.remember}</p>
		<div class="buttons">
			<button type="button" class="secondary" onclick={() => onanswer(null)}>
				{gestureStrings.moveQuestion.cancel}
			</button>
			<button type="submit" class="primary">{gestureStrings.moveQuestion.confirm}</button>
		</div>
	</form>
</dialog>

<style>
	.ask {
		inline-size: min(26rem, calc(100vw - 2 * var(--gutter)));
		padding: var(--space-5);
		border: 0;
		border-radius: var(--radius-panel);
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow-panel);
	}
	.ask::backdrop {
		background: rgb(0 0 0 / 0.35);
	}
	h2 {
		margin: 0 0 var(--space-3);
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: 400;
	}
	fieldset {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		border: 0;
	}
	.option {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		min-block-size: var(--size-tap);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		cursor: pointer;
	}
	.option:has(input:checked) {
		border-color: var(--color-focus);
		background: var(--color-row-hover);
	}
	.option:has(input:focus-visible) {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
	.option input {
		margin-block: 0.2rem 0;
		accent-color: var(--color-focus);
	}
	.text {
		display: grid;
		gap: var(--space-1);
		font-size: var(--text-sm);
	}
	small {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
	.remember {
		margin: var(--space-3) 0 var(--space-4);
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}
	button {
		min-block-size: var(--size-control);
		padding-inline: var(--space-4);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		cursor: pointer;
	}
	button.primary {
		border-color: var(--color-accent);
		background: var(--color-accent);
		color: var(--color-accent-text);
	}
	button:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
</style>
