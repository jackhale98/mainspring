<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	A person's details (phase-3.md 9.6, 7.1 W6 to W8): name and id, group, efficiency (a stepper in
	0.05 steps), rate, e-mail, managers, working hours, leaves and the tasks booked. It only draws what
	lib/resources/person.ts read and sends what the person changes through the edit dispatcher; it
	never changes the schedule. A person declared with a macro is shown read-only with the way to their
	text.

	Fields follow the Phase 2 rules: an inherited value says where from (and a value typed here is
	written on the person itself), a text-only one is off with its reason and "Show in text", and every
	field commits on Enter or blur. The efficiency stepper coalesces its presses into one edit (key
	`res:<id>:efficiency`, the cumulative value), so a burst is one undo step. The Group select is the
	same move as dragging the row in the table (`planGroupSelect`), refused as `not-a-group` for a
	person that tasks are allocated to.
-->
<script lang="ts">
	import { runIntent } from '../../lib/calendar/run';
	import { weekOf } from '../../lib/resources/hours';
	import {
		deleteEdit,
		efficiencyEdit,
		emailEdit,
		parseAmount,
		rateEdit,
		renameEdit,
	} from '../../lib/resources/person-edit';
	import type { PersonDetails } from '../../lib/resources/person';
	import { groupChoices, planGroupSelect } from '../../lib/resources/regroup';
	import { readBeforeOf, sameFileBefore } from '../../lib/resources/sites';
	import { hoursText } from '../../lib/resources/rows';
	import { inspectorStrings as S } from '../../lib/strings';
	import { resourceStrings as R } from '../../lib/strings-resources';
	import CommitInput from './CommitInput.svelte';
	import { getInspector } from './context';
	import Field from './Field.svelte';
	import ManagersField from './ManagersField.svelte';
	import ResourceLeaves from './ResourceLeaves.svelte';
	import Select from './ResourceSelect.svelte';
	import Stepper from './Stepper.svelte';
	import WorkingHoursEditor from './WorkingHoursEditor.svelte';

	interface Props {
		d: PersonDetails;
		/** Opens the Calendar with this person (the shell's). */
		onaddleave: () => void;
	}
	let { d, onaddleave }: Props = $props();
	const { app, actions, showInText } = getInspector();
	const F = R.details.field;
	const uid = $props.id();

	const ok = async (p: Promise<{ status: string }>): Promise<boolean> =>
		(await p).status === 'applied';
	const text = (f: PersonDetails['efficiency']): string =>
		f.kind === 'own' || f.kind === 'inherited' ? f.text : '';

	// The name as a value of its own: `d` is a new object whenever the details are read again.
	const name = $derived(d.name);
	const rename = async (typed: string): Promise<boolean> => {
		const t = typed.trim();
		if (t === '' || t === d.name) return false;
		const e = renameEdit(d.id, d.name, t);
		return ok(actions.edit(e));
	};

	// --- Group
	const index = $derived(app.index);
	const groups = $derived(
		index
			? [
					{ value: '', label: R.details.groupNone },
					...groupChoices(index, d.id).map((g) => ({
						value: g.id,
						label: `${'– '.repeat(g.level)}${g.name}`,
					})),
				]
			: [{ value: '', label: R.details.groupNone }],
	);
	const regroup = async (to: string): Promise<boolean> => {
		const edits = app.edits;
		const ix = app.index;
		if (!edits || !ix) return false;
		const plan = planGroupSelect(ix, d.id, to === '' ? null : to);
		if (plan.status === 'not-possible') {
			edits.refuse(plan.message, plan.at, ix.version);
			return false;
		}
		const o = await runIntent(edits, plan.intent, plan.label, (m) => globalThis.confirm(m));
		return o.status === 'applied';
	};

	// --- Efficiency: presses make a burst, each sending the value it reaches.
	const effKey = $derived(`res:${d.id}:efficiency`);
	let last: Promise<{ status: string }> = Promise.resolve({ status: 'cancelled' });
	const efficiency = {
		press: (total: number, base: number): void => {
			last = actions.edit(efficiencyEdit(d, Math.max(0, base + total)), effKey);
		},
		end: async (): Promise<boolean> => {
			actions.flush(effKey);
			return (await last).status === 'applied';
		},
		type: async (typed: string): Promise<boolean> => {
			const n = parseAmount(typed);
			return n === null ? false : ok(actions.edit(efficiencyEdit(d, n)));
		},
	};
	const effText = $derived(text(d.efficiency) || '1');
	const effValue = $derived.by(() => {
		if (d.efficiency.kind === 'text-only') return null;
		const n = Number(effText);
		return Number.isFinite(n) ? n : 1;
	});

	// --- Rate and e-mail
	let rateProblem = $state(false);
	const rate = async (typed: string): Promise<boolean> => {
		const e = rateEdit(d, typed);
		rateProblem = e === null;
		return e === null ? false : ok(actions.edit(e));
	};
	const email = async (typed: string): Promise<boolean> => {
		const e = emailEdit(d, typed);
		return e === null ? false : ok(actions.edit(e));
	};

	const week = $derived(
		index
			? weekOf(
					index,
					{ kind: 'resource', resource: d.id },
					app.workspace ? readBeforeOf(app.workspace.snapshot().includes) : sameFileBefore,
				)
			: null,
	);

	async function remove(): Promise<void> {
		const e = deleteEdit(d.id, d.name, app.index);
		if (await ok(actions.edit(e))) app.selection.clear();
	}
	const locked = $derived(d.declaration !== null);
