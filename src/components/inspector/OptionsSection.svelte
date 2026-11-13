<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The rest of a task's own settings (phase-2.md 9.3): scheduling, milestone, priority, progress
	(`complete`), the responsible person and a note. Every one is written on the task through the
	edit API; one that a parent task sets says so (Field.svelte), and one written with a macro is
	shown and left to the text.

	Turning `milestone` off for a leaf that has someone booked and no size would leave it with no
	size, so TaskJuggler books that person until the project end (phase-2.md 11.1). The inspector
	asks first, inline: "Set effort" clears the milestone and puts the focus on the size field,
	"Change anyway" only clears it. Escape drops the question.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import {
		milestoneEdit,
		noteEdit,
		numberEdit,
		responsibleEdit,
		schedulingEdit,
	} from '../../lib/inspector/edit';
	import { assignable, type TaskDetails } from '../../lib/inspector/task';
	import { inspectorStrings as S } from '../../lib/strings';
	import CommitInput from './CommitInput.svelte';
	import { getInspector } from './context';
	import Field from './Field.svelte';
	import Select from './Select.svelte';
	import Stepper from './Stepper.svelte';

	let { d }: { d: TaskDetails } = $props();
	const { app, actions, showInText } = getInspector();
	const uid = $props.id();

	const ok = async (p: Promise<{ status: string }>): Promise<boolean> =>
		(await p).status === 'applied';

	const text = (f: TaskDetails['priority']): string =>
		f.kind === 'own' || f.kind === 'inherited' ? f.text : '';
	const num = (f: TaskDetails['priority'], fallback: number | null): number | null => {
		if (f.kind === 'text-only') return null;
		const n = Number(text(f));
		return text(f) !== '' && Number.isFinite(n) ? n : fallback;
	};

	const scheduling = [
		{ value: '', label: S.scheduling.unset },
		{ value: 'asap', label: S.scheduling.asap },
		{ value: 'alap', label: S.scheduling.alap },
	];
	const people = $derived([
		{ value: '', label: S.responsibleNone },
		...(app.index ? assignable(app.index) : []).map((r) => ({ value: r.id, label: r.name })),
	]);
	const nameOf = (id: string): string => app.index?.resources.get(id)?.name ?? id;

	// Priority and progress step in a burst: every press sends the value it reaches (a `setAttr`
	// takes the whole value, so the dispatcher's later total replaces the earlier one).
	const stepper = (attr: 'priority' | 'complete') => {
		const key = `inspector:${attr}:${d.id}`;
		let last: Promise<{ status: string }> = Promise.resolve({ status: 'cancelled' });
		return {
			press: (total: number, base: number): void => {
				last = actions.edit(numberEdit(d, attr, base + total), key);
			},
			end: async (): Promise<boolean> => {
				actions.flush(key);
				return (await last).status === 'applied';
			},
			type: async (t: string): Promise<boolean> => {
				const n = Number(t.trim());
				if (!Number.isInteger(n)) return false;
				return ok(actions.edit(numberEdit(d, attr, n)));
			},
		};
	};
	const priority = $derived(stepper('priority'));
	const complete = $derived(stepper('complete'));

	const responsible = $derived(d.responsible.own[0] ?? '');
	const inheritedResponsible = $derived(d.responsible.inherited.map(nameOf).join(', '));

	// The milestone question (module comment).
	let asking = $state(false);
	let setEffort: HTMLButtonElement | undefined = $state();
	let milestoneBox: HTMLInputElement | undefined = $state();
	async function milestone(e: Event & { currentTarget: HTMLInputElement }): Promise<void> {
		const box = e.currentTarget;
		const on = box.checked;
		if (!on && d.openEndedIfSolid) {
			box.checked = true;
			asking = true;
			await tick();
			setEffort?.focus();
			return;
		}
		const o = await actions.edit(milestoneEdit(d, on));
		// A refused or unchanged edit puts the box back to what the plan says.
		if (o.status !== 'applied') box.checked = d.milestone;
	}
	async function clearMilestone(thenEffort: boolean): Promise<void> {
		asking = false;
		const o = await actions.edit(milestoneEdit(d, false));
		if (thenEffort && o.status === 'applied') app.inspector.sizeFocus++;
	}
	const bookedNames = $derived(d.booked.join(', '));
</script>

