<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	A task's size (phase-2.md 9.3 "Sizing"): the kind (effort, length or duration) and a value with
	a stepper. Changing the kind rewrites the keyword and the value together (phase-1 15.20). The
	value follows the task list's rule (lib/gantt/grid.ts `sizingSite`): the last statement for the
	shown scenario wins. A container or a milestone has no size and says so; a size written with a
	macro, or for another scenario, is shown as text only with "Show in text".

	The stepper's presses are `size-step` actions with a coalesce key (R1's keys and steppers,
	intents.ts): one edit and one undo step for a burst. A task with no size gets a field to type
	one into (`5d`); the kind picked there is used for it. The open-ended notice (11.1) is for a
	leaf that has someone booked and no size.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import type { SizeAttr, TaskDetails } from '../../lib/inspector/task';
	import { sizeEdit } from '../../lib/inspector/edit';
	import { inspectorStrings as S } from '../../lib/strings';
	import { getInspector } from './context';
	import Field from './Field.svelte';
	import CommitInput from './CommitInput.svelte';
	import Select from './Select.svelte';
	import Stepper from './Stepper.svelte';

	let { d }: { d: TaskDetails } = $props();
	const { app, actions, showInText } = getInspector();

	const uid = $props.id();
	const valueId = `${uid}-value`;
	const size = $derived(d.size);
	const KINDS: readonly SizeAttr[] = ['effort', 'length', 'duration'];
	/** Written with a macro or for another scenario: shown, not changed. */
	const locked = $derived(size.kind === 'text-only' || size.kind === 'scenario');
	const options = KINDS.map((k) => ({ value: k, label: S.size[k] }));
	/** The kind picked while there is no size to rewrite. */
	let picked = $state<SizeAttr>(untrack(() => d.size.attr));
	const kind = $derived<SizeAttr>(size.kind === 'own' ? size.attr : picked);
	const key = $derived(`inspector:size:${d.id}`);
	let last: Promise<{ status: string }> = Promise.resolve({ status: 'cancelled' });

	const people = $derived(d.people.map((p) => p.name).join(', '));
	const unit = $derived(size.unit ?? 'd');
	const format = (n: number): string => `${Number(n.toFixed(3))}${unit}`;

	const typed = async (text: string): Promise<boolean> => {
		if (text.trim() === '') return false;
		const o = await actions.edit(sizeEdit(d, kind, text));
		return o.status === 'applied';
	};
	const changeKind = async (v: string): Promise<boolean> => {
		const attr = v as SizeAttr;
		if (size.kind !== 'own') {
			picked = attr;
			return true;
		}
		const o = await actions.edit(sizeEdit(d, attr, size.text ?? ''));
		return o.status === 'applied';
	};
	const press = (total: number): void => {
		last = actions.action({ type: 'size-step', task: d.id, steps: total }, key);
	};
	const end = async (): Promise<boolean> => {
		actions.flush(key);
		return (await last).status === 'applied';
	};

	// "Set effort" (the open-ended notice, the milestone question) moves the focus to the value. The
	// field may not exist yet (a milestone has none until the plan says it is not one), so the
	// request waits for it, for a few seconds at most.
	let seen = untrack(() => app.inspector.sizeFocus);
	let wanted = 0;
	$effect(() => {
		const n = app.inspector.sizeFocus;
		if (n !== seen) {
			seen = n;
			wanted = Date.now() + 4000;
		}
	});
	$effect(() => {
		void size.kind;
		if (wanted === 0) return;
		const el = document.getElementById(valueId);
		if (el) {
			wanted = 0;
			el.focus();
		} else if (Date.now() > wanted) wanted = 0;
	});
</script>

<div class="size">
	{#if size.kind === 'blocked'}
		<p class="note">{size.why === 'container' ? S.size.container : S.size.milestone}</p>
	{:else}
		<div class="pair">
			<Field label={S.field.sizeType}>
				{#snippet children({ id, disabled })}
					<Select
						{id}
						value={kind}
						{options}
						disabled={disabled || locked}
						onchange={changeKind}
						describedby={undefined}
					/>
				{/snippet}
			</Field>
			<Field
				label={S.field.sizeValue}
				id={valueId}
				state={size.kind === 'text-only' && size.at && size.reason
					? { kind: 'text-only', reason: size.reason, at: size.at }
					: undefined}
				off={size.kind === 'scenario' ? S.otherScenario(size.scenario ?? '') : null}
				hint={size.kind === 'none' ? S.size.unset : S.size.hint[kind]}
				onshow={showInText}
			>
				{#snippet children({ id, disabled, describedby })}
					{#if size.kind === 'own' && size.amount !== null}
						<Stepper
							{id}
							text={size.text ?? ''}
							value={size.amount}
							{format}
							min={1}
							what={S.size[kind]}
							{disabled}
							{describedby}
							onpress={press}
							onend={end}
							oncommit={typed}
						/>
					{:else}
						<CommitInput
							{id}
							value=""
							{disabled}
							{describedby}
							mono
							placeholder="5d"
							label={S.size[kind]}
							oncommit={typed}
						/>
					{/if}
				{/snippet}
			</Field>
		</div>
		{#if size.kind === 'scenario' && size.at}
			<button type="button" class="link" onclick={() => size.at && showInText(size.at)}>
				{S.showInText}
			</button>
		{/if}
		{#if d.impliedMilestone}<p class="note">{S.size.implied}</p>{/if}
	{/if}
	{#if d.openEnded}
		<div class="open" role="group" aria-label={S.openEnded.title}>
			<p>{S.openEnded.notice(people)}</p>
			<button
				type="button"
				class="action"
				onclick={() => document.getElementById(valueId)?.focus()}
			>
				{S.openEnded.setEffort}
			</button>
		</div>
	{/if}
</div>

<style>
	.size {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.pair {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr);
		gap: var(--space-3);
		align-items: start;
	}
	.note {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
	.open {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--color-ruby);
		border-radius: var(--radius-md);
		background: var(--color-ruby-wash);
		color: var(--color-ruby-ink);
		font-size: var(--text-sm);
	}
	.open p {
		margin: 0;
	}
	.action {
		min-block-size: var(--size-control);
		padding-inline: var(--space-4);
		border: 1px solid var(--color-ruby);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-ruby-ink);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
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
	@media (max-width: 22rem) {
		.pair {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