</script>

<div class="person" data-testid="person-details">
	{#if locked}
		<p class="notice">{R.details.declarationTextOnly}</p>
	{/if}
	<Field label={F.name}>
		{#snippet children({ id, disabled, describedby })}
			<CommitInput
				{id}
				value={name}
				disabled={disabled || locked}
				{describedby}
				oncommit={rename}
			/>
		{/snippet}
	</Field>
	<p class="id"><span class="k">{F.id}</span> <code>{d.id}</code></p>

	<Field label={F.group}>
		{#snippet children({ id, disabled, describedby })}
			<Select
				{id}
				value={d.group?.id ?? ''}
				options={groups}
				disabled={disabled || locked}
				{describedby}
				onchange={regroup}
			/>
		{/snippet}
	</Field>

	<div class="pair">
		<Field
			label={F.efficiency}
			state={d.efficiency}
			hint={d.efficiency.kind === 'unset' ? R.details.efficiencyHint : null}
			onshow={showInText}
		>
			{#snippet children({ id, disabled, describedby })}
				<Stepper
					{id}
					text={effText}
					value={effValue}
					format={(n) => String(Math.round(n * 100) / 100)}
					min={0}
					step={0.05}
					what={F.efficiency}
					disabled={disabled || locked}
					{describedby}
					onpress={efficiency.press}
					onend={efficiency.end}
					oncommit={efficiency.type}
				/>
			{/snippet}
		</Field>
		<Field
			label={F.rate}
			state={d.rate}
			hint={rateProblem ? R.details.rateInvalid : R.details.rateHint}
			onshow={showInText}
		>
			{#snippet children({ id, disabled, describedby })}
				<CommitInput
					{id}
					value={text(d.rate)}
					disabled={disabled || locked}
					{describedby}
					mono
					inputmode="decimal"
					oncommit={rate}
				/>
			{/snippet}
		</Field>
	</div>
	<Field label={F.email} state={d.email} hint={R.details.emailHint} onshow={showInText}>
		{#snippet children({ id, disabled, describedby })}
			<CommitInput
				{id}
				value={text(d.email)}
				disabled={disabled || locked}
				{describedby}
				oncommit={email}
			/>
		{/snippet}
	</Field>

	<section aria-labelledby="{uid}-managers">
		<h3 id="{uid}-managers">{F.managers}</h3>
		<ManagersField {d} />
	</section>

	{#if week}
		<section aria-label={R.details.section.hours}>
			<WorkingHoursEditor
				scope={{ kind: 'resource', resource: d.id }}
				who={d.name}
				reading={week}
				from={d.group?.name ?? null}
			/>
		</section>
	{/if}

	<section aria-labelledby="{uid}-leaves">
		<h3 id="{uid}-leaves">{R.details.section.leaves}</h3>
		<ResourceLeaves id={d.id} name={d.name} onadd={onaddleave} />
	</section>

	<section aria-labelledby="{uid}-booked">
		<h3 id="{uid}-booked">{R.details.section.booked}</h3>
		{#if d.booked.length === 0}
			<p class="none">{R.details.booked.none}</p>
		{:else}
			<ul class="booked">
				{#each d.booked as t (t.id)}
					<li>{R.details.booked.item(t.name, hoursText(t.minutes))}</li>
				{/each}
			</ul>
			<p class="none">{R.details.booked.total(hoursText(d.bookedMinutes))}</p>
		{/if}
	</section>

	<div class="source">
		<button type="button" class="button" onclick={() => showInText(d.sym.decl.header)}>
			{S.showInText}
		</button>
		<button type="button" class="button danger" data-testid="person-delete" onclick={remove}>
			{d.isGroup ? R.details.delGroup : R.details.del}
		</button>
	</div>
	<p class="none">{R.details.delHint}</p>
</div>

<style>
	.person {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-block-start: var(--space-3);
		border-block-start: 1px solid var(--color-border);
	}
	h3 {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 600;
	}
	.pair {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: var(--space-3);
	}
	.id {
		display: flex;
		gap: var(--space-2);
		align-items: baseline;
		margin: 0;
		font-size: var(--text-sm);
	}
	.id .k {
		color: var(--color-text-muted);
		font-size: var(--text-label);
		font-weight: 600;
	}
	code {
		font-family: var(--font-mono);
		overflow-wrap: anywhere;
	}
	.notice {
		margin: 0;
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: var(--color-surface-sunken);
		font-size: var(--text-sm);
	}
	.none {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	.booked {
		margin: 0;
		padding-inline-start: var(--space-4);
		font-size: var(--text-sm);
	}
	.source {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		padding-block-start: var(--space-3);
		border-block-start: 1px solid var(--color-border);
	}
	.button {
		min-block-size: var(--size-control);
		padding-inline: var(--space-4);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.button:hover {
		background: var(--color-row-hover);
	}
	.button:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 1px;
	}
</style>
