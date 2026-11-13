<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The project sheet (phase-2.md 9.3 "Project sheet"): the plan's name, the frame's start and end,
	the status date and the time zone, written to the project header through the edit API; the
	rest of the frame is Phase 3. It also holds the move preference (ADR-0008, amended 2026-11-13):
	the answer to "how should moving a task change the plan?" is asked once per browser, and this
	is where it is shown, changed or cleared. Clearing it ("Ask me next time") makes the next move
	ask again. The preference is a browser setting, not part of the plan: it is never written to
	the text.
-->
<script lang="ts">
	import type { MoveKind } from '../../lib/gantt/intents';
	import { projectEdit, type ProjectField } from '../../lib/inspector/edit';
	import { projectDetails } from '../../lib/inspector/project';
	import { inspectorStrings as S } from '../../lib/strings';
	import Sheet from '../Sheet.svelte';
	import CommitInput from './CommitInput.svelte';
	import { getInspector } from './context';
	import Field from './Field.svelte';

	const { app, actions, showInText } = getInspector();
	const P = S.project;
	const uid = $props.id();

	const open = $derived(app.inspector.projectOpen);
	const details = $derived(
		app.index ? projectDetails(app.index, app.workspace?.snapshot() ?? null) : null,
	);

	/** The zone names the browser knows, for the field's suggestions. */
	const zones: readonly string[] = (() => {
		try {
			return Intl.supportedValuesOf('timeZone');
		} catch {
			return [];
		}
	})();

	const commit = (field: ProjectField) => async (text: string) => {
		const e = projectEdit(field, text);
		return e ? (await actions.edit(e)).status === 'applied' : false;
	};
	const text = (f: NonNullable<typeof details>['now']): string =>
		f.kind === 'own' || f.kind === 'inherited' ? f.text : '';

	// The move preference lives in this browser's storage; the sheet reads it when it opens.
	let pref = $state<MoveKind | null>(null);
	$effect(() => {
		if (open) pref = app.edits?.movePreference ?? null;
	});
	function choose(kind: MoveKind | null): void {
		app.edits?.setMovePreference(kind);
		pref = kind;
	}
	const CHOICES: ReadonlyArray<{ kind: MoveKind | null; label: string }> = [
		{ kind: null, label: P.move.ask },
		{ kind: 'gap', label: P.move.gap },
		{ kind: 'start', label: P.move.start },
	];
</script>

<Sheet {open} side="bottom" title={P.title} onclose={() => (app.inspector.projectOpen = false)}>
	<p class="lead">{P.description}</p>
	{#if details === null}
		<p class="note">{P.noHeader}</p>
	{:else}
		<div class="fields">
			<Field label={P.name}>
				{#snippet children({ id, describedby })}
					<CommitInput {id} value={details.name ?? ''} {describedby} oncommit={commit('name')} />
				{/snippet}
			</Field>
			<div class="pair">
				<Field
					label={P.start}
					state={details.frameAt.kind === 'own' && details.start === null
						? { kind: 'text-only', reason: 'unreadable', at: details.frameAt.at }
						: undefined}
					onshow={showInText}
				>
					{#snippet children({ id, disabled, describedby })}
						<CommitInput
							{id}
							value={details.start ?? ''}
							{disabled}
							{describedby}
							mono
							oncommit={commit('start')}
						/>
					{/snippet}
				</Field>
				<Field label={P.end} hint={P.endHint}>
					{#snippet children({ id, describedby })}
						<CommitInput
							{id}
							value={details.end ?? ''}
							{describedby}
							mono
							oncommit={commit('end')}
						/>
					{/snippet}
				</Field>
			</div>
			<Field label={P.now} state={details.now} hint={P.nowHint} onshow={showInText}>
				{#snippet children({ id, disabled, describedby })}
					<CommitInput
						{id}
						value={text(details.now)}
						{disabled}
						{describedby}
						mono
						placeholder="2026-03-09-09:00"
						oncommit={commit('now')}
					/>
				{/snippet}
			</Field>
			<Field label={P.timezone} state={details.timezone} hint={P.timezoneHint} onshow={showInText}>
				{#snippet children({ id, disabled, describedby })}
					<CommitInput
						{id}
						value={text(details.timezone)}
						{disabled}
						{describedby}
						mono
						list="{uid}-zones"
						oncommit={commit('timezone')}
					/>
					<datalist id="{uid}-zones">
						{#each zones as z (z)}<option value={z}></option>{/each}
					</datalist>
				{/snippet}
			</Field>
		</div>
	{/if}

	<fieldset class="move">
		<legend>{P.move.title}</legend>
		<p class="note" id="{uid}-move-note">{P.move.description}</p>
		{#each CHOICES as c (c.kind ?? 'ask')}
			<label class="choice">
				<input
					type="radio"
					name="{uid}-move"
					value={c.kind ?? 'ask'}
					checked={pref === c.kind}
					disabled={app.edits === null}
					aria-describedby="{uid}-move-note"
					onchange={() => choose(c.kind)}
				/>
				<span>{c.label}</span>
			</label>
		{/each}
		<p class="note">{P.move.note}</p>
	</fieldset>
</Sheet>

<style>
	.lead,
	.note {
		margin: 0 0 var(--space-3);
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	.fields {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-block-end: var(--space-4);
	}
	.pair {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-3);
		align-items: start;
	}
	.move {
		margin: 0;
		padding: var(--space-3) 0 0;
		border: 0;
		border-block-start: 1px solid var(--color-border);
	}
	legend {
		padding: 0;
		font-size: var(--text-md);
		font-weight: 600;
	}
	.choice {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-block-size: var(--size-tap);
		cursor: pointer;
	}
	.choice input {
		inline-size: 24px;
		block-size: 24px;
		accent-color: var(--color-accent);
	}
	.choice:has(input:focus-visible) {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
		border-radius: var(--radius-md);
	}
	@media (max-width: 22rem) {
		.pair {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
