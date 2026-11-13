<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The people booked on a task (phase-2.md 9.3 "People chips"): the engine's allocations joined
	with the text's. A person written on this task can be replaced (R7, "Replace with…": a native
	picker laid over the chip, as the plan chip does) or removed (R6); one that comes from a parent
	task is listed and says so. A picker adds another person. The edits are the Gantt's own
	actions (`assign`, `unassign`, `replace-person`), so the toast and the undo entry read the same
	whichever view made them.
-->
<script lang="ts">
	import { assignable, type PersonFact, type TaskDetails } from '../../lib/inspector/task';
	import { inspectorStrings as S } from '../../lib/strings';
	import { getInspector } from './context';
	import Select from './Select.svelte';

	let { d }: { d: TaskDetails } = $props();
	const { app, actions } = getInspector();
	const uid = $props.id();

	const everyone = $derived(app.index ? assignable(app.index) : []);
	const here = $derived(new Set(d.people.map((p) => p.id)));
	const others = (p: PersonFact) => everyone.filter((r) => r.id !== p.id && !here.has(r.id));
	const free = $derived(everyone.filter((r) => !here.has(r.id)));

	const ok = async (p: Promise<{ status: string }>): Promise<boolean> =>
		(await p).status === 'applied';
	const remove = (p: PersonFact) =>
		ok(actions.action({ type: 'unassign', task: d.id, resource: p.id }));
	const replace = (p: PersonFact, to: string) =>
		to === '' ? false : ok(actions.action({ type: 'replace-person', task: d.id, from: p.id, to }));
	const add = (id: string) =>
		id === '' ? false : ok(actions.action({ type: 'assign', task: d.id, resource: id }));
</script>

<div class="people">
	{#if d.people.length === 0}
		<p class="none">{S.peopleNone}</p>
	{:else}
		<ul class="chips">
			{#each d.people as p (p.id)}
				<li class="chip" class:inherited={!p.own}>
					<span class="name">{p.name}</span>
					{#if p.own}
						{#if others(p).length > 0}
							<span class="replace">
								<span aria-hidden="true">⇄</span>
								<select
									aria-label={S.personReplace(p.name)}
									title={S.personReplace(p.name)}
									onchange={async (e) => {
										const select = e.currentTarget;
										await replace(p, select.value);
										select.value = '';
									}}
								>
									<option value="">{S.personReplace(p.name)}</option>
									{#each others(p) as r (r.id)}<option value={r.id}>{r.name}</option>{/each}
								</select>
							</span>
						{/if}
						<button
							type="button"
							class="x"
							aria-label={S.personRemove(p.name)}
							title={S.personRemove(p.name)}
							onclick={() => void remove(p)}>×</button
						>
					{:else}
						<span class="from">{S.personFromParent}</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
	{#if free.length > 0}
		<Select
			id="{uid}-add"
			label={S.personAdd}
			value=""
			options={[
				{ value: '', label: S.personAdd },
				...free.map((r) => ({ value: r.id, label: r.name })),
			]}
			onchange={add}
		/>
	{/if}
</div>

<style>
	.people {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-block-size: 28px;
		padding: 0 var(--space-1) 0 var(--space-3);
		border-radius: var(--radius-pill);
		background: var(--color-badge-bg);
		color: var(--color-badge-text);
		font-size: var(--text-sm);
	}
	.chip.inherited {
		padding-inline: var(--space-3);
		border: 1px dashed var(--color-border-strong);
		background: transparent;
	}
	.from,
	.none {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
	/* The picker is a real <select> over the glyph: it opens the native list, and its name is the
	   action ("Replace Ana with…"). */
	.replace {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		inline-size: 24px;
		block-size: 24px;
		border-radius: 50%;
	}
	.replace:hover {
		background: var(--color-row-hover);
	}
	.replace select {
		position: absolute;
		inset: 0;
		inline-size: 100%;
		block-size: 100%;
		opacity: 0;
		cursor: pointer;
	}
	.replace:focus-within {
		outline: 2px solid var(--color-focus);
		outline-offset: 1px;
	}
	.x {
		inline-size: 24px;
		block-size: 24px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 1.1rem;
		line-height: 1;
		cursor: pointer;
	}
	.x:hover {
		background: var(--color-row-hover);
	}
	.x:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 1px;
	}
	@media (pointer: coarse) {
		.x,
		.replace {
			inline-size: var(--size-tap);
			block-size: var(--size-tap);
		}
		.chip {
			min-block-size: var(--size-tap);
		}
	}
</style>
