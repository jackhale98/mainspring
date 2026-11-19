<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The project sheet (phase-2.md 9.3 "Project sheet"): the plan's name, the frame's start and end,
	the status date and the time zone, written to the project header through the edit API, and
	(phase-3.md 9.6, phase-2.md 19.9) the rest of the frame: the working hours per weekday (the
	editor shared with a person's details), the hours in a working day (a stepper), the first day of
	the week (a switch; the load columns follow it), the time format and the currency. It also holds the move preference (ADR-0008, amended 2026-11-13):
	the answer to "how should moving a task change the plan?" is asked once per browser, and this
	is where it is shown, changed or cleared. Clearing it ("Ask me next time") makes the next move
	ask again. The preference is a browser setting, not part of the plan: it is never written to
	the text.
-->
<script lang="ts">
	import type { MoveKind } from '../../lib/gantt/intents';
	import { projectEdit, type ProjectField } from '../../lib/inspector/edit';
	import { projectDetails } from '../../lib/inspector/project';
	import { weekOf } from '../../lib/resources/hours';
	import { readBeforeOf, sameFileBefore } from '../../lib/resources/sites';
	import {
		dailyHoursEdit,
		dailyHoursStep,
		textSettingEdit,
		weekStartEdit,
	} from '../../lib/resources/project-edit';
	import { inspectorStrings as S } from '../../lib/strings';
	import { projectSheetStrings as P } from '../../lib/strings-project-sheet';
	import { projectFrameStrings as F } from '../../lib/strings-resources';
	import Sheet from '../Sheet.svelte';
	import CommitInput from './CommitInput.svelte';
	import { getInspector } from './context';
	import Field from './Field.svelte';
	import Stepper from './Stepper.svelte';
	import WorkingHoursEditor from './WorkingHoursEditor.svelte';

	const { app, actions, showInText } = getInspector();
	const uid = $props.id();

	const open = $derived(app.inspector.projectOpen);
	const details = $derived(
		app.index ? projectDetails(app.index, app.workspace, app.run?.indexVersion) : null,
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
	const ok = async (p: Promise<{ status: string }>): Promise<boolean> =>
		(await p).status === 'applied';

	// The rest of the frame (module comment). A project header written with a macro is text only.
	const frameOff = $derived(app.index?.project?.textOnly ?? null);
	const week = $derived(
		app.index
			? weekOf(
					app.index,
					{ kind: 'project' },
					app.workspace ? readBeforeOf(app.workspace.snapshot().includes) : sameFileBefore,
				)
			: null,
	);
	const dailyKey = 'project:dailyworkinghours';
	let lastDaily: Promise<{ status: string }> = Promise.resolve({ status: 'cancelled' });
	const daily = {
		press: (total: number, base: number): void => {
			lastDaily = actions.edit(dailyHoursStep(base + total), dailyKey);
		},
		end: async (): Promise<boolean> => {
			actions.flush(dailyKey);
			return (await lastDaily).status === 'applied';
		},
		type: async (typed: string): Promise<boolean> => {
			const e = dailyHoursEdit(typed);
			return e === null ? false : ok(actions.edit(e));
		},
	};
	const dailyValue = $derived.by(() => {
		const f = details?.dailyHours;
		if (!f || f.kind === 'text-only') return f ? null : 8;
		const n = Number(text(f));
		return text(f) !== '' && Number.isFinite(n) ? n : 8;
	});
	const textSetting = (attr: 'timeformat' | 'currency') => async (typed: string) => {
		const e = textSettingEdit(attr, typed);
		return e === null ? false : ok(actions.edit(e));
	};

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

		<section class="frame" aria-labelledby="{uid}-hours">
			<h3 id="{uid}-hours">{F.hoursTitle}</h3>
			<p class="note">{F.hoursLead}</p>
			{#if frameOff}
				<!-- The project header is written with a macro: nothing here can be written into it. -->
				<p class="note">{S.textOnly[frameOff.reason]}</p>
				<button type="button" class="link" onclick={() => showInText(frameOff.at)}>
					{S.showInText}
				</button>
			{/if}
			<fieldset class="inner" disabled={frameOff !== null}>
				{#if week}
					<WorkingHoursEditor
						scope={{ kind: 'project' }}
						who={details.name ?? P.title}
						reading={week}
					/>
				{/if}
				<div class="pair">
					<Field
						label={F.dailyHours}
						state={details.dailyHours}
						hint={F.dailyHoursHint}
						onshow={showInText}
					>
						{#snippet children({ id, disabled, describedby })}
							<Stepper
								{id}
								text={text(details.dailyHours) || '8'}
								value={dailyValue}
								format={(n) => String(Math.round(n * 100) / 100)}
								min={0.25}
								step={0.5}
								what={F.dailyHours}
								{disabled}
								{describedby}
								onpress={daily.press}
								onend={daily.end}
								oncommit={daily.type}
							/>
						{/snippet}
					</Field>
					<div class="field">
						<label class="switch" for="{uid}-week">
							<input
								id="{uid}-week"
								type="checkbox"
								role="switch"
								checked={details.weekStartsMonday}
								aria-describedby="{uid}-week-note"
								onchange={async (e) => {
									const box = e.currentTarget;
									const applied = await ok(actions.edit(weekStartEdit(box.checked)));
									if (!applied) box.checked = details.weekStartsMonday;
								}}
							/>
							<span>{F.weekStart}</span>
						</label>
						<p class="note" id="{uid}-week-note">{F.weekStartHint}</p>
					</div>
				</div>
				<div class="pair">
					<Field
						label={F.timeformat}
						state={details.timeformat}
						hint={F.timeformatHint}
						onshow={showInText}
					>
						{#snippet children({ id, disabled, describedby })}
							<CommitInput
								{id}
								value={text(details.timeformat)}
								{disabled}
								{describedby}
								mono
								placeholder="%Y-%m-%d"
								oncommit={textSetting('timeformat')}
							/>
						{/snippet}
					</Field>
					<Field
						label={F.currency}
						state={details.currency}
						hint={F.currencyHint}
						onshow={showInText}
					>
						{#snippet children({ id, disabled, describedby })}
							<CommitInput
								{id}
								value={text(details.currency)}
								{disabled}
								{describedby}
								mono
								placeholder="EUR"
								oncommit={textSetting('currency')}
							/>
						{/snippet}
					</Field>
				</div>
			</fieldset>
		</section>
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
	.frame {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-block-end: var(--space-4);
		padding-block-start: var(--space-3);
		border-block-start: 1px solid var(--color-border);
	}
	.inner {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-inline-size: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.link {
		align-self: start;
		padding: 0;
		border: 0;
		background: none;
		color: var(--color-focus);
		font: inherit;
		font-size: var(--text-sm);
		text-decoration: underline;
		cursor: pointer;
	}
	.frame h3 {
		margin: 0;
		font-size: var(--text-md);
		font-weight: 600;
	}
	.frame .note {
		margin: 0;
	}
	.switch {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-block-size: var(--size-tap);
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.switch input {
		inline-size: 24px;
		block-size: 24px;
		accent-color: var(--color-accent);
	}
	.switch:has(input:focus-visible) {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
		border-radius: var(--radius-md);
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
