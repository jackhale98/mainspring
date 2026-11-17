<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	A task's links (phase-2.md 9.3 "Dependencies"): "Waits for" lists what the task depends on, each
	with a gap field (`setDependsGap`), Remove (R4, `unlink`) and a way into the link's own details;
	"Followed by" lists the tasks that wait for it. The links are the schedule's (the engine says
	which exist and their gaps) joined with the text's sites (which say where they are written and
	whether the editor can change them). A link written with a macro is shown and left to the text.
	Each heading has an Add button that opens the dependency picker (polish item 11).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import type { GanttAction } from '../../lib/gantt/intents';
	import type { PickRole } from '../../lib/inspector/depends-picker';
	import { gapEdit } from '../../lib/inspector/edit';
	import type { LinkFact } from '../../lib/inspector/links';
	import { inspectorStrings as S } from '../../lib/strings';
	import type { TaskId } from '../../lib/tjp/index';
	import Icon from '../Icon.svelte';
	import LazyMount from '../app/LazyMount.svelte';
	import CommitInput from './CommitInput.svelte';
	import { getInspector } from './context';

	interface Props {
		/** The task whose links these are. */
		task: TaskId;
		waitsFor: readonly LinkFact[];
		followedBy: readonly LinkFact[];
	}
	let { task, waitsFor, followedBy }: Props = $props();
	const { app, actions, showInText, openTask, openLink } = getInspector();
	const uid = $props.id();

	// The Add buttons open the dependency picker (DependsPicker.svelte, a lazy chunk fetched when
	// one is first pressed). One is open at a time; Escape and a made link close it and give the
	// focus back to its button. The Health panel asks for one through `app.openDependencyPicker`.
	let open = $state<PickRole | null>(null);
	let failed = $state(false);
	const buttons: Partial<Record<PickRole, HTMLButtonElement>> = $state({});
	const linked = $derived({
		predecessor: new Set<TaskId>(waitsFor.map((l) => l.pred)),
		successor: new Set<TaskId>(followedBy.map((l) => l.succ)),
	});
	const act = async (a: GanttAction): Promise<boolean> =>
		(await actions.action(a)).status === 'applied';
	function toggle(role: PickRole): void {
		failed = false;
		open = open === role ? null : role;
	}
	function close(role: PickRole, refocus: boolean): void {
		if (open === role) open = null;
		if (refocus) buttons[role]?.focus();
	}
	$effect(() => {
		const p = app.inspector.pick;
		if (!p || p.task !== task) return;
		untrack(() => {
			// A request the selection has left is dropped, not shown.
			if (p.serial === app.selection.serial) {
				failed = false;
				open = p.role;
			}
			app.inspector.pick = null;
		});
	});

	const ok = async (p: Promise<{ status: string }>): Promise<boolean> =>
		(await p).status === 'applied';
	const remove = (l: LinkFact) => ok(actions.action({ type: 'unlink', link: l.ref }));
	const setGap = (l: LinkFact) => (text: string) =>
		ok(actions.edit(gapEdit(l, l.gap?.kind ?? 'gaplength', text)));
	const textAt = (l: LinkFact) => l.ref.sites.find((s) => s.textOnly)?.statement ?? null;
</script>

