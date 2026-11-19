<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	A person's own leaves in their details (phase-3.md 9.6, 7.1 W5): each `leaves` item and
	`vacation` interval written in the person's declaration, with Edit (the Calendar's leave card:
	type, name, first and last day) and Remove, and "Add leave", which opens the Calendar scoped to
	this person where the days are painted (W3's non-drag path is the Calendar's keyboard). Every
	change is the Calendar's own planner (lib/calendar/leave-edit.ts) and one dispatcher edit, one undo
	step. Leaves the editor cannot show (written with a macro, or from a shift) are said to be
	text only.
-->
<script lang="ts">
	import {
		itemFields,
		refOf,
		typesOfItem,
		type CommitResult,
		type LeaveFields,
	} from '../../lib/calendar/leave-edit';
	import { scopeItems, type PaintItem } from '../../lib/calendar/paint-items';
	import { runLeaveEdit, runLeaveRemove } from '../../lib/calendar/run';
	import { calendarStrings as C, leavePaintStrings as L } from '../../lib/strings-calendar';
	import { resourceStrings as R } from '../../lib/strings-resources';
	import type { LeaveRef } from '../../lib/tjp/edit/types';
	import type { ResourceId } from '../../lib/tjp/index';
	import LeaveCard from '../calendar/LeaveCard.svelte';
	import { getInspector } from './context';

	interface Props {
		id: ResourceId;
		name: string;
		/** Opens the Calendar with this person. */
		onadd: () => void;
	}
	let { id, name, onadd }: Props = $props();
	const { app, showInText } = getInspector();
	const D = R.details.leaves;
	const zones = app.zones;
	const confirm = (m: string): boolean => globalThis.confirm(m);

	const index = $derived(app.index);
	const project = $derived((app.run?.lastGood?.result ?? null)?.project ?? null);
	const startEpoch = $derived(project ? Math.round(Date.parse(project.start) / 1000) : 0);
	const items = $derived(
		index && project ? scopeItems(index, { kind: 'resource', resource: id }, startEpoch) : [],
	);
	/** Leave items the text has that the editor could not read (a macro, a shift). */
	const unreadable = $derived.by(() => {
		if (!index) return null;
		const top = index.scenarios[0]?.id ?? null;
		const sites = index.leaves.filter(
			(l) =>
				l.scope.kind === 'resource' &&
				l.scope.resource === id &&
				(l.attr.scenario === null || l.attr.scenario === top),
		);
		const written = sites.reduce((n, s) => n + s.items.length, 0);
		return written > items.length ? (sites[0]?.attr.statement ?? null) : null;
	});

	let editing = $state<number | null>(null);

	const shown = (ymd: string): string => {
		const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
		return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
			new Date(Date.UTC(y, m - 1, d)),
		);
	};
	const fieldsOf = (item: PaintItem): LeaveFields | null =>
		project ? itemFields(item, project, zones) : null;
	const summary = (item: PaintItem): string => {
		const f = fieldsOf(item);
		const type = item.name ? `${L.type[item.type]} ${item.name}` : L.type[item.type];
		return f ? D.item(type, L.days(shown(f.start), shown(f.end))) : type;
	};

	// Every change goes out at once on the item's range and the index version it was read in; the
	// dispatcher finds the item in the text now (ADR-0018), however far the index lags.
	const commit = (ref: LeaveRef, f: LeaveFields): Promise<CommitResult> =>
		runLeaveEdit(app.edits, ref, f, project ? { project, zones } : null, confirm);

	async function remove(ref: LeaveRef): Promise<void> {
		editing = null;
		await runLeaveRemove(app.edits, ref, project ? { project } : null, confirm);
	}
</script>

<div class="leaves" data-testid="person-leaves">
	{#if items.length === 0 && unreadable === null}
		<p class="none">{D.none}</p>
	{:else}
		<ul>
			{#each items as item, n (`${item.range.file}:${item.range.from}`)}
				<li data-testid="person-leave">
					<div class="row">
						<span class="text">{summary(item)}</span>
						<button
							type="button"
							aria-expanded={editing === n}
							aria-label="{editing === n ? D.done : D.edit}: {summary(item)}"
							onclick={() => (editing = editing === n ? null : n)}
							>{editing === n ? D.done : D.edit}</button
						>
						<button
							type="button"
							aria-label="{D.remove}: {summary(item)}"
							onclick={() => remove(refOf(item))}>{D.remove}</button
						>
					</div>
					{#if editing === n}
						<ul class="card">
							<LeaveCard
								{item}
								fields={fieldsOf(item)}
								types={typesOfItem(item)}
								oncommit={commit}
								onremove={remove}
							/>
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
		{#if unreadable}
			<p class="none">{C.textOnly}</p>
			<button type="button" class="link" onclick={() => unreadable && showInText(unreadable)}
				>{R.details.showInText}</button
			>
		{/if}
	{/if}
	<button type="button" class="add" data-testid="person-add-leave" onclick={onadd}>
		{D.add}<span class="sr-only"> {name}</span>
	</button>
	<p class="hint">{D.addHint}</p>
</div>

<style>
	.leaves {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	ul {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.text {
		flex: 1 1 8rem;
		min-inline-size: 0;
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}
	.row button,
	.add {
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
	.add {
		align-self: start;
	}
	.row button:hover,
	.add:hover {
		background: var(--color-row-hover);
	}
	.row button:focus-visible,
	.add:focus-visible,
	.link:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 1px;
	}
	.card {
		margin-block-start: var(--space-1);
	}
	.none,
	.hint {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	.hint {
		font-size: var(--text-xs);
	}
	.link {
		align-self: start;
		padding: 0;
		border: 0;
		background: none;
		color: var(--color-link, var(--color-focus));
		font: inherit;
		font-size: var(--text-sm);
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
</style>
