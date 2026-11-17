<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	One leave in the day details (phase-3.md 7.1 W5, 9.5): its type, name and first and last day as
	fields, and Remove. A field commits as the inspector's do (Phase 2): the type and the dates when
	they change, the name on Enter or when it loses the focus. Each commit is one edit through the
	dispatcher (`oncommit`), so it is one undo step with its toast. The owner answers with why the
	fields cannot be written (a last day before the first, a date outside 1970 to 2035), which shows
	under them; the edit API's refusals (a macro, a shared declaration, a split vacation) come as the
	dispatcher's toast with "Show in text".

	The fields are a draft of what the text says now: when the item changes (the text changed, an
	undo) they are read again. A leave that does not run over whole days, or a project leave, has no
	fields: "Edit as text".
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { CommitResult, LeaveFields } from '../../lib/calendar/leave-edit';
	import type { PaintItem } from '../../lib/calendar/paint-items';
	import { calendarStrings as C, leavePaintStrings as L } from '../../lib/strings';
	import type { LeaveType } from '../../lib/tjp/edit/types';
	import Icon from '../Icon.svelte';

	interface Props {
		item: PaintItem;
		/** The item's fields now; null when only the text can edit it. */
		fields: LeaveFields | null;
		/** The types the item can be changed to (`typesOfItem`): its scope's, and its own kind. */
		types: readonly LeaveType[];
		/**
		 * Commits a change. The answer says why it cannot be written, or whether an edit was applied
		 * (the card then waits for the text to be read again before it takes another).
		 */
		oncommit: (item: PaintItem, f: LeaveFields) => Promise<CommitResult>;
		onremove: (item: PaintItem) => void;
	}
	let { item, fields, types, oncommit, onremove }: Props = $props();

	const D = C.details;
	let draft = $state<LeaveFields | null>(null);
	let error = $state<'empty' | 'dates' | 'range' | null>(null);
	/** An edit was sent and the text has not been read again: no second edit on a stale item. */
	let busy = $state(false);
	/** Changes made while busy: the latest of each field, sent once the text has been read again. */
	let queued = $state.raw<Partial<LeaveFields> | null>(null);
	let wait: ReturnType<typeof setTimeout> | null = null;
	const settle = (): void => {
		busy = false;
		if (wait !== null) clearTimeout(wait);
		wait = null;
		const q = queued;
		queued = null;
		if (q) void commit(q);
	};
	onMount(() => () => {
		queued = null;
		if (wait !== null) clearTimeout(wait);
	});
	// The draft follows the text: a new item, or the same one after an edit or an undo. It is read
	// again when the fields change, not each time the owner builds them.
	const key = $derived(fields ? `${fields.type}|${fields.name}|${fields.start}|${fields.end}` : '');
	$effect(() => {
		void key;
		untrack(() => {
			draft = fields ? { ...fields } : null;
			error = null;
			settle();
		});
	});

	const title = $derived(C.leave(L.type[item.type], item.name));
	const fixed = $derived(item.type === 'project');

	/**
	 * Writes a field into the draft and commits it. While an edit waits for the text to be read
	 * again the change is queued (and shown as waiting), then sent on the new text: it is not lost
	 * and the item it names is not stale.
	 */
	async function commit(patch: Partial<LeaveFields> = {}): Promise<void> {
		if (!draft) return;
		draft = { ...draft, ...patch };
		if (busy) {
			queued = { ...queued, ...patch };
			return;
		}
		busy = true;
		const r = await oncommit(item, draft);
		error = r.error ?? null;
		if (r.applied) wait = setTimeout(settle, 2500);
		else settle();
	}
</script>

<li class="card" data-testid="cal-leave" data-type={item.type} aria-busy={busy}>
	<p class="head">{title}</p>
	{#if draft && !fixed}
		<div class="fields">
			<label>
				<span>{D.typeLabel}</span>
				<select
					value={draft.type}
					onchange={(e) => commit({ type: e.currentTarget.value as LeaveType })}
					data-testid="cal-leave-type"
				>
					{#each types as t (t)}<option value={t}>{L.type[t]}</option>{/each}
				</select>
			</label>
			<label>
				<span>{D.name}</span>
				<input
					type="text"
					value={draft.name}
					placeholder={D.namePlaceholder}
					onblur={(e) => commit({ name: e.currentTarget.value })}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							commit({ name: e.currentTarget.value });
						}
					}}
					data-testid="cal-leave-name"
				/>
			</label>
			<label>
				<span>{D.start}</span>
				<input
					type="date"
					value={draft.start}
					onchange={(e) => commit({ start: e.currentTarget.value })}
					data-testid="cal-leave-start"
				/>
			</label>
			<label>
				<span>{D.end}</span>
				<input
					type="date"
					value={draft.end}
					onchange={(e) => commit({ end: e.currentTarget.value })}
					data-testid="cal-leave-end"
				/>
			</label>
		</div>
		{#if error}<p class="error" role="alert">{D.errors[error]}</p>{/if}
		{#if busy && queued}<p class="note" role="status" data-testid="cal-leave-waiting">
				{D.waiting}
			</p>{/if}
		<button
			type="button"
			class="remove"
			aria-label={D.removeNamed(title)}
			onclick={() => onremove(item)}
			data-testid="cal-leave-remove"
		>
			<Icon name="close" size={14} />{D.remove}
		</button>
	{:else}
		<p class="note">{fixed ? D.fixed : C.textOnly}</p>
	{/if}
</li>

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface-sunken);
		list-style: none;
	}
	.head {
		margin: 0;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.fields {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-2);
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-inline-size: 0;
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
	select,
	input {
		box-sizing: border-box;
		inline-size: 100%;
		min-block-size: var(--size-control);
		padding-inline: var(--space-2);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
	}
	select:focus-visible,
	input:focus-visible,
	.remove:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
	.remove {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-block-size: var(--size-control);
		padding-inline: var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-ruby-ink);
		font: inherit;
		font-size: var(--text-xs);
		cursor: pointer;
	}
	.error,
	.note {
		margin: 0;
		font-size: var(--text-xs);
	}
	.error {
		color: var(--color-ruby-ink);
	}
	.note {
		color: var(--color-text-muted);
	}
</style>
