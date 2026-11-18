<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	One finding of the health panel (phase-3.md 9.7, 10): a severity glyph (a shape, and its word for
	a screen reader, never colour alone), the sentence, the task it is about (a button that selects
	it) and its fixes as buttons. A fix whose text the editor cannot change is disabled and the
	reason is said once under the row, with the way to the text ("Show in text" stays on). "Replace
	Dev…" is a native select, as the chip's; "Edit gap" opens a small field for the new gap.
	Findings about a person (held, or run without them) add "Show in Gantt", which filters the
	chart to that person. Every fix goes through run-fix.ts, so it is one undo step.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { personOf } from '../../lib/health/panel-model';
	import { needsInput, replaceWith, runFix, withGap, type FixEnv } from '../../lib/health/run-fix';
	import {
		fixLabel,
		sentenceOf,
		subjectTask,
		taskName,
		type TextContext,
	} from '../../lib/health/text';
	import type { Finding, Fix } from '../../lib/health/types';
	import { inspectorStrings } from '../../lib/strings';
	import { healthStrings as H } from '../../lib/strings-health-panel';
	import type { ResourceId } from '../../lib/tjp/index';
	import StatusGlyph from '../app/StatusGlyph.svelte';
	import Select from '../ui/Select.svelte';

	interface Props {
		finding: Finding;
		text: TextContext;
		env: FixEnv;
		/** The people a task can be given to instead (leaf resources). */
		people: ReadonlyArray<{ readonly id: ResourceId; readonly name: string }>;
		/** What the list keys the row by, its place in the list and the list's length (windowed: FindingGroup). */
		itemKey: string;
		pos: number;
		size: number;
		/** The finding's task is the selected one. */
		current: boolean;
		onselect: (task: string) => void;
		onshowgantt: (task: string, person: ResourceId) => void;
	}
	let { finding, text, env, people, itemKey, pos, size, current, onselect, onshowgantt }: Props =
		$props();

	const P = H.panel;
	const uid = $props.id();
	const sentence = $derived(sentenceOf(finding, text));
	const task = $derived(subjectTask(finding));
	const name = $derived(task === null ? null : taskName(text, task));
	const subject = $derived(
		finding.subject.kind === 'link'
			? P.link(taskName(text, finding.subject.pred), taskName(text, finding.subject.succ))
			: name,
	);
	const person = $derived(personOf(finding));
	const glyph = $derived(
		finding.severity === 'error' ? 'error' : finding.severity === 'warning' ? 'warning' : 'empty',
	);
	/** The reasons the row's fixes cannot run, once each, with the editor's sentence for them. */
	const reasons = $derived([
		...new Set(
			finding.fixes.flatMap((f) =>
				f.disabled === null ? [] : [inspectorStrings.textOnly[f.disabled]],
			),
		),
	]);

	let busy = $state(false);
	let editing = $state<Extract<Fix, { kind: 'intent' }> | null>(null);
	let gap = $state('');
	let gapField: HTMLInputElement | undefined = $state();

	async function press(fix: Fix): Promise<void> {
		if (busy) return;
		const input = needsInput(fix);
		if (input === 'gap' && fix.kind === 'intent' && fix.intent.type === 'setDependsGap') {
			editing = fix;
			gap = fix.intent.gap?.value ?? '';
			await tick();
			gapField?.focus();
			gapField?.select();
			return;
		}
		busy = true;
		try {
			await runFix(fix, finding, env);
		} finally {
			busy = false;
		}
	}

	async function applyGap(e: SubmitEvent): Promise<void> {
		e.preventDefault();
		const fix = editing;
		if (!fix || busy) return;
		busy = true;
		try {
			const out = await withGap(fix, gap, env);
			if (out === 'applied') editing = null;
		} finally {
			busy = false;
		}
	}

	async function choose(
		fix: Extract<Fix, { kind: 'replace-person' }>,
		to: string,
		select: HTMLSelectElement,
	): Promise<void> {
		select.value = '';
		if (to === '' || busy) return;
		busy = true;
		try {
			await replaceWith(fix, to, env);
		} finally {
			busy = false;
		}
	}

	const named = (label: string): string => (name === null ? label : `${label}, ${name}`);
</script>

<li
	class="finding"
	class:current
	data-testid="finding"
	data-key={itemKey}
	data-i={pos}
	aria-posinset={pos + 1}
	aria-setsize={size}
	data-check={finding.check}
	data-severity={finding.severity}
	data-task={task ?? undefined}
	aria-current={current ? 'true' : undefined}