{#snippet row(l: LinkFact, other: string, otherId: string, gap: boolean, n: number)}
	<li class="row">
		<div class="head">
			<button type="button" class="name" onclick={() => openTask(otherId)}>{other}</button>
			<!-- The TaskJuggler id, as the table's Predecessors and Successors cells show on hover. -->
			<code class="id">{otherId}</code>
			{#if l.state === 'pending'}<span class="tag">{S.dependency.pending}</span>{/if}
		</div>
		{#if !l.editable}
			{@const at = textAt(l)}
			<p class="note">{S.dependency.engineOnly}</p>
			{#if at}
				<button type="button" class="link" onclick={() => showInText(at)}>
					{S.showInText}
				</button>
			{/if}
		{/if}
		<div class="tools">
			{#if gap}
				<div class="gap">
					<CommitInput
						id="{uid}-gap-{n}"
						value={l.gap?.text ?? ''}
						label={S.dependency.gapFor(other)}
						placeholder={S.dependency.gapPlaceholder}
						disabled={!l.editable}
						mono
						oncommit={setGap(l)}
					/>
				</div>
			{/if}
			<button type="button" class="tool" onclick={() => openLink(l.pred, l.succ)}>
				{S.dependency.details}
				<span class="sr-only">: {S.dependency.open(other)}</span>
			</button>
			{#if gap}
				<button
					type="button"
					class="tool"
					disabled={!l.editable}
					aria-label={S.dependency.remove(other)}
					onclick={() => void remove(l)}
				>
					{S.dependency.removeLink}
				</button>
			{/if}
		</div>
	</li>
{/snippet}

{#snippet head(role: PickRole, title: string, label: string)}
	<div class="head-row">
		<h4>{title}</h4>
		<button
			type="button"
			class="add"
			data-depends-add={role}
			aria-label={label}
			aria-expanded={open === role}
			aria-controls={open === role ? `${uid}-${role}` : undefined}
			bind:this={buttons[role]}
			onclick={() => toggle(role)}
		>
			<Icon name="plus" size={14} stroke={2.2} />
			{S.dependency.add}
		</button>
	</div>
	<LazyMount
		when={open !== null}
		load={() => import('./DependsPicker.svelte')}
		props={{
			id: `${uid}-${role}`,
			open: open === role,
			role,
			task,
			outline: app.outline,
			linked: linked[role],
			act,
			onclose: (refocus: boolean) => close(role, refocus),
		}}
		onfail={() => {
			open = null;
			failed = true;
		}}
	/>
{/snippet}

<div class="deps">
	{@render head('predecessor', S.section.waitsFor, S.dependency.addWaitsFor)}
	{#if waitsFor.length === 0}
		<p class="none">{S.dependency.none}</p>
	{:else}
		<ul>
			{#each waitsFor as l, n (`${l.pred}>${l.succ}`)}
				{@render row(l, l.predName, l.pred, true, n)}
			{/each}
		</ul>
	{/if}
	{@render head('successor', S.section.followedBy, S.dependency.addFollowedBy)}
	{#if followedBy.length === 0}
		<p class="none">{S.dependency.none}</p>
	{:else}
		<ul>
			{#each followedBy as l, n (`${l.pred}>${l.succ}`)}
				{@render row(l, l.succName, l.succ, false, n)}
			{/each}
		</ul>
	{/if}
	{#if failed}<p class="none" role="status">{S.dependency.pickerFailed}</p>{/if}
</div>

<style>
	.deps {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	h4 {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--text-label);
		font-weight: 600;
		letter-spacing: 0.02em;
	}
	.head-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.add {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-block-size: var(--size-control);
		padding-inline: var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.add:hover {
		background: var(--color-row-hover);
	}
	.add[aria-expanded='true'] {
		border-color: var(--color-accent);
		box-shadow: inset 0 0 0 1px var(--color-accent);
	}
	ul {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.row {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface-sunken);
	}
	.head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-inline-size: 0;
	}
	.name {
		min-block-size: 24px;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--color-accent);
		font: inherit;
		font-weight: 600;
		text-align: start;
		text-decoration: underline;
		cursor: pointer;
		overflow-wrap: anywhere;
	}
	.id {
		color: var(--color-text-muted);
		font-family: var(--font-mono, monospace);
		font-size: var(--text-xs);
		overflow-wrap: anywhere;
	}
	.tag,
	.note,
	.none {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
	.tools {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.gap {
		flex: 1 1 6rem;
		min-inline-size: 5rem;
	}
	.tool {
		min-block-size: var(--size-control);
		padding-inline: var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.tool:disabled {
		color: var(--color-text-muted);
		cursor: default;
	}
	.name:focus-visible,
	.add:focus-visible,
	.tool:focus-visible,
	.link:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 1px;
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
	.sr-only {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
	@media (pointer: coarse) {
		.name,
		.link {
			min-block-size: var(--size-tap);
		}
	}
</style>
