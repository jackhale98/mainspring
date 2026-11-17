<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The dependency picker (polish item 11): the searchable list of tasks that opens under "Waits for"
	or "Followed by" in a task's details. A lazy chunk, fetched when an Add button is first pressed
	(DependencyList.svelte), with its copy in strings-depends.ts. An ARIA combobox: the search box
	keeps the focus; Up and Down move the active option (`aria-activedescendant`) over the enabled
	ones and wrap, Enter chooses it, Escape closes and gives the focus back to the Add button.
	Typing narrows the list by name, id or outline path (depends-picker.ts has the rules, the
	candidates and the contract for the Health panel). A task that can only be refused (its container,
	a task inside it, one already linked, one declared by a macro) is listed but disabled, with its
	reason, instead of hidden. A press on a row chooses it: the picker sends the `link` action to
	`act`, which goes through the edit dispatcher (one undo step, the toast, the refusals); the
	picker closes when the link was written, and stays open, saying so, when it was refused. It
	changes nothing itself. Rows are 44 px under a coarse pointer (`--size-row`).
-->
<script lang="ts">
	import { tick } from 'svelte';
	import {
		dependsCandidates,
		filterCandidates,
		linkAction,
		stepEnabled,
		type Candidate,
		type PickRole,
	} from '../../lib/inspector/depends-picker';
	import type { GanttAction } from '../../lib/gantt/intents';
	import type { Outline } from '../../lib/state/outline';
	import { dependsPickerStrings as S } from '../../lib/strings-depends';
	import type { TaskId } from '../../lib/tjp/index';

	interface Props {
		id: string;
		open: boolean;
		role: PickRole;
		task: TaskId;
		outline: Outline;
		/** The tasks already linked in this role (they are listed, disabled). */
		linked: ReadonlySet<TaskId>;
		/** Sends the `link` action through the dispatcher; resolves whether the link was written. */
		act: (action: GanttAction) => Promise<boolean>;
		/** Escape, or the link written (`refocus`: the Add button takes the focus back). */
		onclose: (refocus: boolean) => void;
	}
	let { id, open, role, task, outline, linked, act, onclose }: Props = $props();

	/** A long plan lists this many at once; typing narrows the rest. */
	const LIMIT = 100;

	let query = $state('');
	let active = $state(-1);
	let refused = $state(false);
	let busy = false;
	let input: HTMLInputElement | undefined = $state();
	let list: HTMLUListElement | undefined = $state();

	const all = $derived(open ? dependsCandidates(outline, task, linked) : []);
	const matches = $derived(filterCandidates(all, query));
	const shown = $derived(matches.slice(0, LIMIT));
	/** The active option: the one the arrows chose, else the first that can be chosen. */
	const current = $derived(
		active >= 0 && shown[active]?.disabled === null ? active : stepEnabled(shown, -1, 1),
	);
	const optionId = (c: Candidate): string => `${id}-opt-${c.id}`;

	$effect(() => {
		if (!open) return;
		query = '';
		active = -1;
		refused = false;
		void tick().then(() => input?.focus());
	});
	$effect(() => {
		// Keep the active option in view as the arrows move.
		if (current >= 0) list?.children[current]?.scrollIntoView({ block: 'nearest' });
	});

	async function choose(c: Candidate): Promise<void> {
		if (c.disabled !== null || busy) return;
		busy = true;
		try {
			if (await act(linkAction(role, task, c.id))) onclose(true);
			else refused = true;
		} finally {
			busy = false;
		}
	}
	function onkeydown(e: KeyboardEvent): void {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			active = stepEnabled(shown, current, e.key === 'ArrowDown' ? 1 : -1);
		} else if (e.key === 'Enter') {
			const c = shown[current];
			if (c) void choose(c);
		} else if (e.key === 'Escape') {
			// The details close on Escape too (a drawer): this one is the picker's.
			e.stopPropagation();
			onclose(true);
		} else return;
		e.preventDefault();
	}
	function onfocusout(e: FocusEvent): void {
		const to = e.relatedTarget;
		// Focus moving to another control closes the list; a press on a row (no focus move) does not,
		// and neither does one on an Add button, which closes it itself.
		if (!(to instanceof Element) || (e.currentTarget as Node).contains(to)) return;
		if (to.closest('[data-depends-add]') === null) onclose(false);
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="picker" {id} data-testid="depends-picker" data-role={role} {onfocusout}>
		<input
			bind:this={input}
			bind:value={query}
			type="text"
			role="combobox"
			autocomplete="off"
			spellcheck="false"
			aria-expanded="true"
			aria-controls="{id}-list"
			aria-autocomplete="list"
			aria-activedescendant={shown[current] ? optionId(shown[current]) : undefined}
			aria-describedby="{id}-status"
			aria-label={S.searchLabel[role]}
			placeholder={S.searchPlaceholder}
			oninput={() => {
				active = -1;
				refused = false;
			}}
			{onkeydown}
		/>
		<ul id="{id}-list" role="listbox" aria-label={S.listLabel} bind:this={list}>
			{#each shown as c, i (c.id)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					id={optionId(c)}
					role="option"
					aria-selected={i === current}
					aria-disabled={c.disabled !== null ? 'true' : undefined}
					class:active={i === current}
					class:off={c.disabled !== null}
					data-task={c.id}
					onmousedown={(e) => e.preventDefault()}
					onclick={() => void choose(c)}
				>
					<span class="line">
						<span class="name">{c.name}</span>
						<code class="id">{c.id}</code>
					</span>
					{#if c.path !== '' || c.disabled !== null}
						<span class="sub">
							{#if c.path !== ''}<span class="path">{c.path}</span>{/if}
							{#if c.disabled !== null}<span class="why">{S.reason[c.disabled]}</span>{/if}
						</span>
					{/if}
				</li>
			{/each}
		</ul>
		<p class="status" id="{id}-status" role="status">
			{#if refused}{S.refused}{:else if matches.length === 0}{S.noMatch(
					query.trim(),
				)}{:else}{S.count(shown.length, matches.length)}{/if}
		</p>
	</div>
{/if}

<style>
	.picker {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-2);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}
	input {
		box-sizing: border-box;
		inline-size: 100%;
		min-block-size: var(--size-control);
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		background: var(--color-surface-sunken);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
	}
	input:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 1px;
	}
	[role='listbox'] {
		display: grid;
		max-block-size: min(16rem, 40vh);
		margin: 0;
		padding: 0;
		overflow-y: auto;
		list-style: none;
	}
	[role='option'] {
		display: grid;
		align-content: center;
		gap: 1px;
		min-block-size: var(--size-row);
		padding: 2px var(--space-2);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		font-size: var(--text-sm);
		cursor: pointer;
	}
	[role='option'].active {
		background: var(--color-row-hover);
		box-shadow: inset 3px 0 0 var(--color-accent);
	}
	[role='option'].off {
		cursor: default;
	}
	.line {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		min-inline-size: 0;
	}
	.name {
		min-inline-size: 0;
		overflow-wrap: anywhere;
	}
	.off .name {
		color: var(--color-text-muted);
	}
	.id {
		margin-inline-start: auto;
		color: var(--color-text-muted);
		font-family: var(--font-mono, monospace);
		font-size: var(--text-xs);
		overflow-wrap: anywhere;
		text-align: end;
	}
	.sub {
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--space-2);
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
	.why {
		font-style: italic;
	}
	.status {
		margin: 0;
		padding-inline: var(--space-1);
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
</style>
