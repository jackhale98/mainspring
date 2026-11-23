<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	What a plan with no task shows where its tasks would be (ADR-0013 #3; phase-3.md 9.8): one short
	sentence and the Add task button, on the Gantt (desktop, tablet, phone, Split) and on the phone's
	Plan tab. The button is not a second way to add: the owner passes the same flow the toolbar's +
	runs (`onadd`, gantt/add-task-flow.ts). "or write them in Text" shows only where the editor is
	not already on screen (`ontext`; in Split the editor is beside it).
-->
<script lang="ts">
	import type { AppState } from '../../lib/state/app.svelte';
	import { strings } from '../../lib/strings';
	import Icon from '../Icon.svelte';

	/** How long after the delete the empty state may still take the focus (ms). */
	const FOCUS_WINDOW_MS = 3000;

	interface Props {
		app: AppState;
		/** The same action as the + control: adds the first task and opens its details. */
		onadd: () => Promise<unknown> | void;
		/** Brings the editor on screen; without it the pointer to Text is not shown. */
		ontext?: (() => void) | undefined;
	}
	let { app, onadd, ontext }: Props = $props();
	let addButton: HTMLButtonElement | undefined = $state();

	const S = strings.empty;

	// A delete that emptied the plan took the row that had the focus (a keyboard Delete on it): the
	// focus goes to "Add task", not to the page. Not taken from a control the person is using.
	$effect(() => {
		const at = app.emptiedAt;
		if (!addButton || at === 0 || Date.now() - at > FOCUS_WINDOW_MS) return;
		const active = document.activeElement;
		if (active === null || active === document.body || !active.isConnected) {
			addButton.focus({ preventScroll: true });
		}
	});
	/** An add is on its way (the edit, then the result): another press would add a second task. */
	let busy = $state(false);
	async function add(): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await onadd();
		} finally {
			busy = false;
		}
	}
</script>

<div class="empty" data-testid="empty-state">
	<p class="title">{S.tasksTitle}</p>
	<!-- A read-only tab (another tab has the plan) adds nothing. -->
	{#if !app.readOnly}
		<button
			type="button"
			class="add"
			bind:this={addButton}
			data-testid="empty-add-task"
			aria-disabled={busy ? 'true' : undefined}
			onclick={add}
		>
			<Icon name="plus" size={16} stroke={2.2} />{S.addTask}
		</button>
	{/if}
	{#if ontext}
		<button type="button" class="text" onclick={ontext}>{S.inText}</button>
	{/if}
</div>

<style>
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		min-block-size: 12rem;
		padding: var(--space-8) var(--gutter);
		text-align: center;
	}
	.title {
		margin: 0;
		color: var(--color-text-muted);
		font-family: var(--font-display);
		font-size: var(--text-lg);
	}
	.add {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-block-size: var(--size-control);
		padding-inline: var(--space-6);
		border: 1px solid var(--color-gantt-accent);
		border-radius: var(--radius-pill);
		background: var(--color-gantt-accent);
		color: var(--color-gantt-accent-text);
		font: inherit;
		font-weight: 500;
		cursor: pointer;
	}
	.add:hover {
		filter: brightness(1.08);
	}
	.add[aria-disabled='true'] {
		opacity: 0.6;
		cursor: default;
	}
	.text {
		min-block-size: var(--size-control);
		padding-inline: var(--space-3);
		border: 0;
		background: transparent;
		color: var(--color-text-muted);
		font: inherit;
		font-size: var(--text-sm);
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}
	.add:focus-visible,
	.text:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
</style>
