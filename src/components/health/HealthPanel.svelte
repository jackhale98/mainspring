<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The health panel (phase-3.md 9.2, 9.7, 10; T18): the findings of the newest good result, grouped
	by check under headings, filtered by severity, with the counts per check, and a settings page
	(thresholds, milestones, each check on or off). The right panel's Health tab on a desktop and
	the body of the sheet on a tablet and a phone (`sheet`). A finding is a row (FindingRow.svelte)
	with its fixes; every fix goes through the edit dispatcher (lib/health/run-fix.ts). The panel
	reads the report that `app.health` makes in an idle task and never edits the plan itself.

	States: "Checking the plan…" until the first report, "No problems found." with nothing to
	report, "Nothing to check yet." with no tasks, a note that the findings are from the last good
	schedule while a newer one is made, and "Try again" when the checks could not be loaded.
	Escape closes the panel (the settings page first) and returns the focus to the Health button.
-->
<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { InspectorActions } from '../../lib/inspector/actions';
	import { assignable } from '../../lib/inspector/task';
	import {
		groupsOf,
		severityCounts,
		SEVERITIES,
		type SeverityFilter,
	} from '../../lib/health/panel-model';
	import type { FixEnv } from '../../lib/health/run-fix';
	import type { TextContext } from '../../lib/health/text';
	import type { AppState } from '../../lib/state/app.svelte';
	import { strings } from '../../lib/strings';
	import { healthStrings as H } from '../../lib/strings-health-panel';
	import Icon from '../Icon.svelte';
	import FindingRow from './FindingRow.svelte';
	import HealthSettingsForm from './HealthSettingsForm.svelte';

	interface Props {
		app: AppState;
		/** A bottom sheet (a tablet, a phone): what a fix opens is behind it, so it closes first. */
		sheet: boolean;
	}
	let { app, sheet }: Props = $props();

	const P = H.panel;
	const uid = $props.id();
	const health = $derived(app.health);
	const report = $derived(health.report);
	const basis = $derived(health.basis);
	const text = $derived<TextContext | null>(
		basis ? { index: basis.index, result: basis.result } : null,
	);
	const groups = $derived(report ? groupsOf(report, health.severity) : []);
	const sev = $derived(report ? severityCounts(report) : null);
	const shownSeverities = $derived(sev ? SEVERITIES.filter((s) => sev[s] > 0) : []);
	const checksWith = $derived(
		report ? Object.values(report.counts).filter((n) => n > 0).length : 0,
	);
	const people = $derived(app.index ? assignable(app.index) : []);
	const noTasks = $derived(basis !== null && basis.result.tasks.length === 0);
	const dimmed = $derived(app.run?.outdated ?? false);
	const selected = $derived(
		app.selection.current?.kind === 'task' ? app.selection.current.id : null,
	);

	let root: HTMLElement | undefined = $state();
	let summary: HTMLElement | undefined = $state();

	// Opened from the keyboard (the button or the tab has the focus ring): the focus moves in.
	onMount(() => {
		const a = document.activeElement;
		if (
			a instanceof HTMLElement &&
			a.closest('[data-testid="health-button"], [role="tab"]') &&
			a.matches(':focus-visible')
		) {
			summary?.focus();
		}
	});

	// --- What a fix does, through the app's doors (run-fix.ts)
	// svelte-ignore state_referenced_locally
	const actions = new InspectorActions({
		edits: () => app.edits,
		view: () => app.inspector.view,
	});
	const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
	const env: FixEnv = {
		openDependencyPicker: (task, role) => app.openDependencyPicker(task, role),
		openInWorkload: (resource, at) => app.openInWorkload(resource, at),
		openInCalendar: (resource) => {
			app.selection.selectResource(resource, 'visual');
			app.shell?.showView?.('calendar');
		},
		showWhy: (task) => app.showWhy(task),
		showInText: (at) => (app.shell ? app.shell.showInText(at) : app.showRange(at)),
		edit: (e) => actions.edit(e),
		action: (a) => actions.action(a),
		say: (message) => app.edits?.say(message, true),
		leave: async (to) => {
			// A sheet covers what the fix opens; a desktop's tab only for the details and other views.
			if (!sheet && to === 'text') return;
			health.hide();
			if (sheet) {
				await tick();
				await frame();
			}
		},
	};

	async function selectTask(task: string): Promise<void> {
		await env.leave('details');
		app.selection.selectTask(task, 'visual');
		app.shell?.showView?.('gantt');
		// A sheet layout shows what was picked: the details, as a tap on the row does.
		if (sheet) app.inspector.show();
	}

	async function showGantt(task: string, person: string): Promise<void> {
		await env.leave('view');
		await app.showInGantt(task, person);
	}

	function jump(check: string): void {
		const heading = root?.querySelector<HTMLElement>(`[data-group="${check}"] h3`);
		heading?.scrollIntoView({ block: 'start' });
		heading?.focus();
	}

	function onkeydown(e: KeyboardEvent): void {
		if (e.key !== 'Escape' || e.defaultPrevented) return;
		e.preventDefault();
		e.stopPropagation();
		if (health.settingsOpen) {
			health.settingsOpen = false;
			return;
		}
		health.hide();
		if (!sheet) document.querySelector<HTMLElement>('[data-testid="health-button"]')?.focus();
	}

	const filterLabel = (f: SeverityFilter): string =>
		f === 'all' ? P.severityAll : P.severityName[f];
