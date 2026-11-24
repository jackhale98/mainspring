<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The plan chip (ADR-0009): the open plan's name on a pill with a file icon and a chevron. It is a
	real <select> underneath, so it opens the native picker (the best on a phone) and keeps its
	accessible name "Sample plan". Replacing a plan whose changes are only in this tab asks first
	(AppState). The list is "New plan…" first (it opens the New plan sheet, which App.svelte mounts
	once, so that a layout change that remounts this chip does not lose what was typed), then the
	"Your plans" group, the plans kept in this browser, most recently changed first (a plan made
	here as "Name (new)", a sample's copy as "Name (copy)"; T4 review H2), then the "Samples" group
	(ADR-0013 #2). A plan that is open but not kept (the store refused it) has its own entry. The
	full chooser (rename, delete, locations) is T15's.
	`title` style puts the name in the serif display face for the phone header.
	Temporary file entries (T5, until T15's chooser replaces this list, phase-4.md 11.1), a "Files"
	group last: "Open folder…" where the browser can open a folder in place (Chromium), "Open
	files…", "Import folder…" on a fine pointer where folder inputs exist, "Save to folder…" (a plan
	only in this browser, where folders open) and "Export plan files". The two file inputs sit beside
	the chip, hidden. Pointing at the chip fetches the code behind them, so a picker opens in the
	gesture.
-->
<script lang="ts">
	import type { AppState } from '../../lib/state/app.svelte';
	import { planKey } from '../../lib/state/app-storage';
	import { strings } from '../../lib/strings';
	import Icon from '../Icon.svelte';
	import Select from '../ui/Select.svelte';

	interface Props {
		app: AppState;
		/** The phone's form: the name as a serif title, with a subtitle under it. */
		title?: boolean;
		subtitle?: string;
	}
	let { app, title = false, subtitle = '' }: Props = $props();

	/** The "New plan…" entry's value: not a plan's key. */
	const CREATE = '__new-plan__';
	/** The file entries' values (module comment), none of them a plan's key. */
	const FILES = {
		'__open-folder__': () => void app.openFolder(),
		'__open-files__': () => filesInput?.click(),
		'__import-folder__': () => folderInput?.click(),
		'__save-folder__': () => void app.saveToFolder(),
		__export__: () => void app.exportPlan(),
	} as const;
	const F = strings.planFiles;
	let filesInput: HTMLInputElement | undefined = $state();
	let folderInput: HTMLInputElement | undefined = $state();
	const fine = globalThis.matchMedia?.('(pointer: fine)').matches ?? true;
	const canFolder =
		typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
	const canImport = fine && 'webkitdirectory' in HTMLInputElement.prototype;

	/** Files were picked: they open as a plan (the input is cleared, so the same pick works again). */
	function picked(input: HTMLInputElement): void {
		const files = [...(input.files ?? [])];
		input.value = '';
		if (files.length > 0) void app.openFiles(files);
	}

	async function pick(value: string, select: HTMLSelectElement): Promise<void> {
		if (value === CREATE) {
			select.value = app.planKey;
			app.newPlanOpen = true;
			return;
		}
		if (value in FILES) {
			select.value = app.planKey;
			FILES[value as keyof typeof FILES]();
			return;
		}
		if (value === app.planKey) return;
		const opened = value.startsWith('ws:')
			? await app.openStored(value.slice(3))
			: await app.openSample(value);
		// A cancelled switch leaves the old plan open: show it in the picker again.
		if (!opened) select.value = app.planKey;
	}
	const kept = $derived(
		app.keeping.plans.map((p) => ({
			key: planKey(p.id),
			label: 'newPlan' in p.from ? strings.newPlan.listed(p.name) : p.name,
		})),
	);
	/** The open plan when it is neither kept here nor a sample: it gets its own entry. */
	const own = $derived(
		app.planKey !== '' &&
			!app.samples.some((s) => s.id === app.planKey) &&
			!kept.some((p) => p.key === app.planKey),
	);
</script>

<label class="chip" class:title onpointerdown={() => app.preloadFiles()}>
	{#if !title}<Icon name="file" size={15} />{/if}
	<span class="text" aria-hidden="true">
		<span class="name">{app.planLabel}</span>
		{#if title && subtitle !== ''}<span class="sub">{subtitle}</span>{/if}
	</span>
	<Icon name="chevronDown" size={title ? 16 : 13} />
	<Select
		variant="overlay"
		value={app.planKey}
		onchange={pick}
		onfocus={() => app.preloadFiles()}
		aria-label={strings.topBar.sample}
	>
		<option value={CREATE}>{strings.newPlan.chooser}</option>
		{#if own}
			<option value={app.planKey}>{app.planLabel}</option>
		{/if}
		{#if kept.length > 0}
			<optgroup label={strings.newPlan.yourPlans}>
				{#each kept as p (p.key)}
					<option value={p.key}>{p.label}</option>
				{/each}
			</optgroup>
		{/if}
		<optgroup label={strings.newPlan.samplesGroup}>
			{#each app.samples as sample (sample.id)}
				<option value={sample.id}>{sample.label}</option>
			{/each}
		</optgroup>
		<optgroup label={F.group}>
			{#if canFolder}<option value="__open-folder__">{F.openFolder}</option>{/if}
			<option value="__open-files__">{F.openFiles}</option>
			{#if canImport}<option value="__import-folder__">{F.importFolder}</option>{/if}
			{#if app.workspace}
				{#if canFolder && app.planLocation.kind === 'browser' && !app.readOnly}
					<option value="__save-folder__">{F.saveToFolder}</option>
				{/if}
				<option value="__export__">{F.export}</option>
			{/if}
		</optgroup>
	</Select>
</label>
<input
	bind:this={filesInput}
	type="file"
	multiple
	accept={fine ? '.tjp,.tji' : undefined}
	hidden
	data-testid="open-files-input"
	onchange={(e) => picked(e.currentTarget)}
/>
{#if canImport}
	<input
		bind:this={folderInput}
		type="file"
		webkitdirectory
		hidden
		data-testid="import-folder-input"
		onchange={(e) => picked(e.currentTarget)}
	/>
{/if}

<style>
	.chip {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-inline-size: 0;
		max-inline-size: 100%;
		min-block-size: var(--size-control);
		padding-inline: 12px;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		box-shadow: var(--shadow-chip);
		color: var(--color-text);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
	}
	.chip :global(.icon) {
		color: var(--color-text-muted);
	}
	.text {
		display: flex;
		flex-direction: column;
		min-inline-size: 0;
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* The real control (the Select's overlay variant) covers the chip: a tap anywhere opens the picker. */
	.chip:has(:global(select:focus-visible)) {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
	.chip:hover {
		background: var(--color-row-hover);
	}
	/* The phone's header: the plan's name is the title, in the serif face, on the canvas. */
	.chip.title {
		padding: 0;
		border: 0;
		background: transparent;
		box-shadow: none;
		gap: 4px;
	}
	.chip.title:hover {
		background: transparent;
	}
	.chip.title .name {
		font-family: var(--font-display);
		font-size: 24px;
		font-weight: 400;
		line-height: 1.1;
	}
	.chip.title .sub {
		color: var(--color-text-muted);
		font-size: 12px;
		font-weight: 400;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