<div class="options">
	<div class="pair">
		<Field label={S.field.scheduling} state={d.scheduling} onshow={showInText}>
			{#snippet children({ id, disabled, describedby })}
				<Select
					{id}
					value={text(d.scheduling)}
					options={scheduling}
					{disabled}
					{describedby}
					onchange={(v) => ok(actions.edit(schedulingEdit(d, v)))}
				/>
			{/snippet}
		</Field>
		<Field
			label={S.field.responsible}
			state={d.responsible.textOnly
				? { kind: 'text-only', reason: 'macro-call', at: d.responsible.textOnly }
				: undefined}
			hint={d.responsible.inherited.length > 0
				? S.responsibleInherited(inheritedResponsible)
				: null}
			onshow={showInText}
		>
			{#snippet children({ id, disabled, describedby })}
				<Select
					{id}
					value={responsible}
					options={people}
					{disabled}
					{describedby}
					onchange={(v) => ok(actions.edit(responsibleEdit(d, v === '' ? null : v, nameOf(v))))}
				/>
			{/snippet}
		</Field>
	</div>

	<div class="pair">
		<Field
			label={S.field.priority}
			state={d.priority}
			hint={d.priority.kind === 'unset' ? S.priorityDefault : null}
			onshow={showInText}
		>
			{#snippet children({ id, disabled, describedby })}
				<Stepper
					{id}
					text={text(d.priority) || '500'}
					value={num(d.priority, 500)}
					format={String}
					min={1}
					max={1000}
					what={S.field.priority}
					{disabled}
					{describedby}
					onpress={priority.press}
					onend={priority.end}
					oncommit={priority.type}
				/>
			{/snippet}
		</Field>
		<Field
			label={S.field.complete}
			state={d.complete}
			off={d.container ? S.completeContainer : null}
			onshow={showInText}
		>
			{#snippet children({ id, disabled, describedby })}
				<Stepper
					{id}
					text={text(d.complete) || '0'}
					value={num(d.complete, 0)}
					format={String}
					min={0}
					max={100}
					step={5}
					what={S.field.complete}
					{disabled}
					{describedby}
					onpress={complete.press}
					onend={complete.end}
					oncommit={complete.type}
				/>
			{/snippet}
		</Field>
	</div>

	<div class="check">
		<input
			id="{uid}-milestone"
			bind:this={milestoneBox}
			type="checkbox"
			checked={d.milestone}
			disabled={d.container}
			aria-describedby="{uid}-milestone-hint"
			onchange={milestone}
		/>
		<label for="{uid}-milestone">{S.field.milestone}</label>
		<p id="{uid}-milestone-hint" class="note">{d.container ? S.size.container : S.milestoneHint}</p>
	</div>
	{#if asking}
		<!-- Escape drops the question; the group is not itself interactive. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="ask"
			role="group"
			aria-label={S.openEnded.title}
			onkeydown={(e) => {
				if (e.key === 'Escape') {
					e.preventDefault();
					asking = false;
					// Back to the box the question came from.
					milestoneBox?.focus();
				}
			}}
		>
			<p>{S.openEnded.ask(bookedNames)}</p>
			<div class="buttons">
				<button
					type="button"
					class="action"
					bind:this={setEffort}
					onclick={() => clearMilestone(true)}
				>
					{S.openEnded.setEffort}
				</button>
				<button type="button" class="action quiet" onclick={() => clearMilestone(false)}>
					{S.openEnded.changeAnyway}
				</button>
			</div>
		</div>
	{/if}

	<Field label={S.field.note} state={d.note} hint={S.noteHint} onshow={showInText}>
		{#snippet children({ id, disabled, describedby })}
			<CommitInput
				{id}
				value={text(d.note)}
				{disabled}
				{describedby}
				multiline
				placeholder={S.noNote}
				oncommit={async (t) => {
					const e = noteEdit(d, t);
					return e ? ok(actions.edit(e)) : false;
				}}
			/>
		{/snippet}
	</Field>
</div>

<style>
	.options {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.pair {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-3);
		align-items: start;
	}
	.check {
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: center;
		column-gap: var(--space-2);
	}
	.check input {
		inline-size: 24px;
		block-size: 24px;
		accent-color: var(--color-accent);
	}
	/* A touch target of 44 px: the label is the box's, so it is a press anywhere on the row. */
	@media (pointer: coarse) {
		.check {
			min-block-size: var(--size-tap);
		}
		.check input {
			inline-size: 28px;
			block-size: 28px;
		}
		.check label {
			display: flex;
			align-items: center;
			min-block-size: var(--size-tap);
			padding-inline-end: var(--space-4);
		}
	}
	.check .note {
		grid-column: 2;
	}
	.note {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
	.ask {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--color-ruby);
		border-radius: var(--radius-md);
		background: var(--color-ruby-wash);
		color: var(--color-ruby-ink);
		font-size: var(--text-sm);
	}
	.ask p {
		margin: 0;
	}
	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.action {
		min-block-size: var(--size-control);
		padding-inline: var(--space-4);
		border: 1px solid var(--color-ruby);
		border-radius: var(--radius-pill);
		background: var(--color-ruby-ink);
		color: var(--color-surface);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.action.quiet {
		background: var(--color-surface);
		color: var(--color-ruby-ink);
	}
	@media (max-width: 22rem) {
		.pair {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
