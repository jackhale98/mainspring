<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	A task's links (phase-2.md 9.3 "Dependencies"): "Waits for" lists what the task depends on, each
	with a gap field (`setDependsGap`), Remove (R4, `unlink`) and a way into the link's own details;
	"Followed by" lists the tasks that wait for it. The links are the schedule's (the engine says
	which exist and their gaps) joined with the text's sites (which say where they are written and
	whether the editor can change them). A link written with a macro is shown and left to the text.
-->
<script lang="ts">
	import { gapEdit } from '../../lib/inspector/edit';
	import type { LinkFact } from '../../lib/inspector/links';
	import { inspectorStrings as S } from '../../lib/strings';
	import CommitInput from './CommitInput.svelte';
	import { getInspector } from './context';

	let { waitsFor, followedBy }: { waitsFor: readonly LinkFact[]; followedBy: readonly LinkFact[] } =
		$props();
	const { actions, showInText, openTask, openLink } = getInspector();
	const uid = $props.id();

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

<div class="deps">
	<h4>{S.section.waitsFor}</h4>
	{#if waitsFor.length === 0}
		<p class="none">{S.dependency.none}</p>
	{:else}
		<ul>
			{#each waitsFor as l, n (`${l.pred}>${l.succ}`)}
				{@render row(l, l.predName, l.pred, true, n)}
			{/each}
		</ul>
	{/if}
	<h4>{S.section.followedBy}</h4>
	{#if followedBy.length === 0}
		<p class="none">{S.dependency.none}</p>
	{:else}
		<ul>
			{#each followedBy as l, n (`${l.pred}>${l.succ}`)}
				{@render row(l, l.succName, l.succ, false, n)}
			{/each}
		</ul>
	{/if}
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