</script>

<!-- Escape closes the panel; the section is not itself interactive. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
	class="health"
	class:dimmed
	bind:this={root}
	aria-label={H.title}
	data-testid="health-panel"
	{onkeydown}
>
	<header>
		<p class="summary" tabindex="-1" bind:this={summary} data-testid="health-summary">
			{#if report === null}
				{health.status === 'failed' ? P.failed : P.computing}
			{:else if noTasks}
				{P.noTasks}
			{:else if report.findings.length === 0}
				{P.empty}
			{:else}
				{P.summary(report.findings.length, checksWith)}
			{/if}
		</p>
		<button
			type="button"
			class="icon"
			aria-expanded={health.settingsOpen}
			aria-controls="{uid}-body"
			aria-label={H.settings.title}
			title={H.settings.title}
			data-testid="health-settings-button"
			onclick={() => (health.settingsOpen = !health.settingsOpen)}
		>
			<Icon name="sliders" size={17} />
		</button>
	</header>

	{#if dimmed && report !== null}<p class="note" role="note">{P.dimmed}</p>{/if}

	<div id="{uid}-body" class="body">
		{#if health.settingsOpen}
			<button type="button" class="back" onclick={() => (health.settingsOpen = false)}>
				<Icon name="chevronLeft" size={15} />{H.settings.back}
			</button>
			<HealthSettingsForm {app} />
		{:else if report === null}
			{#if health.status === 'failed'}
				<button type="button" class="back" onclick={() => health.retry()}
					>{strings.health.retry}</button
				>
			{/if}
		{:else if !noTasks && report.findings.length > 0 && text}
			<div class="filters" role="radiogroup" aria-label={P.severity}>
				{#each ['all', ...shownSeverities] as f (f)}
					{@const s = f as SeverityFilter}
					<button
						type="button"
						role="radio"
						aria-checked={health.severity === s}
						class="chip"
						data-testid="severity-{s}"
						onclick={() => (health.severity = s)}
					>
						{filterLabel(s)}
						<span class="n">{s === 'all' ? report.findings.length : (sev?.[s] ?? 0)}</span>
					</button>
				{/each}
			</div>
			<ul class="counts" aria-label={P.findings}>
				{#each groups as g (g.check)}
					<li>
						<button type="button" class="count" onclick={() => jump(g.check)}>
							{H.check[g.check]} <span class="n">{g.findings.length}</span>
						</button>
					</li>
				{/each}
			</ul>
			{#if groups.length === 0}
				<p class="muted">{P.none}</p>
			{/if}
			{#each groups as g (g.check)}
				<section class="group" data-group={g.check} aria-labelledby="{uid}-{g.check}">
					<h3 id="{uid}-{g.check}" tabindex="-1">{P.group(H.check[g.check], g.findings.length)}</h3>
					<ul class="findings">
						{#each g.findings as finding, i (`${g.check}-${i}`)}
							<FindingRow
								{finding}
								{text}
								{env}
								{people}
								current={selected !== null &&
									finding.subject.kind === 'task' &&
									finding.subject.id === selected}
								onselect={selectTask}
								onshowgantt={showGantt}
							/>
						{/each}
					</ul>
				</section>
			{/each}
		{/if}
	</div>
</section>

<style>
	.health {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.health.dimmed .findings {
		opacity: 0.7;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	p {
		margin: 0;
	}
	.summary {
		font-size: var(--text-sm);
		font-weight: 600;
	}
	.summary:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
	.note {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		background: var(--color-brass-wash);
		color: var(--color-brass-ink);
		font-size: var(--text-xs);
	}
	.muted {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.icon,
	.back {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		min-inline-size: var(--size-control);
		min-block-size: var(--size-control);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.back {
		align-self: flex-start;
		padding-inline: var(--space-3);
		border-radius: var(--radius-pill);
	}
	.icon[aria-expanded='true'] {
		border-color: var(--color-accent);
	}
	.icon:hover,
	.back:hover {
		background: var(--color-row-hover);
	}
	.icon:focus-visible,
	.back:focus-visible,
	.chip:focus-visible,
	.count:focus-visible,
	h3:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.chip,
	.count {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
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
	.chip[aria-checked='true'] {
		border-color: var(--color-accent);
		background: var(--color-accent);
		color: var(--color-accent-text);
		font-weight: 600;
	}
	.n {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}
	.counts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.count {
		border-color: var(--color-border);
	}
	.chip:not([aria-checked='true']):hover,
	.count:hover {
		background: var(--color-row-hover);
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	h3 {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 600;
	}
	.findings {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	@media (pointer: coarse) {
		.chip,
		.count {
			min-block-size: var(--size-tap);
		}
	}
</style>