>
	<span class="glyph" aria-hidden="true"><StatusGlyph kind={glyph} size={18} /></span>
	<div class="main">
		<p class="sentence">
			<span class="sr-only">{P.severityWord[finding.severity]}: </span>{sentence}
		</p>
		{#if subject !== null && task !== null}
			<p class="subject">
				<button type="button" class="task" onclick={() => onselect(task)}>{subject}</button>
			</p>
		{/if}
		<div class="fixes" role="group" aria-label={P.fixes}>
			{#each finding.fixes as fix, i (i)}
				{#if fix.kind === 'replace-person'}
					{@const others = people.filter((p) => p.id !== fix.from)}
					{#if fix.disabled === null && others.length > 0}
						<label class="pick">
							<span class="sr-only">{named(fixLabel(fix, text))}</span>
							<Select
								variant="pill"
								value=""
								disabled={busy}
								data-fix="replace-person"
								onchange={(v, select) => choose(fix, v, select)}
								options={[
									{ value: '', label: fixLabel(fix, text) },
									...others.map((p) => ({ value: p.id, label: p.name })),
								]}
							/>
						</label>
					{:else}
						<button type="button" class="fix" disabled data-fix="replace-person"
							>{fixLabel(fix, text)}</button
						>
					{/if}
				{:else}
					<button
						type="button"
						class="fix"
						disabled={fix.disabled !== null || busy || (fix.kind === 'show' && finding.at === null)}
						aria-label={named(fixLabel(fix, text))}
						data-fix={fix.kind === 'intent' ? fix.intent.type : fix.kind}
						onclick={() => press(fix)}>{fixLabel(fix, text)}</button
					>
				{/if}
			{/each}
			{#if person !== null && task !== null}
				<button
					type="button"
					class="fix"
					disabled={busy}
					aria-label={named(P.showInGantt)}
					data-fix="show-in-gantt"
					onclick={() => onshowgantt(task, person)}>{P.showInGantt}</button
				>
			{/if}
		</div>
		{#if editing}
			<form class="gap" onsubmit={applyGap}>
				<label for="{uid}-gap">{P.gap.label}</label>
				<input
					id="{uid}-gap"
					bind:this={gapField}
					bind:value={gap}
					autocomplete="off"
					spellcheck="false"
					aria-describedby="{uid}-gap-hint"
					onkeydown={(e) => {
						if (e.key === 'Escape') {
							e.stopPropagation();
							editing = null;
						}
					}}
				/>
				<button type="submit" class="fix primary" disabled={busy}>{P.gap.apply}</button>
				<button type="button" class="fix" onclick={() => (editing = null)}>{P.gap.cancel}</button>
				<p class="hint" id="{uid}-gap-hint">{P.gap.hint}</p>
			</form>
		{/if}
		{#each reasons as reason (reason)}
			<p class="hint" data-testid="fix-off">{reason}</p>
		{/each}
	</div>
</li>

<style>
	.finding {
		/* The gap below is the row's own (not the list's), so the window can measure it with the row. */
		margin-block-end: var(--space-2);
		display: flex;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}
	.finding.current {
		border-color: var(--color-accent);
		background: var(--color-brass-wash);
	}
	.glyph {
		flex: none;
		padding-block-start: 1px;
	}
	.main {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-inline-size: 0;
		flex: 1;
	}
	p {
		margin: 0;
	}
	.sentence {
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}
	.subject {
		font-size: var(--text-xs);
	}
	.task {
		max-inline-size: 100%;
		padding: 0;
		border: 0;
		background: none;
		color: var(--color-accent);
		font: inherit;
		font-weight: 600;
		text-align: start;
		text-decoration: underline;
		text-underline-offset: 2px;
		overflow-wrap: anywhere;
		cursor: pointer;
	}
	.fixes {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-2);
	}
	.fix {
		min-block-size: 32px;
		padding-inline: var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-xs);
		cursor: pointer;
	}
	.fix:hover:not(:disabled) {
		background: var(--color-row-hover);
	}
	.fix:disabled {
		color: var(--color-text-muted);
		cursor: default;
	}
	.fix.primary {
		border-color: var(--color-accent);
		background: var(--color-accent);
		color: var(--color-accent-text);
	}
	.task:focus-visible,
	.fix:focus-visible,
	.gap input:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
	.gap {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.gap label {
		font-size: var(--text-xs);
		font-weight: 600;
	}
	.gap input {
		inline-size: 7rem;
		min-block-size: 32px;
		padding-inline: var(--space-2);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
	}
	.hint {
		flex-basis: 100%;
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
	@media (pointer: coarse) {
		.fix,
		.gap input {
			min-block-size: var(--size-tap);
		}
		.task {
			display: inline-flex;
			align-items: center;
			min-block-size: var(--size-tap);
		}
	}
	.sr-only {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
