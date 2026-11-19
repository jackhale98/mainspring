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
	undo) they are read again, except while this card's own edit is in flight. A leave that does not
	run over whole days, or a project leave, has no fields: "Edit as text".

	A commit goes out at once, on a reference to the item (its range and the index version it was
	read in; the dispatcher maps it to the text now, ADR-0018), so nothing waits for the index to be
	read again. Only while the card's own edit is in flight are changes merged; they go out when its
	outcome arrives, on the item as that edit wrote it (`CommitResult.ref`) while the index is older
	than that edit, else on the card's own item. Remove is disabled only while an edit is in flight.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import {
		refOf,
		type CommitResult,
		type FieldError,
		type LeaveFields,
	} from '../../lib/calendar/leave-edit';
	import type { PaintItem } from '../../lib/calendar/paint-items';
	import { calendarStrings as C, leavePaintStrings as L } from '../../lib/strings-calendar';
	import type { LeaveRef, LeaveType } from '../../lib/tjp/edit/types';
	import Icon from '../Icon.svelte';
	import Select from '../ui/Select.svelte';

	interface Props {
		item: PaintItem;
		/** The item's fields now; null when only the text can edit it. */
		fields: LeaveFields | null;
		/** The types the item can be changed to (`typesOfItem`): its scope's, and its own kind. */
		types: readonly LeaveType[];
		/**
		 * Commits a change to the item `ref` names. The answer says why it cannot be written, or that
		 * an edit was applied and where it wrote the item.
		 */
		oncommit: (ref: LeaveRef, f: LeaveFields) => Promise<CommitResult>;
		onremove: (ref: LeaveRef) => Promise<void> | void;
	}
	let { item, fields, types, oncommit, onremove }: Props = $props();

	const D = C.details;
	let draft = $state<LeaveFields | null>(null);
	let error = $state<FieldError | null>(null);
	/** The card's own edit is in flight: the changes made meanwhile are merged into `queued`. */
	let busy = $state(false);
	let queued = false;
	/** The fields as the card last sent them, or as the text had them: a commit of these is nothing. */
	let known: LeaveFields | null = null;
	/** The item as the card's last applied edit wrote it; newer than `item` until the index catches up. */
	let wrote: LeaveRef | null = null;
	const same = (a: LeaveFields, b: LeaveFields): boolean =>
		a.type === b.type && a.name.trim() === b.name.trim() && a.start === b.start && a.end === b.end;
	// The item to name now: the one the card's last edit wrote, until the index has read it.
	const target = (): LeaveRef => {
		const own = refOf(item);
		return wrote && wrote.basedOn > own.basedOn ? wrote : own;
	};
	// The draft follows the text: a new item, or the same one after an edit or an undo. It is read
	// again when the fields change, not each time the owner builds them, and not while an edit of
	// this card is in flight (the draft then holds what was typed since).
	const key = $derived(fields ? `${fields.type}|${fields.name}|${fields.start}|${fields.end}` : '');
	$effect(() => {
		void key;
		untrack(() => {
			if (busy) return;
			draft = fields ? { ...fields } : null;
			known = fields ? { ...fields } : null;
			error = null;
		});
	});

	const title = $derived(C.leave(L.type[item.type], item.name));
	const fixed = $derived(item.type === 'project');

	/**
	 * Writes a field into the draft and commits it at once. While the card's own edit is in flight
	 * the change only joins the draft: it goes out when that outcome arrives, on the item as it wrote
	 * it, so it is neither lost nor sent on an old range.
	 */
	async function commit(patch: Partial<LeaveFields> = {}): Promise<void> {
		if (!draft) return;
		draft = { ...draft, ...patch };
		if (busy) {
			queued = true;
			return;
		}
		busy = true;
		try {
			do {
				queued = false;
				const f = { ...draft };
				if (known && same(known, f)) break;
				const r = await oncommit(target(), f);
				error = r.error ?? null;
				if (r.applied) {
					known = f;
					if (r.ref) wrote = r.ref;
				} else if (r.refused || r.error) break; // one action, one message
			} while (queued && draft);
		} finally {
			busy = false;
		}
	}

	async function remove(): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await onremove(target());
		} finally {
			busy = false;
		}
	}
</script>

<li class="card" data-testid="cal-leave" data-type={item.type} aria-busy={busy}>
	<p class="head">{title}</p>
	{#if draft && !fixed}
		<div class="fields">
			<label>
				<span>{D.typeLabel}</span>
				<Select
					size="sm"
					value={draft.type}
					onchange={(v) => commit({ type: v as LeaveType })}
					data-testid="cal-leave-type"
					options={types.map((t) => ({ value: t, label: L.type[t] }))}
				/>
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
		<button
			type="button"
			class="remove"
			aria-label={D.removeNamed(title)}
			disabled={busy}
			onclick={remove}
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
