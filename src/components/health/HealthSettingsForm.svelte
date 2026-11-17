<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The health settings (phase-3.md 9.2, 12; T18): the two thresholds (a long gap, a long task, in
	working days) with steppers, whether milestones are checked for predecessors and successors
	(off by default: key dates are often left unlinked on purpose), and each check on or off. They
	are UI preferences of the open plan on this device (settings.ts, ADR-0008 #3): nothing is
	written to the plan text. A change makes a new report at once. A threshold that is not a whole
	number of days from 1 to 3650 is refused with a sentence and the field keeps what it had.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { defaultHealthSettings, withCheck, withLinkMilestones } from '../../lib/health/settings';
	import { CHECK_IDS } from '../../lib/health/types';
	import type { AppState } from '../../lib/state/app.svelte';
	import { healthStrings as H } from '../../lib/strings-health-panel';

	let { app }: { app: AppState } = $props();
	// What is kept for the plan, if no report has read it yet.
	onMount(() => app.health.ensureSettings());

	const S = H.settings;
	const MIN = 1;
	const MAX = 3650;
	const uid = $props.id();
	const settings = $derived(app.health.settings ?? defaultHealthSettings());
	let gap = $state('');
	let task = $state('');
	let invalid = $state<'gap' | 'task' | null>(null);
	$effect(() => {
		gap = String(settings.longGapDays);
		task = String(settings.longTaskDays);
	});

	function commit(which: 'gap' | 'task', text: string): void {
		const n = Number(text);
		if (text.trim() === '' || !Number.isInteger(n) || n < MIN || n > MAX) {
			invalid = which;
			return;
		}
		invalid = null;
		app.health.setSettings({
			...settings,
			...(which === 'gap' ? { longGapDays: n } : { longTaskDays: n }),
		});
	}

	function step(which: 'gap' | 'task', by: number): void {
		const cur = Number(which === 'gap' ? gap : task);
		const next = Math.max(MIN, Math.min(MAX, (Number.isFinite(cur) ? cur : MIN) + by));
		if (which === 'gap') gap = String(next);
		else task = String(next);
		commit(which, String(next));
	}
</script>

{#snippet field(which: 'gap' | 'task', label: string, hint: string, value: string)}
	<div class="field">
		<label for="{uid}-{which}">{label}</label>
		<span class="stepper">
			<button
				type="button"
				aria-label={S.decrease(label)}
				disabled={Number(value) <= MIN}
				onclick={() => step(which, -1)}>−</button
			>
			<input
				id="{uid}-{which}"
				type="text"
				inputmode="numeric"
				autocomplete="off"
				value={which === 'gap' ? gap : task}
				aria-invalid={invalid === which}
				aria-describedby="{uid}-{which}-note"
				data-testid="health-{which}-days"
				oninput={(e) => {
					const v = e.currentTarget.value;
					if (which === 'gap') gap = v;
					else task = v;
				}}
				onchange={(e) => commit(which, e.currentTarget.value)}
				onkeydown={(e) => {
					if (e.key === 'Enter') commit(which, e.currentTarget.value);
				}}
			/>
			<button
				type="button"
				aria-label={S.increase(label)}
				disabled={Number(value) >= MAX}
				onclick={() => step(which, 1)}>+</button
			>
		</span>
		{#if invalid === which}
			<p id="{uid}-{which}-note" class="error" role="alert">{S.invalid}</p>
		{:else}
			<p id="{uid}-{which}-note" class="hint">{hint}</p>
		{/if}
	</div>
{/snippet}

<div class="settings" data-testid="health-settings">
	<section aria-labelledby="{uid}-thresholds">
		<h3 id="{uid}-thresholds">{S.thresholds}</h3>
		{@render field('gap', S.longGapDays, S.longGapHint, gap)}
		{@render field('task', S.longTaskDays, S.longTaskHint, task)}
	</section>
	<section aria-labelledby="{uid}-checks">
		<h3 id="{uid}-checks">{S.checks}</h3>
		<ul>
			{#each CHECK_IDS as check (check)}
				<li>
					<label class="switch">
						<input
							type="checkbox"
							checked={settings.enabled[check]}
							data-check={check}
							onchange={(e) =>
								app.health.setSettings(withCheck(settings, check, e.currentTarget.checked))}
						/>
						<span>{H.check[check]}</span>
					</label>
					{#if check === 'no-successor'}
						<label class="switch sub">
							<input
								type="checkbox"
								checked={settings.linkMilestones}
								data-testid="health-link-milestones"
								aria-describedby="{uid}-milestones"
								onchange={(e) =>
									app.health.setSettings(withLinkMilestones(settings, e.currentTarget.checked))}
							/>
							<span>{S.linkMilestones}</span>
						</label>
						<p class="hint sub" id="{uid}-milestones">{S.linkMilestonesHint}</p>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
	<div class="foot">
		<button
			type="button"
			class="reset"
			data-testid="health-reset"
			onclick={() => app.health.setSettings(defaultHealthSettings())}>{S.reset}</button
		>
		<p class="hint">{S.saved}</p>
	</div>
</div>

<style>
	.settings {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	h3 {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 600;
	}
	p {
		margin: 0;
	}
	.hint {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
	.error {
		color: var(--color-diagnostic-error);
		font-size: var(--text-xs);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.field label {
		font-size: var(--text-sm);
	}
	.stepper {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}
	.stepper button,
	.reset {
		min-inline-size: var(--size-control);
		min-block-size: var(--size-control);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		cursor: pointer;
	}
	.stepper button:hover:not(:disabled),
	.reset:hover {
		background: var(--color-row-hover);
	}
	.stepper button:disabled {
		color: var(--color-text-muted);
		cursor: default;
	}
	.stepper input {
		inline-size: 5rem;
		min-block-size: var(--size-control);
		padding-inline: var(--space-2);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-variant-numeric: tabular-nums;
		text-align: center;
	}
	.stepper input[aria-invalid='true'] {
		border-color: var(--color-diagnostic-error);
	}
	.stepper button:focus-visible,
	.stepper input:focus-visible,
	.reset:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
	.reset {
		padding-inline: var(--space-4);
		border-radius: var(--radius-pill);
		font-size: var(--text-sm);
	}
	ul {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
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
		flex: none;
		inline-size: 22px;
		block-size: 22px;
		accent-color: var(--color-accent);
	}
	.switch:has(input:focus-visible) {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
		border-radius: var(--radius-md);
	}
	.sub {
		margin-inline-start: var(--space-6);
	}
	.foot {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
	}
</style>
